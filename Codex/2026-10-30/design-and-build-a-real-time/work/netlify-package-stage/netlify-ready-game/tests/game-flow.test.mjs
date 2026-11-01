import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameApi } from '../src/game-api.mjs';

class MemoryBlobs {
  constructor() { this.rows = new Map(); this.revision = 0; }

  async getWithMetadata(key, options = {}) {
    assert.equal(options.consistency, 'strong');
    const row = this.rows.get(key);
    return row ? { data: structuredClone(row.data), etag: row.etag } : null;
  }

  async setJSON(key, value, options = {}) {
    const existing = this.rows.get(key);
    if (options.onlyIfNew && existing) return { modified: false };
    if (options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
    const etag = `"${++this.revision}"`;
    this.rows.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  }
}

test('two drivers finish all three races with correct scoring and a final winner', async () => {
  const blobs = new MemoryBlobs();
  let time = 1_800_000_000_000;
  const api = createGameApi(blobs, { now: () => time });

  async function call(payload) {
    const response = await api(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const body = await response.json();
    assert.ok(response.ok, `${payload.op} failed: ${body.error ?? response.status}`);
    return body;
  }

  const host = await call({ op: 'create', name: 'Apex' });
  const code = host.room.code;
  const hostSession = { code, ...host.session };
  const challenger = await call({ op: 'join', code, name: 'Turbo' });
  const challengerSession = { code, ...challenger.session };
  await call({ op: 'start', ...hostSession });

  async function input(session, action, count = 1) {
    for (let i = 0; i < count; i += 1) {
      time += 180;
      await call({ op: 'action', ...session, action });
    }
  }

  // Monaco: Apex wins the sprint (10–7).
  await input(hostSession, 'drive', 4);
  await input(hostSession, 'boost');
  await input(challengerSession, 'drive', 2);
  time += 25_000;
  let state = await call({ op: 'state', ...hostSession });
  assert.equal(state.room.round, 2);
  assert.deepEqual(state.room.players.map(player => player.score), [10, 7]);

  // Silverstone: Turbo wins (10–7), drawing the cup level at 17 each.
  await input(hostSession, 'drive', 2);
  await input(challengerSession, 'drive', 5);
  await input(challengerSession, 'boost');
  time += 25_000;
  state = await call({ op: 'state', ...challengerSession });
  assert.equal(state.room.round, 3);
  assert.deepEqual(state.room.players.map(player => player.score), [17, 17]);

  // Monza is double points: Turbo wins 20–14 and takes the cup 37–31.
  await input(hostSession, 'drive', 3);
  await input(challengerSession, 'drive', 6);
  await input(challengerSession, 'boost');
  time += 30_000;
  state = await call({ op: 'state', ...hostSession });
  assert.equal(state.room.phase, 'results');
  assert.equal(state.room.winnerId, challengerSession.playerId);
  assert.deepEqual(state.room.players.map(player => [player.name, player.score]), [['Turbo', 37], ['Apex', 31]]);
  assert.deepEqual(state.room.roundResults.map(round => round.round), [1, 2, 3]);
  assert.deepEqual(state.room.roundResults[2].placements.map(place => place.points), [20, 14]);
});

test('room writes use a strongly consistent read and reject stale conditional writes', async () => {
  const blobs = new MemoryBlobs();
  const api = createGameApi(blobs, { now: () => 1_800_000_000_000 });
  const response = await api(new Request('https://game.test/.netlify/functions/game', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'create', name: 'One' }),
  }));
  assert.equal(response.status, 201);
  const { room } = await response.json();
  const key = `room-${room.code}`;
  const original = await blobs.getWithMetadata(key, { consistency: 'strong', type: 'json' });
  await blobs.setJSON(key, { ...original.data, updatedAt: 1 }, { onlyIfMatch: original.etag });
  const stale = await blobs.setJSON(key, original.data, { onlyIfMatch: original.etag });
  assert.equal(stale.modified, false);
});
