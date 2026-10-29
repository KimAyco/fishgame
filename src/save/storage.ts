import { defaultSave } from '../logic/economy';
import type { SaveData } from '../types';

const KEY = 'pixel-fishing-save-v1';

/** Where the player stood when they left the world scene (for shop/book/map round trips). Not saved to disk. */
export const session: { pos?: { mapId: string; x: number; y: number; dir: string } } = {};

/** Mutable singleton shared by all scenes. */
export const store: { data: SaveData } = { data: defaultSave() };

export function loadGame(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) store.data = { ...defaultSave(), ...JSON.parse(raw) };
  } catch {
    store.data = defaultSave();
  }
}

export function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store.data));
  } catch {
    /* storage unavailable; play on without saving */
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function resetGame(): void {
  store.data = defaultSave();
  persist();
}
