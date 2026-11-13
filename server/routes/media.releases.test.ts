import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import request from 'supertest';
import releaseRoutes from './releases';

setupTestDb();
afterEach(() => mock.restoreAll());

function appFor(permissions = Permission.MANAGE_REQUESTS) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = new User({ id: 1, permissions });
    next();
  });
  app.use(releaseRoutes);
  app.use(
    (
      error: { status?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      void _next;
      res.status(error.status ?? 500).json({ message: error.message });
    }
  );
  return app;
}

const release = {
  guid: 'release-guid',
  indexerId: 1,
  title: 'Example-GROUP',
  releaseGroup: 'GROUP',
  indexer: 'Test',
  size: 1024,
  protocol: 'torrent',
  rejected: false,
};

async function linkedMedia(mediaType = MediaType.MOVIE) {
  const settings = getSettings();
  settings.radarr = [
    { id: 0, hostname: 'localhost', port: 7878, apiKey: 'secret' },
  ] as typeof settings.radarr;
  settings.sonarr = [
    { id: 0, hostname: 'localhost', port: 8989, apiKey: 'secret' },
  ] as typeof settings.sonarr;
  return getRepository(Media).save(
    new Media({ tmdbId: 123, mediaType, serviceId: 0, externalServiceId: 42 })
  );
}

describe('interactive releases', () => {
  it('requires management permission for search and grab', async () => {
    const app = appFor(Permission.REQUEST);
    await request(app).get('/media/1/releases').expect(403);
    await request(app)
      .post('/media/1/releases')
      .send({ guid: 'x', indexerId: 1 })
      .expect(403);
  });

  it('binds movie searches and grabs to the linked Radarr title', async () => {
    const media = await linkedMedia();
    const search = mock.method(RadarrAPI.prototype, 'getReleases', async () => [
      release,
    ]);
    const grab = mock.method(
      RadarrAPI.prototype,
      'grabRelease',
      async () => undefined
    );
    const app = appFor();
    const response = await request(app)
      .get(`/media/${media.id}/releases`)
      .expect(200);
    assert.equal(response.body[0].releaseGroup, 'GROUP');
    assert.deepEqual(search.mock.calls[0].arguments[0], { movieId: 42 });
    await request(app)
      .post(`/media/${media.id}/releases`)
      .send({ guid: release.guid, indexerId: 1 })
      .expect(204);
    assert.deepEqual(grab.mock.calls[0].arguments, [release.guid, 1]);
  });

  it('refuses a forged release or a rejected release', async () => {
    const media = await linkedMedia();
    mock.method(RadarrAPI.prototype, 'getReleases', async () => [
      { ...release, rejected: true },
    ]);
    const grab = mock.method(
      RadarrAPI.prototype,
      'grabRelease',
      async () => undefined
    );
    for (const guid of ['forged', release.guid]) {
      await request(appFor())
        .post(`/media/${media.id}/releases`)
        .send({ guid, indexerId: 1 })
        .expect(409);
    }
    assert.equal(grab.mock.callCount(), 0);
  });

  it('refuses an episode belonging to another series', async () => {
    const media = await linkedMedia(MediaType.TV);
    mock.method(SonarrAPI.prototype, 'getEpisodes', async () => [
      { id: 10, seriesId: 42 },
    ]);
    const search = mock.method(
      SonarrAPI.prototype,
      'getReleases',
      async () => []
    );
    await request(appFor())
      .get(`/media/${media.id}/releases?episodeId=99`)
      .expect(400);
    assert.equal(search.mock.callCount(), 0);
  });

  it('omits upstream download URLs and credentials from search results', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost:7878/api/v3',
      apiKey: 'secret',
    });
    const axios = (api as unknown as { axios: { get: () => Promise<unknown> } })
      .axios;
    mock.method(axios, 'get', async () => ({
      data: [
        {
          ...release,
          downloadUrl: 'https://indexer/download?apikey=secret',
          magnetUrl: 'secret',
          infoUrl: 'secret',
        },
      ],
    }));
    const results = await api.getReleases({ movieId: 42 });
    assert.ok(!JSON.stringify(results).includes('secret'));
    assert.equal(results[0].releaseGroup, 'GROUP');
  });
  it('preserves signed custom format scores and sanitizes format details for both servers', async () => {
    for (const Client of [SonarrAPI, RadarrAPI]) {
      const api = new Client({
        url: 'http://localhost:8989/api/v3',
        apiKey: 'secret',
      });
      const axios = (
        api as unknown as { axios: { get: () => Promise<unknown> } }
      ).axios;
      mock.method(axios, 'get', async () => ({
        data: [-1000, 0, 150].map((score) => ({
          ...release,
          customFormatScore: score,
          customFormats: [
            {
              id: 21,
              name: 'Preferred group',
              specifications: [{ secret: 'not-for-the-client' }],
            },
          ],
        })),
      }));
      const results = await api.getReleases({ seriesId: 42 });
      assert.deepEqual(
        results.map((item) => item.customFormatScore),
        [-1000, 0, 150]
      );
      assert.deepEqual(results[0].customFormats, [
        { id: 21, name: 'Preferred group' },
      ]);
      assert.ok(!JSON.stringify(results).includes('not-for-the-client'));
    }
  });
});
