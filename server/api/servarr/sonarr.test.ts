import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { AxiosInstance } from 'axios';

import SonarrAPI from '@server/api/servarr/sonarr';

function buildSonarr(): SonarrAPI {
  return new SonarrAPI({ url: 'http://localhost:8989/api/v3', apiKey: 'test' });
}

function getAxios(sonarr: SonarrAPI): AxiosInstance {
  return (sonarr as unknown as { axios: AxiosInstance }).axios;
}

describe('SonarrAPI removeSeries', () => {
  afterEach(() => mock.restoreAll());

  it('removes the series when it exists in the library', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await sonarr.removeSeries(1234);

    assert.strictEqual(del.mock.callCount(), 1);
    assert.strictEqual(del.mock.calls[0].arguments[0], '/series/9');
  });

  it('does nothing when the series is not in the library', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({
      data: [{ id: 0, title: 'Breaking Bad' }],
    }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.doesNotReject(() => sonarr.removeSeries(1234));
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('rejects when the tvdbId is unknown to the lookup', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({ data: [] }));
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.rejects(() => sonarr.removeSeries(1234), /Series not found/);
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('ignores a 404 when the series was already removed in Sonarr', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    mock.method(getAxios(sonarr), 'delete', async () => {
      throw { response: { status: 404 } };
    });

    await assert.doesNotReject(() => sonarr.removeSeries(1234));
  });

  it('rethrows errors other than 404', async () => {
    const sonarr = buildSonarr();
    mock.method(SonarrAPI.prototype, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Test Series',
    }));
    mock.method(getAxios(sonarr), 'delete', async () => {
      throw { response: { status: 500 } };
    });

    await assert.rejects(() => sonarr.removeSeries(1234));
  });

  it('rethrows a 404 from the lookup instead of treating it as removed', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => {
      throw { response: { status: 404 } };
    });
    const del = mock.method(getAxios(sonarr), 'delete', async () => ({}));

    await assert.rejects(
      () => sonarr.removeSeries(1234),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 404
    );
    assert.strictEqual(del.mock.callCount(), 0);
  });
});

describe('SonarrAPI getSeriesByTvdbId', () => {
  afterEach(() => mock.restoreAll());

  it('rethrows a 401 from the lookup with the status intact', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => {
      throw { response: { status: 401 } };
    });

    await assert.rejects(
      () => sonarr.getSeriesByTvdbId(1234),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 401
    );
  });

  it('throws "Series not found" when the lookup returns no results', async () => {
    const sonarr = buildSonarr();
    mock.method(getAxios(sonarr), 'get', async () => ({ data: [] }));

    await assert.rejects(() => sonarr.getSeriesByTvdbId(1234), {
      message: 'Series not found',
    });
  });
});

