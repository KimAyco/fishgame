import { BAITS } from '../data/gear';
import { FISH_BY_ID } from '../data/fish';
import type { BaitDef, Catch, FishDef, SaveData } from '../types';
import { RARITIES } from './fishing';

export interface BagRow {
  fish: FishDef;
  count: number;
  bestSize: number;
  totalValue: number;
}

/** The bag grouped by species, rarest first, then most valuable first. */
export function groupBag(inventory: Catch[]): BagRow[] {
  const rows = new Map<string, BagRow>();
  for (const c of inventory) {
    const fish = FISH_BY_ID[c.fishId];
    if (!fish) continue;
    const row = rows.get(c.fishId) ?? { fish, count: 0, bestSize: 0, totalValue: 0 };
    row.count++;
    row.bestSize = Math.max(row.bestSize, c.size);
    row.totalValue += c.value;
    rows.set(c.fishId, row);
  }
  return [...rows.values()].sort(
    (a, b) => RARITIES.indexOf(b.fish.rarity) - RARITIES.indexOf(a.fish.rarity) || b.totalValue - a.totalValue,
  );
}

export function bagValue(inventory: Catch[]): number {
  return inventory.reduce((s, c) => s + c.value, 0);
}

export interface BaitRow {
  bait: BaitDef;
  /** Infinity for dough */
  count: number;
  selectable: boolean;
  active: boolean;
}

/** Every bait, with how many are left. Baits with none left can't be selected. */
export function baitRows(d: SaveData): BaitRow[] {
  return BAITS.map((bait) => {
    const count = bait.id === 'dough' ? Infinity : (d.bait[bait.id] ?? 0);
    return { bait, count, selectable: count > 0, active: d.baitId === bait.id };
  });
}
