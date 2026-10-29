import type { BaitDef, RodDef } from '../types';

export const RODS: RodDef[] = [
  { id: 'stick', name: 'Stick Rod', price: 0, minLevel: 1, biteSpeed: 1.0, barSize: 0.22 },
  { id: 'bamboo', name: 'Bamboo Rod', price: 80, minLevel: 2, biteSpeed: 1.2, barSize: 0.26 },
  { id: 'fiberglass', name: 'Fiberglass Rod', price: 300, minLevel: 4, biteSpeed: 1.5, barSize: 0.3 },
  { id: 'carbon', name: 'Carbon Rod', price: 900, minLevel: 8, biteSpeed: 1.9, barSize: 0.34 },
  { id: 'mythril', name: 'Mythril Rod', price: 2500, minLevel: 12, biteSpeed: 2.4, barSize: 0.38 },
];

export const BAITS: BaitDef[] = [
  { id: 'dough', name: 'Dough', price: 0, pack: 0, biteSpeed: 1.0, rarityBias: 1.0 },
  { id: 'worm', name: 'Worm', price: 10, pack: 5, biteSpeed: 1.3, rarityBias: 1.3 },
  { id: 'minnow', name: 'Minnow', price: 25, pack: 5, biteSpeed: 1.5, rarityBias: 1.8 },
  { id: 'glowfly', name: 'Glowfly', price: 60, pack: 5, biteSpeed: 2.0, rarityBias: 3.0 },
];

export const ROD_BY_ID: Record<string, RodDef> = Object.fromEntries(RODS.map((x) => [x.id, x]));
export const BAIT_BY_ID: Record<string, BaitDef> = Object.fromEntries(BAITS.map((x) => [x.id, x]));
