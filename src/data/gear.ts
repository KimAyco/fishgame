import type { BaitDef, RodDef } from '../types';

export let RODS: RodDef[] = [
  { id: 'stick', name: 'Stick Rod', price: 0, minLevel: 1, biteSpeed: 1.0, barSize: 0.22 },
  { id: 'bamboo', name: 'Bamboo Rod', price: 80, minLevel: 2, biteSpeed: 1.2, barSize: 0.26 },
  { id: 'fiberglass', name: 'Fiberglass Rod', price: 300, minLevel: 4, biteSpeed: 1.5, barSize: 0.3 },
  { id: 'carbon', name: 'Carbon Rod', price: 900, minLevel: 8, biteSpeed: 1.9, barSize: 0.34 },
  { id: 'mythril', name: 'Mythril Rod', price: 2500, minLevel: 12, biteSpeed: 2.4, barSize: 0.38 },
];

export let BAITS: BaitDef[] = [
  { id: 'dough', name: 'Dough', price: 0, pack: 0, biteSpeed: 1.0, rarityBias: 1.0 },
  { id: 'worm', name: 'Worm', price: 10, pack: 5, biteSpeed: 1.3, rarityBias: 1.3 },
  { id: 'minnow', name: 'Minnow', price: 25, pack: 5, biteSpeed: 1.5, rarityBias: 1.8 },
  { id: 'glowfly', name: 'Glowfly', price: 60, pack: 5, biteSpeed: 2.0, rarityBias: 3.0 },
];

export let ROD_BY_ID: Record<string, RodDef> = Object.fromEntries(RODS.map((x) => [x.id, x]));
export let BAIT_BY_ID: Record<string, BaitDef> = Object.fromEntries(BAITS.map((x) => [x.id, x]));

export function setGearCatalog(rods: RodDef[], baits: BaitDef[]): void {
  const rodIds = new Set(rods.map((rod) => rod.id));
  const baitIds = new Set(baits.map((bait) => bait.id));
  if (
    rodIds.size !== rods.length ||
    baitIds.size !== baits.length ||
    !rodIds.has('stick') ||
    !baitIds.has('dough') ||
    rods.some((rod) => !Number.isFinite(rod.price) || !Number.isFinite(rod.minLevel)) ||
    baits.some((bait) => !Number.isFinite(bait.price) || !Number.isFinite(bait.pack))
  ) {
    throw new Error('Gear catalog contains invalid entries');
  }
  RODS = rods;
  BAITS = baits;
  ROD_BY_ID = Object.fromEntries(rods.map((rod) => [rod.id, rod]));
  BAIT_BY_ID = Object.fromEntries(baits.map((bait) => [bait.id, bait]));
}
