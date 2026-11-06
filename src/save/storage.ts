import { defaultSave } from '../logic/economy';
import type { SaveData } from '../types';

/** Where the player stood when they left the world scene (for shop/book/map round trips). Not saved to disk. */
export const session: { pos?: { mapId: string; x: number; y: number; dir: string } } = {};

/** Mutable singleton shared by all scenes. */
export const store: { data: SaveData } = { data: defaultSave() };
