import type { MapDef } from '../types';

export let MAPS: MapDef[] = [
  {
    id: 'pond',
    name: 'Calm Pond',
    description: 'A quiet pond. Good for beginners.',
    unlock: { level: 1, price: 0 },
    zones: [
      { id: 'shallows', name: 'Shallows', from: 0, to: 0.55, fish: ['bluegill', 'perch', 'carp'] },
      { id: 'deep', name: 'Deep Water', from: 0.55, to: 1.01, fish: ['perch', 'bass', 'catfish', 'goldkoi'] },
    ],
    palette: { water: 0x3b8fc4, deep: 0x1f5f94, hills: 0x4f9a46, dock: 0x8a5a2f },
    worldPos: { x: 60, y: 70 },
    kind: 'pond',
    size: { w: 72, h: 52 },
    seed: 11,
    exits: [{ side: 'e', to: 'river' }],
  },
  {
    id: 'river',
    name: 'River Bend',
    description: 'Fast, cold water full of trout and salmon.',
    unlock: { level: 3, price: 150 },
    zones: [
      { id: 'shallows', name: 'Riffles', from: 0, to: 0.5, fish: ['chub', 'trout', 'grayling'] },
      { id: 'deep', name: 'Pool', from: 0.5, to: 1.01, fish: ['trout', 'grayling', 'salmon', 'pike', 'sturgeon'] },
    ],
    palette: { water: 0x4aa3a0, deep: 0x23707a, hills: 0x468e50, dock: 0x7a5530 },
    worldPos: { x: 135, y: 100 },
    kind: 'river',
    size: { w: 80, h: 48 },
    seed: 23,
    exits: [
      { side: 'w', to: 'pond' },
      { side: 'e', to: 'swamp' },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean Pier',
    description: 'Cast past the surf for big game fish.',
    unlock: { level: 6, price: 500 },
    zones: [
      { id: 'shallows', name: 'Surf', from: 0, to: 0.5, fish: ['sardine', 'mackerel', 'snapper'] },
      { id: 'deep', name: 'Open Sea', from: 0.5, to: 1.01, fish: ['mackerel', 'snapper', 'tuna', 'swordfish', 'squid'] },
    ],
    palette: { water: 0x2a6fb5, deep: 0x123e78, hills: 0x5a9a58, dock: 0x9a7a4a },
    worldPos: { x: 250, y: 60 },
    kind: 'ocean',
    size: { w: 80, h: 56 },
    seed: 37,
    exits: [{ side: 's', to: 'swamp' }],
  },
  {
    id: 'swamp',
    name: 'Misty Swamp',
    description: 'Murky water. Something big lurks here.',
    unlock: { level: 9, price: 1200 },
    zones: [
      { id: 'shallows', name: 'Mud Flats', from: 0, to: 0.5, fish: ['mudloach', 'bullhead', 'swampeel'] },
      { id: 'deep', name: 'Black Water', from: 0.5, to: 1.01, fish: ['bullhead', 'swampeel', 'gar', 'snapper2', 'ghosteel'] },
    ],
    palette: { water: 0x4a6a46, deep: 0x24402a, hills: 0x3f6a3a, dock: 0x5a4028 },
    worldPos: { x: 225, y: 118 },
    kind: 'swamp',
    size: { w: 72, h: 56 },
    seed: 53,
    exits: [
      { side: 'w', to: 'river' },
      { side: 'n', to: 'ocean' },
    ],
  },
];

export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map((x) => [x.id, x]));

const KNOWN_TILE_IDS = new Set(Array.from({ length: 14 }, (_, id) => id));

/** Replaces the fallback catalog with validated map data loaded from the game API. */
export function setMapCatalog(maps: MapDef[]): void {
  if (maps.length !== 16 || maps.filter((map) => map.isMarket).length !== 1) {
    throw new Error('Game catalog must contain 15 fishing maps and one market map');
  }
  const ids = new Set<string>();
  for (const map of maps) {
    if (!map.id || ids.has(map.id)) throw new Error(`Invalid or duplicate map id: ${map.id}`);
    ids.add(map.id);
    if (!Number.isInteger(map.size.w) || !Number.isInteger(map.size.h) || map.size.w < 1 || map.size.h < 1) {
      throw new Error(`Invalid map dimensions: ${map.id}`);
    }
    if (!Array.isArray(map.tileGrid) || map.tileGrid.length !== map.size.h) throw new Error(`Invalid tile grid height: ${map.id}`);
    for (const row of map.tileGrid) {
      if (!Array.isArray(row) || row.length !== map.size.w || row.some((tile) => !Number.isInteger(tile) || !KNOWN_TILE_IDS.has(tile))) {
        throw new Error(`Invalid tile grid data: ${map.id}`);
      }
    }
  }

  MAPS = maps;
  for (const id of Object.keys(MAP_BY_ID)) delete MAP_BY_ID[id];
  for (const map of maps) MAP_BY_ID[map.id] = map;
}
