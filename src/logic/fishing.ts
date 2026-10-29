import { FISH_BY_ID } from '../data/fish';
import type { BaitDef, FishDef, MapDef, Rarity, RodDef, TimeOfDay, Weather, ZoneDef } from '../types';
import type { Rng } from './rng';

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 100,
  uncommon: 40,
  rare: 15,
  epic: 4,
  legendary: 1,
};

export interface FishContext {
  rod: RodDef;
  bait: BaitDef;
  time: TimeOfDay;
  weather: Weather;
}

/** Seconds the player has to hook once the bobber dips. */
export const HOOK_WINDOW = 1.2;

export function zoneAt(map: MapDef, power: number): ZoneDef {
  return map.zones.find((z) => power >= z.from && power < z.to) ?? map.zones[map.zones.length - 1];
}

/** Shallow tiles use zones[0], deep tiles use zones[1]. */
export function zoneForDepth(map: MapDef, deep: boolean): ZoneDef {
  return map.zones[deep ? 1 : 0] ?? map.zones[map.zones.length - 1];
}

export function biteDelay(rng: Rng, ctx: Pick<FishContext, 'rod' | 'bait' | 'weather'>): number {
  const base = 2.5 + rng() * 6.5;
  const weatherMod = ctx.weather === 'rain' ? 0.8 : 1;
  return (base * weatherMod) / (ctx.rod.biteSpeed * ctx.bait.biteSpeed);
}

export function fishWeights(zone: ZoneDef, ctx: FishContext): { fish: FishDef; weight: number }[] {
  return zone.fish.map((id) => {
    const fish = FISH_BY_ID[id];
    const tier = RARITIES.indexOf(fish.rarity);
    let weight = RARITY_WEIGHT[fish.rarity] * Math.pow(ctx.bait.rarityBias, tier);
    if (fish.prefersTime) weight *= fish.prefersTime.includes(ctx.time) ? 2.5 : 0.3;
    if (fish.prefersWeather) weight *= fish.prefersWeather.includes(ctx.weather) ? 2 : 0.6;
    return { fish, weight };
  });
}

export function rollFish(rng: Rng, zone: ZoneDef, ctx: FishContext): FishDef {
  const entries = fishWeights(zone, ctx);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.fish;
  }
  return entries[entries.length - 1].fish;
}

/** Bell-ish distribution between min and max, in whole cm. */
export function rollSize(rng: Rng, fish: FishDef): number {
  const t = (rng() + rng()) / 2;
  return Math.round(fish.minSize + (fish.maxSize - fish.minSize) * t);
}

export interface ReelState {
  /** 0..1 position of the fish along the track */
  fish: number;
  target: number;
  retarget: number;
  /** 0..1 position of the bottom of the catch bar */
  bar: number;
  vel: number;
  progress: number;
  overlapTime: number;
  time: number;
}

export type ReelStatus = 'ongoing' | 'won' | 'lost';

export function newReel(): ReelState {
  return { fish: 0.5, target: 0.5, retarget: 0.6, bar: 0.4, vel: 0, progress: 0.3, overlapTime: 0, time: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function stepReel(s: ReelState, holding: boolean, dt: number, fish: FishDef, barSize: number, rng: Rng): ReelStatus {
  s.time += dt;

  s.retarget -= dt;
  if (s.retarget <= 0) {
    s.target = rng();
    s.retarget = (1.6 - 1.2 * fish.erratic) * (0.6 + rng() * 0.8);
  }
  const maxMove = fish.speed * 0.5 * dt;
  s.fish += clamp(s.target - s.fish, -maxMove, maxMove);

  s.vel = clamp(s.vel + (holding ? 3.0 : -2.4) * dt, -1.1, 1.1);
  s.bar += s.vel * dt;
  const top = 1 - barSize;
  if (s.bar < 0) {
    s.bar = 0;
    s.vel = Math.abs(s.vel) * 0.25;
  } else if (s.bar > top) {
    s.bar = top;
    s.vel = -Math.abs(s.vel) * 0.25;
  }

  const inside = s.fish >= s.bar && s.fish <= s.bar + barSize;
  if (inside) {
    s.progress += 0.28 * dt;
    s.overlapTime += dt;
  } else {
    s.progress -= 0.16 * dt;
  }

  if (s.progress >= 1) return 'won';
  if (s.progress <= 0) return 'lost';
  return 'ongoing';
}

/** 0..1 fraction of the fight the bar was on the fish. */
export function reelQuality(s: ReelState): number {
  return s.time > 0 ? clamp(s.overlapTime / s.time, 0, 1) : 0;
}
