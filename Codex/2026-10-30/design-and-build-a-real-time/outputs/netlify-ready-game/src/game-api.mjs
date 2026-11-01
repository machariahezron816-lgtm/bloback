import {
  advanceRoom,
  applyAction,
  cleanName,
  createRoom,
  makePlayerId,
  makeRoomCode,
  makeToken,
  publicRoom,
  startGame,
} from './game-engine.mjs';

const ROOM_KEY_PREFIX = 'room-';
const ROOM_CODE_RE = /^[A-Z0-9]{5}$/;

export function createGameApi(storeProvider, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const newCode = dependencies.makeRoomCode ?? makeRoomCode;
  const newPlayerId = dependencies.makePlayerId ?? makePlayerId;
  const newToken = dependencies.makeToken ?? makeToken;
  const getStore = typeof storeProvider === 'function' ? storeProvider : () => storeProvider;

  return async function handleGameRequest(request) {
    if (request.method !== 'POST') return json({ error: 'Use POST for game requests.' }, 405);

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const store = getStore();
    try {
      if (input.op === 'create') return await create(input, store);
      if (input.op === 'join') return await join(input, store);
      if (input.op === 'state' || input.op === 'start' || input.op === 'action') {
        return await withRoom(input, store);
      }
      return json({ error: 'Unknown game request.' }, 400);
    } catch (error) {
      if (error?.status) return json({ error: error.message }, error.status);
      console.error('Game function failed', error);
      return json({ error: 'The race server had a hiccup. Please try again.' }, 500);
    }
  };

  async function create(input, store) {
    const nowAt = now();
    const playerId = newPlayerId();
    const token = newToken();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = newCode();
      const room = createRoom({ code, name: cleanName(input.name), playerId, token, now: nowAt });
      const result = await store.setJSON(`${ROOM_KEY_PREFIX}${code}`, room, { onlyIfNew: true });
      if (result.modified) return json({ room: publicRoom(room, nowAt), session: { playerId, token } }, 201);
    }
    return json({ error: 'Could not reserve a room code. Try again.' }, 503);
  }

  async function join(input, store) {
    const code = normalizeCode(input.code);
    const name = cleanName(input.name);
    const playerId = newPlayerId();
    const token = newToken();
    const result = await mutateRoom(store, code, (room, nowAt) => {
      advanceRoom(room, nowAt);
      if (room.phase !== 'lobby') throw httpError('That race has already started.', 409);
      if (room.players.length >= 8) throw httpError('That starting grid is full.', 409);
      room.players.push({ id: playerId, name, score: 0, distance: 0, boostAt: 0, lastDriveAt: 0, token });
      room.updatedAt = nowAt;
      return { changed: true };
    });
    return json({ room: publicRoom(result.room, now()), session: { playerId, token } }, 200);
  }

  async function withRoom(input, store) {
    const code = normalizeCode(input.code);
    const playerId = String(input.playerId ?? '');
    const token = String(input.token ?? '');
    if (!playerId || token.length < 32) throw httpError('Your driver session is missing. Rejoin the room.', 401);

    const result = await mutateRoom(store, code, (room, nowAt) => {
      const advanced = advanceRoom(room, nowAt);
      const player = room.players.find(item => item.id === playerId && item.token === token);
      if (!player) throw httpError('Your driver session is no longer in this room.', 401);

      if (input.op === 'state') {
        if (advanced) room.updatedAt = nowAt;
        return { changed: advanced };
      }

      if (input.op === 'start') {
        if (room.hostId !== playerId) throw httpError('Only the host can start the cup.', 403);
        const started = startGame(room, nowAt);
        if (started.error) throw httpError(started.error, 409);
        room.updatedAt = nowAt;
        return { changed: true };
      }

      const action = applyAction(room, player, String(input.action ?? ''), nowAt);
      if (action.error) throw httpError(action.error, 409);
      const changed = Boolean(advanced || action.changed);
      if (changed) room.updatedAt = nowAt;
      return { changed, note: action.note };
    });

    return json({ room: publicRoom(result.room, now()), note: result.note ?? null }, 200);
  }

  async function mutateRoom(store, code, mutator) {
    const key = `${ROOM_KEY_PREFIX}${code}`;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const entry = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
      if (!entry) throw httpError('Room not found. Check the code and try again.', 404);
      const room = entry.data;
      const nowAt = now();
      if (room.expiresAt <= nowAt) throw httpError('This room has expired. Start a new cup.', 410);
      const result = mutator(room, nowAt) ?? {};
      if (!result.changed) return { room, note: result.note };
      room.updatedAt ??= nowAt;
      const saved = await store.setJSON(key, room, { onlyIfMatch: entry.etag });
      if (saved.modified) return { room, note: result.note };
    }
    throw httpError('The room is busy. Please retry that action.', 409);
  }
}

function normalizeCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!ROOM_CODE_RE.test(code)) throw httpError('Enter the 5-character room code.', 400);
  return code;
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
