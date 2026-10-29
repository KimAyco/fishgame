/** What the game and the Colyseus server say to each other. Mirrors colysues/rooms/FishingRoom.js. */

export type Dir = 'up' | 'down' | 'left' | 'right';
export type FishState = 'idle' | 'charging' | 'casting' | 'waiting' | 'bite' | 'reeling';

/** One player as it appears in the room state. */
export interface PlayerState {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  name: string;
  hue: number;
  state: FishState;
  bx: number;
  by: number;
}

/** Options sent when joining. `code` is empty for the public room of a map. */
export interface JoinOptions {
  mapId: string;
  code: string;
  name: string;
  x: number;
  y: number;
}

export interface MovePayload {
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
}

export interface FishPayload {
  state: FishState;
  bx: number;
  by: number;
}

export interface MapCount {
  id: string;
  players: number;
  rooms: number;
}

/** The server accepts about 40 messages a second; 15 position updates a second is plenty. */
export const MOVE_INTERVAL_MS = 66;
export const FISH_INTERVAL_MS = 120;

export const EMOTES = ['wave', 'heart', 'fish', '?'] as const;

/** Emote glyphs drawn above a head. The game font has no emoji, so these are plain characters. */
export const EMOTE_GLYPH = ['o/', '<3', '><>', '?'] as const;

// Control and zero-width characters, line separators and angle brackets, built from code points.
const CONTROL = new RegExp(
  '[' + [[0, 31], [127, 159], [0x200b, 0x200f], [0x2028, 0x202e]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + '<>]',
  'g',
);

/** Same cleaning the server does, so what you type is what others see. */
export function cleanName(raw: string): string {
  return raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

/** Room codes are upper-case letters and digits, at most 12. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/** Maps the scene's fishing phase to what other players are told. The catch popup counts as idle. */
export function toFishState(phase: string): FishState {
  switch (phase) {
    case 'charging':
    case 'casting':
    case 'waiting':
    case 'bite':
    case 'reeling':
      return phase;
    default:
      return 'idle';
  }
}

/** Positions are sent to a tenth of a pixel; more precision only costs bandwidth. */
export const roundPos = (v: number): number => Math.round(v * 10) / 10;

/**
 * Rate limiter for outgoing messages: allows a send when `minInterval` ms have passed and the
 * payload differs from the last one sent.
 */
export class SendThrottle<T> {
  private last: T | null = null;
  private lastAt = -Infinity;

  constructor(
    private readonly minIntervalMs: number,
    private readonly same: (a: T, b: T) => boolean,
  ) {}

  /** True if `value` should be sent now (and records it as sent). */
  shouldSend(value: T, nowMs: number): boolean {
    if (nowMs - this.lastAt < this.minIntervalMs) return false;
    if (this.last !== null && this.same(this.last, value)) return false;
    this.last = value;
    this.lastAt = nowMs;
    return true;
  }

  /** Forget the last send, so the next value goes out even if unchanged. */
  reset(): void {
    this.last = null;
    this.lastAt = -Infinity;
  }
}
