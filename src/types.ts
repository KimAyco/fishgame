export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'fog';

export interface FishDef {
  id: string;
  name: string;
  rarity: Rarity;
  /** cm */
  minSize: number;
  maxSize: number;
  basePrice: number;
  /** 0..1, how fast the fish moves during the reel minigame */
  speed: number;
  /** 0..1, how often the fish changes direction */
  erratic: number;
  color: number;
  prefersTime?: TimeOfDay[];
  prefersWeather?: Weather[];
}

export interface RodDef {
  id: string;
  name: string;
  price: number;
  minLevel: number;
  /** multiplier on bite speed (higher = shorter waits) */
  biteSpeed: number;
  /** size of the catch bar in the reel minigame, 0..1 of the track */
  barSize: number;
}

export interface BaitDef {
  id: string;
  name: string;
  /** price of a pack */
  price: number;
  pack: number;
  biteSpeed: number;
  /** each rarity tier above common is multiplied by this */
  rarityBias: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  /** cast power range [from, to) */
  from: number;
  to: number;
  fish: string[];
}

export interface MapPalette {
  water: number;
  deep: number;
  hills: number;
  dock: number;
}

export type Side = 'n' | 's' | 'e' | 'w';
export type MapKind = 'pond' | 'river' | 'ocean' | 'swamp';

export interface MapDef {
  id: string;
  name: string;
  description: string;
  unlock: { level: number; price: number };
  /** zones[0] is shallow water, zones[1] is deep water */
  zones: ZoneDef[];
  palette: MapPalette;
  worldPos: { x: number; y: number };
  kind: MapKind;
  /** size in 16px tiles */
  size: { w: number; h: number };
  seed: number;
  /** walk off this edge to travel to the linked map */
  exits: { side: Side; to: string }[];
}

export interface Catch {
  fishId: string;
  size: number;
  quality: number;
  value: number;
}

export interface SaveData {
  coins: number;
  xp: number;
  inventory: Catch[];
  book: Record<string, { count: number; bestSize: number }>;
  rods: string[];
  rod: string;
  bait: Record<string, number>;
  baitId: string;
  maps: string[];
  lastMap: string;
  stats: { casts: number; catches: number; escapes: number };
}
