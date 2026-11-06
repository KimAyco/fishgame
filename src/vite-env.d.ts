/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ws:// or wss:// URL of the Colyseus server. */
  readonly VITE_COLYSEUS_URL?: string;
  /** HTTPS base URL for the PHP/MySQL game API. */
  readonly VITE_GAME_API_URL?: string;
}
