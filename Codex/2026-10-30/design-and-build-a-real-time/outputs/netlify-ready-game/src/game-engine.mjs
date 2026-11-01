import { randomBytes, randomUUID } from 'node:crypto';

export const RACE_DURATIONS_MS = [25_000, 25_000, 30_000];
export const SUDDEN_DEATH_MS = 12_000;
const PLACE_POINTS = [10, 7, 5, 4, 3, 2, 1, 1];
const ROOM_TTL_MS = 4 * 60 * 60 * 1000;

export const makePlayerId = () => randomUUID();
export const makeToken = () => randomBytes(32).toString('base64url');
export const makeRoomCode = () => randomBytes(4).toString('hex').slice(0, 5).toUpperCase();

export function createRoom({ code, name, playerId = makePlayerId(), token = makeToken(), now = Date.now() }) {
  const player = { id: playerId, name: cleanName(name), score: 0, distance: 0, boostAt: 0, lastDriveAt: 0, token };
  return {
    code,
    hostId: playerId,
    phase: 'lobby',
    round: 0,
    phaseEndsAt: 0,
    winnerId: null,
    players: [player],
    roundResults: [],
    expiresAt: now + ROOM_TTL_MS,
    updatedAt: now,
  };
}

export function cleanName(value) {
  const name = String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18);
  return name || 'Driver';
}

export function startGame(room, now = Date.now()) {
  if (!['lobby', 'results'].includes(room.phase)) return { error: 'The race has already started.' };
  if (room.players.length < 2) return { error: 'Invite at least one more driver first.' };
  room.round = 1;
  room.phase = 'race';
  room.phaseEndsAt = now + RACE_DURATIONS_MS[0];
  room.winnerId = null;
  room.roundResults = [];
  for (const player of room.players) {
    player.score = 0;
    player.distance = 0;
    player.boostAt = 0;
    player.lastDriveAt = 0;
  }
  return { changed: true };
}

export function applyAction(room, player, action, now = Date.now()) {
  if (!['race', 'sudden'].includes(room.phase)) return { error: 'This race is not accepting driving controls.' };
  if (action === 'drive') {
    if (now - player.lastDriveAt < 130) return { changed: false };
    player.lastDriveAt = now;
    player.distance += 1.25;
    return { changed: true };
  }
  if (action === 'boost') {
    if (now - player.boostAt < 5_000) return { changed: false, note: 'Boost is recharging.' };
    player.boostAt = now;
    player.distance += 8;
    return { changed: true };
  }
  return { error: 'Unknown action.' };
}

export function advanceRoom(room, now = Date.now()) {
  if (!['race', 'sudden'].includes(room.phase) || now < room.phaseEndsAt) return false;

  if (room.phase === 'race') {
    const ranking = [...room.players].sort((a, b) => b.distance - a.distance || a.name.localeCompare(b.name));
    const multiplier = room.round === 3 ? 2 : 1;
    const placements = ranking.map((player, index) => {
      const points = (PLACE_POINTS[index] ?? 1) * multiplier;
      player.score += points;
      return { playerId: player.id, place: index + 1, points, distance: Math.round(player.distance * 100) / 100 };
    });
    room.roundResults.push({ round: room.round, placements });

    if (room.round < 3) {
      room.round += 1;
      room.phaseEndsAt = now + RACE_DURATIONS_MS[room.round - 1];
      resetDistances(room.players);
      return true;
    }

    const scoreOrder = [...room.players].sort((a, b) => b.score - a.score);
    if (scoreOrder.length > 1 && scoreOrder[0].score === scoreOrder[1].score) {
      room.phase = 'sudden';
      room.phaseEndsAt = now + SUDDEN_DEATH_MS;
      resetDistances(room.players);
      return true;
    }

    room.phase = 'results';
    room.phaseEndsAt = 0;
    room.winnerId = scoreOrder[0]?.id ?? null;
    return true;
  }

  const tiedPlayers = room.players.filter(player => player.score === Math.max(...room.players.map(item => item.score)));
  const finishOrder = [...tiedPlayers].sort((a, b) => b.distance - a.distance || a.name.localeCompare(b.name));
  if (finishOrder.length === 1 || finishOrder[0].distance > finishOrder[1].distance) {
    room.winnerId = finishOrder[0].id;
    finishOrder[0].score += 1;
    room.phase = 'results';
    room.phaseEndsAt = 0;
    return true;
  }
  room.phaseEndsAt = now + SUDDEN_DEATH_MS;
  for (const player of tiedPlayers) {
    player.distance = 0;
    player.boostAt = 0;
    player.lastDriveAt = 0;
  }
  return true;
}

function resetDistances(players) {
  for (const player of players) {
    player.distance = 0;
    player.boostAt = 0;
    player.lastDriveAt = 0;
  }
}

export function publicRoom(room, now = Date.now()) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    remainingSeconds: room.phaseEndsAt ? Math.max(0, Math.ceil((room.phaseEndsAt - now) / 1000)) : 0,
    winnerId: room.winnerId,
    roundResults: room.roundResults,
    players: [...room.players]
      .sort((a, b) => room.phase === 'results' ? b.score - a.score : 0)
      .map(({ id, name, score, distance, boostAt }) => ({ id, name, score, distance, dist: distance, boostAt })),
  };
}
