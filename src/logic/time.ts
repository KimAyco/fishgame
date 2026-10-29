import type { TimeOfDay, Weather } from '../types';
import { mulberry32 } from './rng';

/** One in-game day lasts 8 real minutes. */
export const DAY_MS = 8 * 60_000;
export const START_HOUR = 7;
const WEATHER_SLOT_MS = 150_000;

export function gameHour(elapsedMs: number): number {
  return (START_HOUR + ((elapsedMs % DAY_MS) / DAY_MS) * 24) % 24;
}

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 18) return 'day';
  if (hour >= 18 && hour < 21) return 'dusk';
  return 'night';
}

export function weatherAt(elapsedMs: number): Weather {
  const slot = Math.floor(elapsedMs / WEATHER_SLOT_MS);
  const r = mulberry32(slot * 7919 + 13)();
  if (r < 0.6) return 'clear';
  if (r < 0.85) return 'rain';
  return 'fog';
}
