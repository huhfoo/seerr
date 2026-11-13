import { AddRequestEpisodes1794400000000 } from '@server/migration/sqlite/1794400000000-AddRequestEpisodes';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DataSource } from 'typeorm';

it('adds episode selection without changing existing requests and supports rollback', async () => {
  const db = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.query(
      'CREATE TABLE media_request (id integer PRIMARY KEY, status integer NOT NULL)'
    );
    await runner.query('INSERT INTO media_request (id, status) VALUES (1, 2)');
    const migration = new AddRequestEpisodes1794400000000();
    await migration.up(runner);
    assert.deepEqual(await runner.query('SELECT * FROM media_request'), [
      { id: 1, status: 2, manualSearch: 0, episodes: null },
    ]);
    await migration.down(runner);
    assert.deepEqual(await runner.query('SELECT * FROM media_request'), [
      { id: 1, status: 2 },
    ]);
  } finally {
    await runner.release();
    await db.destroy();
  }
});
