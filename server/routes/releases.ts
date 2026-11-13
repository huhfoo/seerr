import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import requestLock, {
  mediaKey,
  mediaLock,
  userKey,
} from '@server/utils/requestLock';
import type { RequestHandler } from 'express';
import { Router } from 'express';

const releaseRoutes = Router();

// Sonarr needs a library entry before it can search releases. Previewing a
// release must not monitor episodes, alter an existing series, or create a request.
releaseRoutes.post(
  '/tv/:id/prepare',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const result = await requestLock.dispatch(userKey(req.user!.id), () =>
        mediaLock.dispatch(
          mediaKey(MediaType.TV, Number(req.params.id)),
          async () => {
            const settings = getSettings();
            const is4k = req.body.is4k === true;
            const repository = getRepository(Media);
            let media = await repository.findOne({
              where: { tmdbId: Number(req.params.id), mediaType: MediaType.TV },
            });
            if (media?.status === MediaStatus.BLOCKLISTED)
              throw Object.assign(new Error('This series is blocklisted.'), {
                status: 403,
              });
            const serviceId =
              req.body.serverId ?? media?.[is4k ? 'serviceId4k' : 'serviceId'];
            const server =
              serviceId != null
                ? settings.sonarr.find(
                    (item) => item.id === serviceId && item.is4k === is4k
                  )
                : settings.sonarr.find(
                    (item) => item.isDefault && item.is4k === is4k
                  );
            if (!server)
              throw Object.assign(
                new Error('No Sonarr server is configured for this request.'),
                { status: 400 }
              );
            const api = new SonarrAPI({
              apiKey: server.apiKey,
              url: SonarrAPI.buildUrl(server, '/api/v3'),
            });
            const tv = await new TheMovieDb().getTvShow({
              tvId: Number(req.params.id),
            });
            const tvdbId = req.body.tvdbId ?? tv.external_ids.tvdb_id;
            if (!tvdbId)
              throw Object.assign(
                new Error('No TVDB ID is available for this series.'),
                { status: 400 }
              );
            let series = await api.getSeriesByTvdbId(tvdbId);
            if (!series.id) {
              const anime = tv.keywords.results.some(
                (keyword) => keyword.id === ANIME_KEYWORD_ID
              );
              const profileId =
                req.body.profileId ??
                (anime ? server.activeAnimeProfileId : undefined) ??
                server.activeProfileId;
              const folder =
                req.body.rootFolder ??
                ((anime ? server.activeAnimeDirectory : undefined) ||
                  server.activeDirectory);
              const [profiles, folders] = await Promise.all([
                api.getProfiles(),
                api.getRootFolders(),
              ]);
              if (
                !profiles.some((profile) => profile.id === profileId) ||
                !folders.some((item) => item.path === folder)
              ) {
                throw Object.assign(
                  new Error(
                    'Select a valid Sonarr quality profile and root folder.'
                  ),
                  { status: 400 }
                );
              }
              series = await api.addSeries({
                tvdbid: tvdbId,
                title: tv.name,
                profileId,
                rootFolderPath: folder,
                languageProfileId:
                  req.body.languageProfileId ?? server.activeLanguageProfileId,
                seriesType: anime ? server.animeSeriesType : server.seriesType,
                seasons: [],
                seasonFolder: server.enableSeasonFolders,
                monitored: false,
                monitorNewItems: 'none',
                searchNow: false,
                tags: server.tags,
              });
            }
            if (!series.id)
              throw new Error('Sonarr did not return a series ID.');
            let episodes = await api.getEpisodes(series.id);
            for (let attempt = 0; !episodes.length && attempt < 15; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              episodes = await api.getEpisodes(series.id);
            }
            if (!episodes.length)
              throw new Error(
                'Sonarr is still refreshing this series. Try again shortly.'
              );
            media ??= new Media({
              tmdbId: tv.id,
              tvdbId,
              mediaType: MediaType.TV,
              status: MediaStatus.UNKNOWN,
              status4k: MediaStatus.UNKNOWN,
            });
            media[is4k ? 'serviceId4k' : 'serviceId'] = server.id;
            media[is4k ? 'externalServiceId4k' : 'externalServiceId'] =
              series.id;
            media[is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'] =
              series.titleSlug;
            await repository.save(media);
            return {
              mediaId: media.id,
              episodes: episodes.map(
                ({
                  id,
                  seasonNumber,
                  episodeNumber,
                  title,
                  hasFile,
                  monitored,
                }) => ({
                  id,
                  seasonNumber,
                  episodeNumber,
                  title,
                  hasFile,
                  monitored,
                })
              ),
            };
          }
        )
      );
      return res.json(result);
    } catch (error) {
      logger.warn('Unable to prepare series release search', {
        label: 'API',
        errorMessage: error.message,
      });
      return next({
        status: error.status ?? 502,
        message: error.status
          ? error.message
          : 'Unable to prepare the series in Sonarr. Try again shortly.',
      });
    }
  }
);

