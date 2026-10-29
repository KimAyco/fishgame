import { mulberry32 } from '../logic/rng';
import type { MapDef, Side } from '../types';

export const TILE = 16;

export const T = {
  GRASS: 0,
  WATER: 1,
  DEEP: 2,
  SAND: 3,
  PATH: 4,
  WOOD: 5,
  MUD: 6,
  SHOP: 7,
  DOOR: 8,
  TREE: 9,
  ROCK: 10,
} as const;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const SOLID = new Set<number>([T.WATER, T.DEEP, T.SHOP, T.DOOR, T.TREE, T.ROCK]);
export const isSolid = (t: number): boolean => SOLID.has(t);
export const isWater = (t: number): boolean => t === T.WATER || t === T.DEEP;

export interface Pt {
  x: number;
  y: number;
}

export interface GenExit {
  side: Side;
  to: string;
  /** border tiles; stepping on one travels to the linked map */
  tiles: Pt[];
  /** where a player arriving through this exit is placed */
  inner: Pt;
  /** direction the arriving player faces */
  dir: Dir;
}

export interface GeneratedMap {
  w: number;
  h: number;
  tiles: number[][];
  flowers: { x: number; y: number; c: number }[];
  spawn: Pt & { dir: Dir };
  /** top-left tile of the 3x2 shop building and the walkable tile in front of its door */
  shop: { x: number; y: number; front: Pt };
  exits: GenExit[];
}

export function exitGeometry(w: number, h: number, side: Side): { tiles: Pt[]; inner: Pt; dir: Dir } {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  switch (side) {
    case 'w':
      return { tiles: [-1, 0, 1].map((o) => ({ x: 0, y: cy + o })), inner: { x: 2, y: cy }, dir: 'right' };
    case 'e':
      return { tiles: [-1, 0, 1].map((o) => ({ x: w - 1, y: cy + o })), inner: { x: w - 3, y: cy }, dir: 'left' };
    case 'n':
      return { tiles: [-1, 0, 1].map((o) => ({ x: cx + o, y: 0 })), inner: { x: cx, y: 2 }, dir: 'down' };
    case 's':
      return { tiles: [-1, 0, 1].map((o) => ({ x: cx + o, y: h - 1 })), inner: { x: cx, y: h - 3 }, dir: 'up' };
  }
}

interface Layout {
  shop: Pt;
  scan: Pt & { dir: Dir };
}

const LAYOUTS: Record<MapDef['kind'], Layout> = {
  pond: { shop: { x: 8, y: 20 }, scan: { x: 6, y: 12, dir: 'right' } },
  river: { shop: { x: 8, y: 6 }, scan: { x: 6, y: 16, dir: 'right' } },
  ocean: { shop: { x: 12, y: 38 }, scan: { x: 40, y: 44, dir: 'up' } },
  swamp: { shop: { x: 10, y: 8 }, scan: { x: 8, y: 30, dir: 'right' } },
};