describe('SonarrAPI episode-only requests', () => {
  afterEach(() => mock.restoreAll());

  const options = {
    tvdbid: 123,
    title: 'Pilot Test',
    profileId: 1,
    seasons: [1],
    episodes: [{ seasonNumber: 1, episodeNumber: 1, tvdbId: 1001 }],
    seasonFolder: true,
    rootFolderPath: '/tv',
    seriesType: 'standard' as const,
    monitored: true,
    searchNow: true,
  };

  it('monitors and searches only the selected missing episode, preserving existing season monitoring', async () => {
    const sonarr = buildSonarr();
    const existingSeasons = [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: true },
    ];
    mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Pilot Test',
      seasons: existingSeasons,
      monitored: true,
      tags: [],
    }));
    const put = mock.method(
      getAxios(sonarr),
      'put',
      async (_url: string, body: unknown) => ({ data: body })
    );
    const post = mock.method(getAxios(sonarr), 'post', async () => ({
      data: {},
    }));
    mock.method(sonarr, 'getEpisodes', async () => [
      {
        id: 101,
        tvdbId: 1001,
        seasonNumber: 1,
        episodeNumber: 1,
        hasFile: false,
        monitored: false,
      },
      {
        id: 102,
        tvdbId: 1002,
        seasonNumber: 1,
        episodeNumber: 2,
        hasFile: false,
        monitored: false,
      },
    ]);
    await sonarr.addSeries(options);
    assert.deepEqual(existingSeasons, [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: true },
    ]);
    const monitors = put.mock.calls.filter(
      (call) => call.arguments[0] === '/episode/monitor'
    );
    assert.deepEqual(
      monitors.map((call) => call.arguments[1]),
      [{ episodeIds: [101], monitored: true }]
    );
    assert.deepEqual(
      post.mock.calls.map((call) => call.arguments),
      [['/command', { name: 'EpisodeSearch', episodeIds: [101] }]]
    );
  });

  it('adds a new series without monitoring whole seasons or searching, then monitors only the pilot', async () => {
    const sonarr = buildSonarr();
    mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
      title: 'Pilot Test',
      seasons: [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
    }));
    const post = mock.method(getAxios(sonarr), 'post', async () => ({
      data: { id: 9 },
    }));
    const put = mock.method(getAxios(sonarr), 'put', async () => ({
      data: {},
    }));
    mock.method(sonarr, 'getEpisodes', async () => [
      {
        id: 101,
        tvdbId: 1001,
        seasonNumber: 1,
        episodeNumber: 1,
        hasFile: false,
      },
    ]);
    await sonarr.addSeries({ ...options, searchNow: false });
    const body = post.mock.calls[0].arguments[1] as {
      seasons: { monitored: boolean }[];
      monitorNewItems: string;
      addOptions: { searchForMissingEpisodes: boolean; monitor: string };
    };
    assert.ok(body.seasons.every((season) => !season.monitored));
    assert.equal(body.monitorNewItems, 'none');
    assert.equal(body.addOptions.searchForMissingEpisodes, false);
    assert.equal(body.addOptions.monitor, 'none');
    assert.equal(post.mock.callCount(), 1);
    assert.deepEqual(put.mock.calls[0].arguments[1], {
      episodeIds: [101],
      monitored: true,
    });
  });

  it('does not search an episode that already has a file', async () => {
    const sonarr = buildSonarr();
    mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
      id: 9,
      title: 'Pilot Test',
      seasons: [],
      monitored: true,
      tags: [],
    }));
    mock.method(
      getAxios(sonarr),
      'put',
      async (_url: string, body: unknown) => ({ data: body })
    );
    const post = mock.method(getAxios(sonarr), 'post', async () => ({
      data: {},
    }));
    mock.method(sonarr, 'getEpisodes', async () => [
      {
        id: 101,
        tvdbId: 1001,
        seasonNumber: 1,
        episodeNumber: 1,
        hasFile: true,
        monitored: true,
      },
    ]);
    await sonarr.addSeries(options);
    assert.equal(post.mock.callCount(), 0);
  });
});

it('matches selected episodes by TVDB identity when Sonarr numbering differs', async () => {
  const sonarr = buildSonarr();
  const add = mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
    id: 9,
    seasons: [],
    tags: [],
    monitored: false,
    monitorNewItems: 'none',
  }));
  const put = mock.method(
    getAxios(sonarr),
    'put',
    async (_url: string, body: unknown) => ({ data: body })
  );
  mock.method(sonarr, 'getEpisodes', async () => [
    {
      id: 101,
      tvdbId: 1001,
      seasonNumber: 2,
      episodeNumber: 5,
      hasFile: false,
    },
    {
      id: 102,
      tvdbId: 1002,
      seasonNumber: 1,
      episodeNumber: 1,
      hasFile: false,
    },
  ]);
  try {
    await sonarr.addSeries({
      tvdbid: 123,
      title: 'Test',
      seriesType: 'standard',
      profileId: 1,
      rootFolderPath: '/tv',
      seasonFolder: true,
      seasons: [1],
      monitored: true,
      episodes: [{ seasonNumber: 1, episodeNumber: 1, tvdbId: 1001 }],
      searchNow: false,
    });
    assert.deepEqual(
      put.mock.calls
        .filter((call) => call.arguments[0] === '/episode/monitor')
        .map((call) => call.arguments[1]),
      [{ episodeIds: [101], monitored: true }]
    );
    assert.equal(add.mock.callCount(), 1);
  } finally {
    mock.restoreAll();
  }
});

it('restores the requested future-season policy when activating a preview', async () => {
  const sonarr = buildSonarr();
  mock.method(sonarr, 'getSeriesByTvdbId', async () => ({
    id: 9,
    seasons: [],
    tags: [],
    monitored: false,
    monitorNewItems: 'none',
  }));
  const put = mock.method(
    getAxios(sonarr),
    'put',
    async (_url: string, body: unknown) => ({ data: body })
  );
  mock.method(sonarr, 'getEpisodes', async () => []);
  try {
    await sonarr.addSeries({
      tvdbid: 123,
      title: 'Test',
      seriesType: 'standard',
      profileId: 1,
      rootFolderPath: '/tv',
      seasonFolder: true,
      seasons: [1],
      monitored: true,
      monitorNewItems: 'all',
      searchNow: false,
    });
    assert.equal(
      (put.mock.calls[0].arguments[1] as { monitorNewItems: string })
        .monitorNewItems,
      'all'
    );
  } finally {
    mock.restoreAll();
  }
});