// Manual release selection is a management operation, independent of availability.
releaseRoutes.get(
  '/media/:id/episodes',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const media = await getRepository(Media).findOneOrFail({
        where: { id: Number(req.params.id) },
      });
      const is4k = req.query.is4k === 'true';
      const server = getSettings().sonarr.find(
        (item) => item.id === (is4k ? media.serviceId4k : media.serviceId)
      );
      const seriesId = is4k
        ? media.externalServiceId4k
        : media.externalServiceId;
      if (media.mediaType !== MediaType.TV || !server || !seriesId)
        return next({
          status: 404,
          message: 'Series is not linked to Sonarr yet.',
        });
      const api = new SonarrAPI({
        apiKey: server.apiKey,
        url: SonarrAPI.buildUrl(server, '/api/v3'),
      });
      const episodes = await api.getEpisodes(seriesId);
      return res.json(
        episodes.map(
          ({ id, seasonNumber, episodeNumber, title, hasFile, monitored }) => ({
            id,
            seasonNumber,
            episodeNumber,
            title,
            hasFile,
            monitored,
          })
        )
      );
    } catch {
      next({ status: 502, message: 'Unable to load Sonarr episodes.' });
    }
  }
);

const releaseHandler: RequestHandler = async (req, res, next) => {
  try {
    const media = await getRepository(Media).findOne({
      where: { id: Number(req.params.id) },
    });
    if (!media) return next({ status: 404, message: 'Media not found.' });
    const is4k = req.query.is4k === 'true';
    const serviceId = is4k ? media.serviceId4k : media.serviceId;
    const externalId = is4k
      ? media.externalServiceId4k
      : media.externalServiceId;
    const servers =
      media.mediaType === MediaType.TV
        ? getSettings().sonarr
        : getSettings().radarr;
    const server = servers.find((item) => item.id === serviceId);
    if (!server || !externalId)
      return next({
        status: 409,
        message:
          'Request this title first and wait for it to appear in Sonarr/Radarr.',
      });
    const api =
      media.mediaType === MediaType.TV
        ? new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          })
        : new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          });
    const params: {
      movieId?: number;
      seriesId?: number;
      episodeId?: number;
      seasonNumber?: number;
    } =
      media.mediaType === MediaType.MOVIE
        ? { movieId: externalId }
        : { seriesId: externalId };
    if (media.mediaType === MediaType.TV) {
      if (req.query.episodeId !== undefined) {
        const episodes = await (api as SonarrAPI).getEpisodes(externalId);
        const episode = episodes.find(
          (item) => item.id === Number(req.query.episodeId)
        );
        if (!episode)
          return next({
            status: 400,
            message: 'Episode does not belong to this series.',
          });
        params.episodeId = episode.id;
      } else if (req.query.seasonNumber !== undefined) {
        params.seasonNumber = Number(req.query.seasonNumber);
      } else
        return next({
          status: 400,
          message: 'Select an episode or season to search.',
        });
    }
    const releases = await api.getReleases(params);
    if (req.method === 'POST') {
      const release = releases.find(
        (item) =>
          item.guid === req.body.guid && item.indexerId === req.body.indexerId
      );
      if (!release)
        return next({
          status: 409,
          message:
            'Release is no longer in these search results. Search again.',
        });
      if (release.rejected)
        return next({
          status: 409,
          message:
            'Sonarr/Radarr rejected this release. Review its rejection reasons.',
        });
      await api.grabRelease(release.guid, release.indexerId);
      return res.status(204).send();
    }
    return res.json(releases);
  } catch (error) {
    logger.warn('Interactive release search failed', {
      label: 'API',
      errorMessage: error.message,
    });
    return next({
      status: 502,
      message:
        'Sonarr/Radarr could not complete the release operation. Check its connection and indexers.',
    });
  }
};
releaseRoutes.get(
  '/media/:id/releases',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  releaseHandler
);
releaseRoutes.post(
  '/media/:id/releases',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  releaseHandler
);

export default releaseRoutes;
