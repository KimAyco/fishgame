import { BAIT_BY_ID, ROD_BY_ID } from '../data/gear';
import type { BaitDef, FishDef, MapDef, Rarity, RodDef, SaveData } from '../types';

export const XP_BY_RARITY: Record<Rarity, number> = {
  common: 5,
  uncommon: 12,
  rare: 30,
  epic: 80,
  legendary: 250,
};

export type Result = { ok: true } | { ok: false; reason: string };

export function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(xp / 25)) + 1;
}

export function xpForLevel(level: number): number {
  return (level - 1) ** 2 * 25;
}

export function fishPrice(fish: FishDef, size: number, quality: number): number {
  const norm = (size - fish.minSize) / Math.max(1, fish.maxSize - fish.minSize);
  return Math.max(1, Math.round(fish.basePrice * (0.7 + 0.8 * norm) * (0.85 + 0.3 * quality)));
}

export function defaultSave(): SaveData {
  return {
    coins: 0,
    xp: 0,
    inventory: [],
    book: {},
    rods: ['stick'],
    rod: 'stick',
    bait: {},
    baitId: 'dough',
    maps: ['pond'],
    lastMap: 'pond',
    stats: { casts: 0, catches: 0, escapes: 0 },
  };
}

export interface CatchOutcome {
  value: number;
  isNew: boolean;
  isRecord: boolean;
  xpGained: number;
  leveledUp: boolean;
}

export function recordCatch(d: SaveData, fish: FishDef, size: number, quality: number): CatchOutcome {
  const value = fishPrice(fish, size, quality);
  const prev = d.book[fish.id];
  const isNew = !prev;
  const isRecord = !!prev && size > prev.bestSize;

  d.inventory.push({ fishId: fish.id, size, quality, value });
  d.book[fish.id] = { count: (prev?.count ?? 0) + 1, bestSize: Math.max(prev?.bestSize ?? 0, size) };
  d.stats.catches++;

  const before = levelOf(d.xp);
  const xpGained = Math.round(XP_BY_RARITY[fish.rarity] * (0.7 + 0.6 * quality));
  d.xp += xpGained;
  return { value, isNew, isRecord, xpGained, leveledUp: levelOf(d.xp) > before };
}

export function sellAll(d: SaveData): { count: number; coins: number } {
  const count = d.inventory.length;
  const coins = d.inventory.reduce((s, c) => s + c.value, 0);
  d.coins += coins;
  d.inventory = [];
  return { count, coins };
}

export function buyRod(d: SaveData, rod: RodDef): Result {
  if (d.rods.includes(rod.id)) return { ok: false, reason: 'Already owned' };
  if (levelOf(d.xp) < rod.minLevel) return { ok: false, reason: `Needs level ${rod.minLevel}` };
  if (d.coins < rod.price) return { ok: false, reason: 'Not enough coins' };
  d.coins -= rod.price;
  d.rods.push(rod.id);
  d.rod = rod.id;
  return { ok: true };
}

export function equipRod(d: SaveData, rod: RodDef): Result {
  if (!d.rods.includes(rod.id)) return { ok: false, reason: 'Not owned' };
  d.rod = rod.id;
  return { ok: true };
}

export function buyBait(d: SaveData, bait: BaitDef): Result {
  if (bait.pack <= 0) return { ok: false, reason: 'Not for sale' };
  if (d.coins < bait.price) return { ok: false, reason: 'Not enough coins' };
  d.coins -= bait.price;
  d.bait[bait.id] = (d.bait[bait.id] ?? 0) + bait.pack;
  d.baitId = bait.id;
  return { ok: true };
}

export function selectBait(d: SaveData, bait: BaitDef): Result {
  if (bait.id !== 'dough' && (d.bait[bait.id] ?? 0) <= 0) return { ok: false, reason: 'None left' };
  d.baitId = bait.id;
  return { ok: true };
}

/** Uses one bait for a cast and returns the bait actually used (falls back to dough). */
export function consumeBait(d: SaveData): BaitDef {
  const bait = BAIT_BY_ID[d.baitId] ?? BAIT_BY_ID.dough;
  if (bait.id === 'dough') return bait;
  const left = d.bait[bait.id] ?? 0;
  if (left <= 0) {
    d.baitId = 'dough';
    return BAIT_BY_ID.dough;
  }
  d.bait[bait.id] = left - 1;
  if (left - 1 <= 0) d.baitId = 'dough';
  return bait;
}

export function unlockMap(d: SaveData, map: MapDef): Result {
  if (d.maps.includes(map.id)) return { ok: false, reason: 'Already unlocked' };
  if (levelOf(d.xp) < map.unlock.level) return { ok: false, reason: `Needs level ${map.unlock.level}` };
  if (d.coins < map.unlock.price) return { ok: false, reason: 'Not enough coins' };
  d.coins -= map.unlock.price;
  d.maps.push(map.id);
  return { ok: true };
}

export function currentRod(d: SaveData): RodDef {
  return ROD_BY_ID[d.rod] ?? ROD_BY_ID.stick;
}
