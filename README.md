# Pixel Fishing

A top-down pixel-art fishing game in the browser (TypeScript, Phaser 3, Vite). Walk a world of four
maps, cast and reel in 24 kinds of fish, sell them, upgrade your gear, and fish together with friends
over a realtime Colyseus server.

## Play locally

    npm install
    npm run dev          # http://localhost:5173 (or the next free port)

Controls: WASD or arrows to walk, SPACE to cast (hold and release), hook and reel, and to open the shop
at its door. B changes bait, F opens the fish book, M the world map. Online: 1 to 4 for emotes, Enter to chat.

Single-player works on its own. Online play needs the server in the `colysues` repo.

## Multiplayer

The game connects to a Colyseus server (`colysues`, hosted on Render). Set its address when building:

| where                   | how                                                                    |
| ----------------------- | ---------------------------------------------------------------------- |
| `npm run dev`           | defaults to `ws://localhost:2567`, so run the server next to it        |
| a build or Vercel       | set `VITE_COLYSEUS_URL=wss://<your-service>.onrender.com`              |
| no URL set in a build   | the game runs single-player and the title screen says so               |

See `.env.example`. In the game, the title screen has a name field, an optional **room code** (friends
who type the same code share a private room) and an **Online** switch. Everything the server and game
say to each other is documented in the server's README ("realtime player API").

What other players see of you: where you stand, the way you face, walking, your name, your fishing rod
and float, emotes and chat. Your catches, coins and gear stay in your own browser save.

The free Render tier sleeps when idle, so the first connection after a quiet spell can take up to a
minute. The title screen wakes it as soon as it opens, and the game keeps trying and tells you so.

To run both locally:

    cd ../colysues && npm install && npm start      # server on :2567
    cd ../game && npm run dev                       # game

## Deploy on Vercel

1. Import this repository (`KimAyco/fishgame`) in Vercel. It detects Vite: build `npm run build`, output `dist`.
2. Add the environment variable `VITE_COLYSEUS_URL` = `wss://<your-service>.onrender.com`
   (it must be `wss://`, because the site is served over https). Variables are read at build time, so redeploy after changing it.
3. On the Render service, set `ALLOWED_ORIGINS` to your Vercel URL so the browser may call the server.

## Scripts

    npm run dev        start the dev server
    npm run build      type-check and build to dist/
    npm test           unit tests (game logic, map generation, fish art, multiplayer helpers)
    npm run typecheck  TypeScript only

## Layout

    src/scenes/   Title, WorldMap, Fishing (the walkable world), Shop, Book
    src/logic/    fishing, economy, time, clock (shared world clock), interpolate (smooth remote players)
    src/world/    map generator, tile and fish art, the shared fishing-rod drawing
    src/net/      NetClient (the server connection), protocol, preferences, remote players
    src/data/     maps, fish, gear, per-fish art specs
    tests/        vitest
