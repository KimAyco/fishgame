/** Multiplayer server URL. Use wss:// in production and ws:// locally. */
const fromEnv = import.meta.env.VITE_COLYSEUS_URL;
const raw = (fromEnv ?? (import.meta.env.DEV ? 'ws://localhost:2567' : '')).trim().replace(/\/+$/, '');

/** ws:// or wss:// URL of the Colyseus server. */
export const SERVER_WS_URL = raw;

/** The same server over http(s), for public server endpoints. */
export const SERVER_HTTP_URL = raw.replace(/^ws/, 'http');

export const MULTIPLAYER_AVAILABLE = raw !== '';

const apiFromEnv = import.meta.env.VITE_GAME_API_URL;
const apiRaw = (apiFromEnv ?? (import.meta.env.DEV ? 'http://localhost/image%20generator/APIdatabase' : '')).trim();

/** Base URL of the PHP game API; no trailing slash. */
export const GAME_API_URL = apiRaw.replace(/\/+$/, '');
export const GAME_API_AVAILABLE = GAME_API_URL !== '';
