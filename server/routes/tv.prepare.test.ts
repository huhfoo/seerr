import ExternalAPI from '@server/api/externalapi';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import request from 'supertest';
import releaseRoutes from './releases';

setupTestDb();
afterEach(() => mock.restoreAll());
beforeEach(() => {
  getSettings().sonarr = [
    {
      name: 'Sonarr',
      useSsl: false,
      syncEnabled: true,
      preventSearch: true,
      tagRequests: false,
      overrideRule: [],
      activeProfileName: 'HD',
      animeSeriesType: 'anime',
      monitorNewItems: 'none',
      id: 0,
      is4k: false,
      isDefault: true,
      hostname: 'localhost',
      port: 8989,
      apiKey: 'secret',
      activeProfileId: 4,
      activeDirectory: '/tv',
      seriesType: 'standard',
      enableSeasonFolders: true,
      tags: [],
    },
  ] as SonarrSettings[];
  mock.method(
    ExternalAPI.prototype as unknown as { get: () => Promise<unknown> },
    'get',
    async () => ({
      id: 123,
      name: 'Preview Series',
      external_ids: { tvdb_id: 456 },
      keywords: { results: [] },
      videos: { results: [{ type: 'Trailer' }] },
    })
  );
  mock.method(
    ExternalAPI.prototype as unknown as {
      getRolling: (path: string) => Promise<unknown>;
    },
    'getRolling',
    async (path: string) =>
      path === '/qualityProfile'
        ? [{ id: 4, name: 'HD' }]
        : [{ id: 1, path: '/tv' }]
  );
  mock.method(SonarrAPI.prototype, 'getEpisodes', async () => [
    {
      id: 100,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilot',
      hasFile: false,
      monitored: false,
    },
  ]);
});

function app(permissions = Permission.MANAGE_REQUESTS) {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.user = new User({ id: 1, permissions });
    next();
  });
  instance.use(releaseRoutes);
  instance.use(
    (
      error: { status: number; message: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      void next;
      res.status(error.status ?? 500).json({ message: error.message });
    }
  );
  return instance;
}

describe('TV release preview preparation', () => {
  it('requires management permission before adding a library entry', async () => {
    await request(app(Permission.REQUEST))
      .post('/tv/123/prepare')
      .send({})
      .expect(403);
  });

  it('preserves an existing series and creates no media request', async () => {
    const series = { id: 42, monitored: true, titleSlug: 'preview-series' };
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => series);
    const add = mock.method(
      SonarrAPI.prototype,
      'addSeries',
      async () => series
    );
    const response = await request(app())
      .post('/tv/123/prepare')
      .send({ is4k: false })
      .expect(200);
    assert.equal(add.mock.callCount(), 0);
    assert.equal(series.monitored, true);
    assert.equal(response.body.episodes[0].id, 100);
    const media = await getRepository(Media).findOneByOrFail({
      id: response.body.mediaId,
    });
    assert.equal(media.status, MediaStatus.UNKNOWN);
    assert.equal(media.externalServiceId, 42);
    assert.equal(await getRepository(MediaRequest).count(), 0);
    assert.ok(!JSON.stringify(response.body).includes('secret'));
  });

  it('adds a new series with all monitoring and automatic searches disabled', async () => {
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 0,
    }));
    const add = mock.method(SonarrAPI.prototype, 'addSeries', async () => ({
      id: 42,
      titleSlug: 'preview-series',
    }));
    await request(app()).post('/tv/123/prepare').send({}).expect(200);
    const options = add.mock.calls[0].arguments[0];
    assert.ok(options);
    assert.deepEqual(options.seasons, []);
    assert.equal(options.monitored, false);
    assert.equal(options.searchNow, false);
    assert.equal(options.monitorNewItems, 'none');
    assert.equal(await getRepository(MediaRequest).count(), 0);
  });

  it('validates the selected root folder and profile before adding a series', async () => {
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 0,
    }));
    const add = mock.method(SonarrAPI.prototype, 'addSeries', async () => ({
      id: 42,
    }));
    await request(app())
      .post('/tv/123/prepare')
      .send({ rootFolder: '/outside-configured-folders' })
      .expect(400);
    await request(app())
      .post('/tv/123/prepare')
      .send({ profileId: 999 })
      .expect(400);
    assert.equal(add.mock.callCount(), 0);
  });

  it('respects blocklisting and unavailable servers', async () => {
    await request(app())
      .post('/tv/123/prepare')
      .send({ serverId: 999 })
      .expect(400);
    await getRepository(Media).save(
      new Media({
        tmdbId: 123,
        mediaType: MediaType.TV,
        status: MediaStatus.BLOCKLISTED,
      })
    );
    await request(app()).post('/tv/123/prepare').send({}).expect(403);
  });
});
