import type { FishDef, Rarity, TimeOfDay, Weather } from '../types';

interface Prefs {
  time?: TimeOfDay[];
  weather?: Weather[];
}

function f(
  id: string,
  name: string,
  rarity: Rarity,
  minSize: number,
  maxSize: number,
  basePrice: number,
  speed: number,
  erratic: number,
  color: number,
  prefs: Prefs = {},
): FishDef {
  return {
    id, name, rarity, minSize, maxSize, basePrice, speed, erratic, color,
    prefersTime: prefs.time,
    prefersWeather: prefs.weather,
  };
}

export const FISH: FishDef[] = [
  // Calm Pond
  f('bluegill', 'Bluegill', 'common', 10, 25, 5, 0.3, 0.3, 0x4f9fd4),
  f('perch', 'Perch', 'common', 15, 35, 7, 0.35, 0.35, 0xd8b23c),
  f('carp', 'Carp', 'uncommon', 30, 80, 18, 0.4, 0.4, 0xc7773a, { time: ['dawn', 'dusk'] }),
  f('bass', 'Largemouth Bass', 'uncommon', 25, 60, 24, 0.5, 0.5, 0x5c9a4a),
  f('catfish', 'Catfish', 'rare', 40, 110, 60, 0.55, 0.45, 0x6b6b7a, { time: ['night'] }),
  f('goldkoi', 'Golden Koi', 'legendary', 40, 90, 400, 0.8, 0.7, 0xffc933, { time: ['dawn'] }),

  // River Bend
  f('chub', 'River Chub', 'common', 15, 40, 9, 0.35, 0.35, 0x9aa7b0),
  f('trout', 'Rainbow Trout', 'common', 20, 55, 14, 0.45, 0.45, 0xe08fa0),
  f('grayling', 'Grayling', 'uncommon', 25, 50, 30, 0.5, 0.5, 0x8d7fd0),
  f('salmon', 'Salmon', 'rare', 50, 100, 85, 0.65, 0.5, 0xf0825a, { weather: ['rain'] }),
  f('pike', 'Northern Pike', 'epic', 60, 130, 190, 0.8, 0.65, 0x3f7f5a),
  f('sturgeon', 'Ancient Sturgeon', 'legendary', 120, 250, 700, 0.7, 0.8, 0x7e8a99, { weather: ['fog'] }),

  // Ocean Pier
  f('sardine', 'Sardine', 'common', 10, 22, 8, 0.4, 0.4, 0xb9d3e0),
  f('mackerel', 'Mackerel', 'common', 25, 45, 16, 0.5, 0.45, 0x3a7ca5),
  f('snapper', 'Red Snapper', 'uncommon', 35, 80, 40, 0.55, 0.5, 0xd9503f),
  f('tuna', 'Bluefin Tuna', 'rare', 100, 250, 140, 0.8, 0.55, 0x22508a),
  f('swordfish', 'Swordfish', 'epic', 150, 400, 320, 0.95, 0.7, 0x5a6fa8, { time: ['dusk', 'night'] }),
  f('squid', 'Giant Squid', 'legendary', 200, 600, 1100, 0.75, 0.9, 0xb04a8a, { time: ['night'] }),

  // Swamp
  f('mudloach', 'Mud Loach', 'common', 10, 30, 12, 0.35, 0.4, 0x8a7a4a),
  f('bullhead', 'Bullhead', 'common', 15, 40, 18, 0.4, 0.45, 0x6a5a3a),
  f('swampeel', 'Swamp Eel', 'uncommon', 40, 100, 55, 0.6, 0.65, 0x4a6a3a),
  f('gar', 'Alligator Gar', 'rare', 80, 220, 170, 0.8, 0.55, 0x5f7a52),
  f('snapper2', 'Snapping Turtle', 'epic', 30, 70, 360, 0.6, 0.8, 0x4a5a2a),
  f('ghosteel', 'Ghost Eel', 'legendary', 80, 200, 1500, 0.95, 0.95, 0xc8f0ff, { time: ['night'], weather: ['fog'] }),
];

export const FISH_BY_ID: Record<string, FishDef> = Object.fromEntries(FISH.map((x) => [x.id, x]));
