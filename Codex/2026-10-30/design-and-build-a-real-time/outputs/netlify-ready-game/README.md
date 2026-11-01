# Turbo Cup — Netlify Drop

This project keeps Turbo Cup’s racing screen and scoring while moving room state into a Netlify Function and Netlify Blobs. The game uses the default function address `/.netlify/functions/game`; it has no always-on server, external database, account system, or user-provided secrets.

## Publish without a terminal

1. Extract `netlify-ready-game.zip` in File Explorer so you have the `netlify-ready-game` folder.
2. Sign in to Netlify and open its drag-and-drop publisher.
3. Drop the extracted project folder. Netlify detects the project, installs the locked dependencies, builds the site and function, and publishes them together.
4. Open the published site. Create a room and share its five-character code. Other drivers open that same site on their own devices and enter the code.

Netlify provisions the Blobs store when the function first uses it. No database setup or environment variables are needed.

## Included

- `index.html` — game frontend, including Monaco, Silverstone, and Monza scenes.
- `netlify/functions/game.ts` — standard Netlify Function entry point.
- `src/` — game rules, scoring, room API, and conditional Blob update helper.
- `netlify.toml`, `package.json`, `pnpm-lock.yaml`, and `.node-version` — build and runtime configuration.
- `tests/` — complete two-player, three-round scoring and winner test.

The room store uses strong consistency. Room creation uses `onlyIfNew`; room changes use ETag guarded `onlyIfMatch` writes with retry on a concurrent update.
