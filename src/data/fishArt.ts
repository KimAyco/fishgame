/** Per-species look for the generated fish sprites. Pure data, so it can be tested without Phaser. */

export const FISH_SHAPES = [
  'round', // bluegill, perch, snapper
  'deep', // carp, koi, bass
  'slim', // trout, salmon, mackerel, sardine...
  'torpedo', // tuna
  'long', // pike
  'gar',
  'eel',
  'catfish',
  'sturgeon',
  'sword',
  'squid',
  'turtle',
] as const;
export type FishShape = (typeof FISH_SHAPES)[number];

export const FISH_PATTERNS = ['none', 'bars', 'spots', 'lateral', 'patches', 'scales'] as const;
export type FishPattern = (typeof FISH_PATTERNS)[number];

export interface FishArt {
  shape: FishShape;
  /** dark top, mid flank, light belly: the body is shaded in these three tones */
  back: number;
  flank: number;
  belly: number;
  fin: number;
  pattern: FishPattern;
  /** colour of the pattern marks (stripe, spots, patches, scutes, finlets) */
  accent: number;
  /** body height multiplier, 1 by default */
  bulk?: number;
  /** tall sail-like dorsal fin (grayling) */
  sail?: boolean;
}

const a = (shape: FishShape, back: number, flank: number, belly: number, fin: number, pattern: FishPattern, accent: number, extra: Partial<FishArt> = {}): FishArt => ({
  shape, back, flank, belly, fin, pattern, accent, ...extra,
});

export const FISH_ART: Record<string, FishArt> = {
  // Calm Pond
  bluegill: a('round', 0x4a6a3a, 0x6fa3a8, 0xe8924a, 0x6a8a5a, 'bars', 0x3a5a4a),
  perch: a('round', 0x4a6a2a, 0xc8b040, 0xf0e090, 0xe0603a, 'bars', 0x2a3a1a),
  carp: a('deep', 0x8a6a2a, 0xc89a3a, 0xe8cc7a, 0xa87a2a, 'scales', 0x7a5a1a),
  bass: a('deep', 0x3a5a2a, 0x7a9a4a, 0xe0e8b0, 0x5a7a3a, 'lateral', 0x24361a),
  catfish: a('catfish', 0x4a4a54, 0x7a7a88, 0xc8c8cc, 0x5a5a66, 'spots', 0x2e2e36),
  goldkoi: a('deep', 0xe8a828, 0xffd54a, 0xfff0b0, 0xffe28a, 'patches', 0xfffaf0),

  // River Bend
  chub: a('slim', 0x5a6a5a, 0xaab4a4, 0xe8eadc, 0x9a8a6a, 'scales', 0x7a8a7a, { bulk: 1.05 }),
  trout: a('slim', 0x5a7a5a, 0xa0b898, 0xeef0d8, 0xb0a890, 'lateral', 0xe8909e),
  grayling: a('slim', 0x6a6a8a, 0xa8a8c8, 0xe0e0ee, 0x8a6aa8, 'spots', 0x3a3a5a, { sail: true }),
  salmon: a('slim', 0x4a5a6a, 0xd88a70, 0xf6d8cc, 0x7a6a6a, 'spots', 0x30303a, { bulk: 1.15 }),
  pike: a('long', 0x3a6a4a, 0x6a9a5a, 0xe0e8c0, 0x7a8a4a, 'spots', 0xc8d890),
  sturgeon: a('sturgeon', 0x4a5a66, 0x7a8a99, 0xd8dcd8, 0x6a7a88, 'none', 0xb4bcc4),

  // Ocean Pier
  sardine: a('slim', 0x2a5a8a, 0xb8d0e0, 0xf0f4f4, 0x7a9ab8, 'spots', 0x1a3a5a, { bulk: 0.8 }),
  mackerel: a('slim', 0x1f6a8a, 0x9ad0d8, 0xeef6f6, 0x3a7a9a, 'bars', 0x0a2a3a, { bulk: 0.95 }),
  snapper: a('round', 0xc8403a, 0xe06a5a, 0xf6c0b0, 0xd8503f, 'none', 0xffffff, { bulk: 1.05 }),
  tuna: a('torpedo', 0x14305a, 0x5a7aa0, 0xd8e4ee, 0x2a4a7a, 'none', 0xe0c030),
  swordfish: a('sword', 0x2a3a5a, 0x5a70a0, 0xc0cce0, 0x3a4a70, 'none', 0xffffff),
  squid: a('squid', 0xa04a8a, 0xd070b0, 0xf0b8dc, 0xb85aa0, 'spots', 0xf8e0f0),

  // Misty Swamp
  mudloach: a('long', 0x6a5a30, 0xa8905a, 0xe0d090, 0x8a7a48, 'spots', 0x3a2e14, { bulk: 0.8 }),
  bullhead: a('catfish', 0x4a3a20, 0x7a6a40, 0xd8c890, 0x5a4a28, 'none', 0x2a2010, { bulk: 0.9 }),
  swampeel: a('eel', 0x3a4a22, 0x6a7a3a, 0xc8c880, 0x5a6a2e, 'none', 0x2a3418),
  gar: a('gar', 0x4a6a40, 0x8aa060, 0xe0e0b0, 0x6a8a48, 'spots', 0x2a3a24),
  snapper2: a('turtle', 0x4a5a2a, 0x7a8a40, 0xc8b878, 0x6a7a38, 'none', 0x2e3a18),
  ghosteel: a('eel', 0xa8d8e8, 0xd8f4fc, 0xf6ffff, 0xc0ecf6, 'none', 0xffffff),
};
