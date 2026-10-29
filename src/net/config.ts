/**
 * Where the multiplayer server lives, from the build environment:
 *   VITE_COLYSEUS_URL=wss://your-service.onrender.com   (set it in the Vercel project settings)
 * `npm run dev` falls back to a local server. With no URL the game simply runs single-player.
 */
const fromEnv = import.meta.env.VITE_COLYSEUS_URL;
const raw = (fromEnv ?? (import.meta.env.DEV ? 'ws://localhost:2567' : '')).trim().replace(/\/+$/, '');

/** ws:// or wss:// URL of the Colyseus server, or '' when multiplayer is not configured. */
export const SERVER_WS_URL = raw;

/** The same server over http(s), for the REST endpoints (/health, /api/maps). */
export const SERVER_HTTP_URL = raw.replace(/^ws/, 'http');

export const MULTIPLAYER_AVAILABLE = raw !== '';
