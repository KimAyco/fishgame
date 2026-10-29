/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** wss:// URL of the Colyseus server; empty or unset means single-player only. */
  readonly VITE_COLYSEUS_URL?: string;
}
