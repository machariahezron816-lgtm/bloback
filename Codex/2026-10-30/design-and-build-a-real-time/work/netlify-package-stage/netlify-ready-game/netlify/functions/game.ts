import { getStore } from '@netlify/blobs';
import { createGameApi } from '../../src/game-api.mjs';

const handleGameRequest = createGameApi(() =>
  getStore({ name: 'turbo-cup-rooms', consistency: 'strong' }),
);

export default async function game(request: Request): Promise<Response> {
  return handleGameRequest(request);
}