export function generateMap(def: MapDef): GeneratedMap {
  const { w, h } = def.size;
  const rng = mulberry32(def.seed);
  const phase = def.seed % 7;
  const base = def.kind === 'swamp' ? T.MUD : T.GRASS;
  const layout = LAYOUTS[def.kind];

  const tiles: number[][] = Array.from({ length: h }, () => Array<number>(w).fill(base));
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const get = (x: number, y: number): number => (inb(x, y) ? tiles[y][x] : T.TREE);
  const set = (x: number, y: number, t: number) => {
    if (inb(x, y)) tiles[y][x] = t;
  };

  // --- water ---------------------------------------------------------------
  const blob = (cx: number, cy: number, rx: number, ry: number, s: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const a = Math.atan2(dy, dx);
        const r = 1 + 0.12 * Math.sin(3 * a + s) + 0.08 * Math.sin(5 * a + 2 * s);
        if (dx * dx + dy * dy < r * r) set(x, y, T.WATER);
      }
    }
  };

  switch (def.kind) {
    case 'pond':
      blob(38, 12, 17, 10, phase);
      break;
    case 'river':
      for (let y = 0; y < h; y++) {
        const cx = 40 + 6 * Math.sin(y / 6.4 + phase);
        for (let x = 0; x < w; x++) if (Math.abs(x - cx) < 5) set(x, y, T.WATER);
      }
      break;
    case 'ocean':
      for (let x = 0; x < w; x++) {
        const shore = 26 + 4 * Math.sin(x / 8 + phase) + 2 * Math.sin(x / 3.4 + phase * 2);
        for (let y = 0; y < h; y++) if (y < shore) set(x, y, T.WATER);
      }
      break;
    case 'swamp':
      blob(40, 30, 15, 10, phase);
      for (let i = 0; i < 16; i++) {
        const r = 2.5 + rng() * 4;
        blob(20 + rng() * 44, 10 + rng() * 36, r, r * 0.8, rng() * 6);
      }
      break;
  }

  // keep the shop surroundings dry
  const shop = layout.shop;
  for (let y = shop.y - 2; y <= shop.y + 4; y++) for (let x = shop.x - 2; x <= shop.x + 4; x++) set(x, y, base);

  // --- deep water: no land within 2 tiles ------------------------------------
  const wet = (x: number, y: number) => !inb(x, y) || isWater(tiles[y][x]);
  const deep: Pt[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWater(tiles[y][x])) continue;
      let all = true;
      for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2 && all; dx++) if (!wet(x + dx, y + dy)) all = false;
      if (all) deep.push({ x, y });
    }
  }
  for (const p of deep) set(p.x, p.y, T.DEEP);

  // --- sand shore --------------------------------------------------------------
  if (def.kind !== 'swamp') {
    const sand: Pt[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tiles[y][x] !== T.GRASS) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) if (inb(x + dx, y + dy) && isWater(tiles[y + dy][x + dx])) near = true;
        if (near) sand.push({ x, y });
      }
    }
    for (const p of sand) set(p.x, p.y, T.SAND);
  }

  // --- trees, rocks, flowers -----------------------------------------------------
  const flowers: GeneratedMap['flowers'] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y][x] !== base) continue;
      const border = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      const r = rng();
      if (border && r < 0.85) set(x, y, T.TREE);
      else if (!border && r < 0.05) set(x, y, T.TREE);
      else if (!border && r < 0.07) set(x, y, T.ROCK);
      else if (base === T.GRASS && rng() < 0.06) flowers.push({ x, y, c: Math.floor(rng() * 3) });
    }
  }

  // --- spawn: walk the scan line until water --------------------------------------
  const sd = DIRS[layout.scan.dir];
  let sx = layout.scan.x;
  let sy = layout.scan.y;
  for (let i = 0; i < 60; i++) {
    const nx = sx + sd.dx;
    const ny = sy + sd.dy;
    if (!inb(nx, ny) || isWater(tiles[ny][nx])) break;
    sx = nx;
    sy = ny;
  }
  const shore: Pt = { x: sx, y: sy };

  // --- paths ---------------------------------------------------------------------
  const front: Pt = { x: shop.x + 1, y: shop.y + 2 };
  const lay = (x: number, y: number) => {
    const t = get(x, y);
    if (!inb(x, y) || t === T.WOOD) return;
    set(x, y, isWater(t) ? T.WOOD : T.PATH);
  };
  const route = (a: Pt, b: Pt, order: 'hv' | 'vh') => {
    let x = a.x;
    let y = a.y;
    lay(x, y);
    const stepH = () => {
      while (x !== b.x) {
        x += Math.sign(b.x - x);
        lay(x, y);
      }
    };
    const stepV = () => {
      while (y !== b.y) {
        y += Math.sign(b.y - y);
        lay(x, y);
      }
    };
    if (order === 'hv') {
      stepH();
      stepV();
    } else {
      stepV();
      stepH();
    }
  };

  const exits: GenExit[] = def.exits.map((e) => {
    const g = exitGeometry(w, h, e.side);
    for (const p of g.tiles) lay(p.x, p.y);
    const edge = g.tiles[1];
    route(edge, g.inner, e.side === 'n' || e.side === 's' ? 'vh' : 'hv');
    route(g.inner, front, e.side === 'n' || e.side === 's' ? 'vh' : 'hv');
    return { side: e.side, to: e.to, tiles: g.tiles, inner: g.inner, dir: g.dir };
  });
  route(shore, front, 'vh');

  // --- dock: from the shore into the water; the player spawns at its end ------------
  const DOCK_LEN = 4;
  for (let i = 0; i <= DOCK_LEN; i++) set(shore.x + sd.dx * i, shore.y + sd.dy * i, T.WOOD);
  const spawn = { x: shore.x + sd.dx * DOCK_LEN, y: shore.y + sd.dy * DOCK_LEN, dir: layout.scan.dir };

  // --- shop building ------------------------------------------------------------------
  for (let y = shop.y; y < shop.y + 2; y++) for (let x = shop.x; x < shop.x + 3; x++) set(x, y, T.SHOP);
  set(shop.x + 1, shop.y + 1, T.DOOR);

  return { w, h, tiles, flowers, spawn, shop: { x: shop.x, y: shop.y, front }, exits };
}
