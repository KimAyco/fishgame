import Phaser from 'phaser';
import { FISH } from '../data/fish';
import { FISH_ART, FishArt, FishShape } from '../data/fishArt';
import { lerpColor } from '../ui/ui';

/** Sprite canvas in game pixels; fish face right. */
export const FISH_W = 56;
export const FISH_H = 28;

const OUTLINE = 0x1b1712;
const SILHOUETTE = 0x3f3424;

const dark = (c: number, t = 0.2) => lerpColor(c, 0x000000, t);
const light = (c: number, t = 0.2) => lerpColor(c, 0xffffff, t);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

// ---- pixel canvas ---------------------------------------------------------------------------

class Canvas {
  readonly px = new Int32Array(FISH_W * FISH_H).fill(-1);

  /** Colour at a pixel, or -1 when empty or out of range. */
  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= FISH_W || y >= FISH_H ? -1 : this.px[y * FISH_W + x];
  }

  set(x: number, y: number, color: number): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix >= 1 && iy >= 1 && ix < FISH_W - 1 && iy < FISH_H - 1) this.px[iy * FISH_W + ix] = color;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: number): void {
    const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
    for (let y = Math.floor(Math.min(y1, y2, y3)); y <= Math.ceil(Math.max(y1, y2, y3)); y++) {
      for (let x = Math.floor(Math.min(x1, x2, x3)); x <= Math.ceil(Math.max(x1, x2, x3)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const d1 = sign(px, py, x1, y1, x2, y2);
        const d2 = sign(px, py, x2, y2, x3, y3);
        const d3 = sign(px, py, x3, y3, x1, y1);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) this.set(x, y, color);
      }
    }
  }

  /** Bresenham line; with `only` set, just recolours pixels that currently have that colour. */
  line(x1: number, y1: number, x2: number, y2: number, color: number, only?: number): void {
    let x = Math.round(x1);
    let y = Math.round(y1);
    const ex = Math.round(x2);
    const ey = Math.round(y2);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (only === undefined || this.get(x, y) === only) this.set(x, y, color);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Adds a 1px dark outline around everything drawn so far. */
  outline(): void {
    const add: number[] = [];
    for (let y = 0; y < FISH_H; y++) {
      for (let x = 0; x < FISH_W; x++) {
        if (this.get(x, y) !== -1) continue;
        if (this.get(x + 1, y) !== -1 || this.get(x - 1, y) !== -1 || this.get(x, y + 1) !== -1 || this.get(x, y - 1) !== -1) add.push(y * FISH_W + x);
      }
    }
    for (const i of add) this.px[i] = OUTLINE;
  }
}

// ---- bodies ---------------------------------------------------------------------------------

interface BodySpec {
  x0: number;
  x1: number;
  cy: number;
  top: (u: number) => number;
  bot: (u: number) => number;
  wave?: (u: number) => number;
  /** minimum half-height at the nose, so heads are blunt rather than pointed */
  nose?: number;
}

interface Body {
  x0: number;
  x1: number;
  xAt: (u: number) => number;
  uAt: (x: number) => number;
  topY: (u: number) => number;
  botY: (u: number) => number;
}

function makeBody(s: BodySpec): Body {
  const wave = s.wave ?? (() => 0);
  const nose = (u: number) => (s.nose ?? 0) * Math.pow(clamp(u, 0, 1), 5);
  return {
    x0: s.x0,
    x1: s.x1,
    xAt: (u) => s.x0 + u * (s.x1 - s.x0),
    uAt: (x) => (x - s.x0) / (s.x1 - s.x0),
    topY: (u) => s.cy + wave(u) - Math.max(s.top(u), nose(u)),
    botY: (u) => s.cy + wave(u) + Math.max(s.bot(u), nose(u)),
  };
}

/** Half-height curve: narrow at the tail, widest around the middle, blunt at the nose. */
const bell = (u: number, k: number) => Math.pow(Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), k)), 0.6);
const profile = (height: number, peduncle: number, k: number) => (u: number) => peduncle + (height - peduncle) * bell(u, k);

function bodyColor(art: FishArt, u: number, v: number, x: number, y: number, row: number): number {
  let c: number;
  if (v < 0.3) c = v > 0.24 && (x + y) % 2 === 0 ? art.flank : art.back;
  else if (v < 0.68) c = v > 0.62 && (x + y) % 2 === 0 ? art.belly : art.flank;
  else c = art.belly;

  switch (art.pattern) {
    case 'bars':
      if (u > 0.18 && u < 0.82 && v < 0.82 && x % 6 < 2) c = lerpColor(c, art.accent, 0.6);
      break;
    case 'spots':
      if (u > 0.08 && v < 0.8 && hash(x, y) % 11 === 0) c = art.accent;
      break;
    case 'lateral':
      if (u > 0.1 && u < 0.9 && v > 0.4 && v < 0.56) c = art.accent;
      break;
    case 'patches':
      if (Math.sin(u * 9 + 1.2) * Math.cos(v * 4 + u * 3) > 0.28) c = art.accent;
      break;
    case 'scales':
      if (v < 0.85 && (x + (y & 1) * 2) % 4 === 0) c = dark(c, 0.13);
      break;
    case 'none':
      break;
  }
  if (row === 1 && u > 0.25 && u < 0.62) c = light(c, 0.2); // a little gloss along the back
  return c;
}

function paintBody(cv: Canvas, art: FishArt, b: Body): void {
  for (let x = Math.ceil(b.x0); x <= Math.floor(b.x1); x++) {
    const u = b.uAt(x);
    const yA = Math.round(b.topY(u));
    const yB = Math.round(b.botY(u));
    for (let y = yA; y <= yB; y++) {
      const v = yB === yA ? 0.5 : (y - yA) / (yB - yA);
      cv.set(x, y, bodyColor(art, u, v, x, y, y - yA));
    }
  }
}

// ---- fins -----------------------------------------------------------------------------------

type FinKind = 'soft' | 'spiny' | 'sail';

/** A fin running along the back (dir -1) or belly (dir 1) between u = ua and ub. */
function strip(cv: Canvas, art: FishArt, b: Body, ua: number, ub: number, h: number, dir: -1 | 1, kind: FinKind): void {
  const xa = Math.round(b.xAt(ua));
  const xb = Math.round(b.xAt(ub));
  for (let x = xa; x <= xb; x++) {
    const t = (x - xa) / Math.max(1, xb - xa);
    const u = b.uAt(x);
    let hh: number;
    if (kind === 'soft') hh = h * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9)), 0.8);
    else if (kind === 'spiny') hh = h * (1 - 0.3 * t) * (x % 2 === 0 ? 1 : 0.72);
    else hh = h * Math.max(0.15, 1 - 0.85 * t * t);
    const base = Math.round(dir < 0 ? b.topY(u) : b.botY(u));
    const n = Math.max(1, Math.round(hh));
    for (let k = 0; k <= n; k++) {
      const c = k === n ? light(art.fin, 0.2) : x % 2 === 0 ? art.fin : dark(art.fin, 0.12);
      cv.set(x, base + dir * k, c);
    }
  }
}

type TailKind = 'fork' | 'round' | 'lunate' | 'hetero';

function tail(cv: Canvas, art: FishArt, x0: number, cy: number, kind: TailKind, s: number): void {
  const f = art.fin;
  const ray = dark(f, 0.22);
  if (kind === 'fork') {
    cv.tri(x0 + 2, cy - 1.5, x0 - s, cy - s * 0.95, x0 - s * 0.35, cy, f);
    cv.tri(x0 + 2, cy + 1.5, x0 - s, cy + s * 0.95, x0 - s * 0.35, cy, f);
    cv.tri(x0 + 2, cy - 1.5, x0 + 2, cy + 1.5, x0 - s * 0.35, cy, f);
    cv.line(x0 + 1, cy - 1, x0 - s + 1, cy - s * 0.85, ray, f);
    cv.line(x0 + 1, cy + 1, x0 - s + 1, cy + s * 0.85, ray, f);
  } else if (kind === 'round') {
    cv.tri(x0 + 2, cy - 1.2, x0 - s * 0.8, cy - s * 0.85, x0 - s, cy, f);
    cv.tri(x0 + 2, cy + 1.2, x0 - s * 0.8, cy + s * 0.85, x0 - s, cy, f);
    cv.tri(x0 + 2, cy - 1.2, x0 + 2, cy + 1.2, x0 - s, cy, f);
    cv.line(x0, cy, x0 - s + 1, cy, ray, f);
    cv.line(x0, cy - 1, x0 - s * 0.7, cy - s * 0.6, ray, f);
    cv.line(x0, cy + 1, x0 - s * 0.7, cy + s * 0.6, ray, f);
  } else if (kind === 'lunate') {
    cv.tri(x0 + 2, cy - 1.5, x0 - s * 0.9, cy - s * 1.35, x0 - s * 0.1, cy, f);
    cv.tri(x0 + 2, cy + 1.5, x0 - s * 0.9, cy + s * 1.35, x0 - s * 0.1, cy, f);
    cv.tri(x0 + 2, cy - 1.5, x0 + 2, cy + 1.5, x0 - s * 0.1, cy, f);
  } else {
    // heterocercal: the upper lobe is longer
    cv.tri(x0 + 2, cy - 1.2, x0 - s * 1.1, cy - s * 1.2, x0 - s * 0.2, cy, f);
    cv.tri(x0 + 2, cy + 1.2, x0 - s * 0.6, cy + s * 0.7, x0 - s * 0.1, cy, f);
    cv.tri(x0 + 2, cy - 1.2, x0 + 2, cy + 1.2, x0 - s * 0.2, cy, f);
  }
}

function pelvic(cv: Canvas, art: FishArt, b: Body, u: number, size: number): void {
  const x = Math.round(b.xAt(u));
  const y = Math.round(b.botY(u));
  cv.tri(x + 2, y - 1, x - 1, y - 1, x - size * 0.9, y + size * 0.9, art.fin);
}

function pectoral(cv: Canvas, art: FishArt, b: Body, u: number, size: number): void {
  const x = Math.round(b.xAt(u));
  const y = Math.round(b.topY(u) + (b.botY(u) - b.topY(u)) * 0.55);
  const col = light(art.fin, 0.12);
  cv.tri(x + 1, y - 1, x + 1, y + 1, x - size, y + size * 0.55, col);
  // only the trailing edge gets a line; two would cut the body in half
  cv.line(x - size, y + size * 0.55, x + 1, y + 1, dark(art.fin, 0.22));
}

// ---- face -----------------------------------------------------------------------------------

function eye(cv: Canvas, x: number, y: number, size: number): void {
  if (size >= 3) {
    // a ring without its corners, so the eye reads as round
    cv.rect(x, y - 1, 3, 1, OUTLINE);
    cv.rect(x, y + 3, 3, 1, OUTLINE);
    cv.rect(x - 1, y, 1, 3, OUTLINE);
    cv.rect(x + 3, y, 1, 3, OUTLINE);
    cv.rect(x, y, 3, 3, 0xffffff);
    cv.rect(x + 1, y + 1, 2, 2, 0x0a0a0a);
    cv.set(x, y, 0xffffff);
  } else {
    cv.rect(x, y, 2, 2, 0xffffff);
    cv.rect(x + 1, y, 1, 2, 0x0a0a0a);
  }
}

interface FaceSpec {
  eye: number;
  eyeU: number;
  mouth: number;
  gillU: number;
}

function face(cv: Canvas, art: FishArt, b: Body, f: FaceSpec): void {
  // gill cover: a curved line behind the head
  const gx = Math.round(b.xAt(f.gillU));
  const top = b.topY(f.gillU);
  const bottom = b.botY(f.gillU);
  // the cover only reaches about three quarters of the way down, as a short soft curve
  const y0 = Math.round(top) + 2;
  const y1 = Math.round(top + (bottom - top) * 0.74);
  const mid = (y0 + y1) / 2;
  const half = Math.max(1, (y1 - y0) / 2);
  for (let y = y0; y <= y1; y++) {
    const off = Math.round(1.2 * Math.pow((y - mid) / half, 2));
    if (cv.get(gx + off, y) !== -1) cv.set(gx + off, y, dark(art.flank, 0.3));
  }
  // mouth
  const my = Math.round(b.topY(0.97) + (b.botY(0.97) - b.topY(0.97)) * 0.62);
  for (let i = 0; i < f.mouth; i++) {
    const x = Math.round(b.x1) - i;
    if (cv.get(x, my) !== -1) cv.set(x, my, dark(art.back, 0.55));
  }
  const ex = Math.round(b.xAt(f.eyeU));
  const ey = Math.round(b.topY(f.eyeU) + (b.botY(f.eyeU) - b.topY(f.eyeU)) * 0.34);
  eye(cv, ex, ey, f.eye);
}

// ---- ordinary (fusiform) fish ---------------------------------------------------------------

interface Fusiform {
  x0: number;
  x1: number;
  height: number;
  heightBelow: number;
  k: number;
  peduncle: number;
  nose?: number;
  top?: (u: number) => number;
  bot?: (u: number) => number;
  tail: TailKind;
  tailSize: number;
  dorsal: [number, number, number, FinKind][];
  anal?: [number, number, number];
  pelvic?: [number, number];
  pect: [number, number];
  face: FaceSpec;
  finlets?: boolean;
  barbels?: boolean;
  adipose?: boolean;
  scutes?: boolean;
  bill?: number;
}

const snoutCurve = (body: (u: number) => number, to: number, tipHeight: number) => (u: number) =>
  u < to ? body(u / to) : tipHeight + (body(1) - tipHeight) * Math.max(0, 1 - (u - to) / (1 - to));

const FUSIFORM: Partial<Record<FishShape, Fusiform>> = {
  round: {
    x0: 10, x1: 46, height: 8.5, heightBelow: 9.5, k: 0.95, peduncle: 1.4, nose: 2.6,
    tail: 'fork', tailSize: 7,
    dorsal: [[0.22, 0.5, 4, 'spiny'], [0.5, 0.78, 5, 'soft']],
    anal: [0.3, 0.48, 3.5], pelvic: [0.6, 3.5], pect: [0.7, 5],
    face: { eye: 2, eyeU: 0.86, mouth: 3, gillU: 0.7 },
  },
  deep: {
    x0: 9, x1: 47, height: 10, heightBelow: 10, k: 0.85, peduncle: 1.6, nose: 3,
    tail: 'fork', tailSize: 8,
    dorsal: [[0.2, 0.8, 4.5, 'soft']],
    anal: [0.26, 0.42, 3.5], pelvic: [0.55, 3.5], pect: [0.68, 5],
    face: { eye: 2, eyeU: 0.88, mouth: 2, gillU: 0.7 },
  },
  slim: {
    x0: 8, x1: 48, height: 5.8, heightBelow: 6.2, k: 1, peduncle: 1.2, nose: 2,
    tail: 'fork', tailSize: 8,
    dorsal: [[0.38, 0.6, 4.5, 'soft']],
    anal: [0.3, 0.45, 3], pelvic: [0.55, 3], pect: [0.7, 4.5],
    face: { eye: 2, eyeU: 0.88, mouth: 3, gillU: 0.72 },
  },
  torpedo: {
    x0: 9, x1: 48, height: 8, heightBelow: 8, k: 0.8, peduncle: 1.1, nose: 2,
    tail: 'lunate', tailSize: 8,
    dorsal: [[0.38, 0.55, 5, 'spiny'], [0.2, 0.28, 3, 'soft']],
    anal: [0.2, 0.28, 3], pelvic: [0.5, 3], pect: [0.66, 6],
    face: { eye: 3, eyeU: 0.88, mouth: 3, gillU: 0.74 },
    finlets: true,
  },
  long: {
    x0: 6, x1: 50, height: 4.6, heightBelow: 4.8, k: 0.95, peduncle: 1.2, nose: 2,
    tail: 'fork', tailSize: 6,
    dorsal: [[0.08, 0.28, 5, 'soft']],
    anal: [0.1, 0.26, 4], pelvic: [0.45, 3], pect: [0.7, 4],
    face: { eye: 2, eyeU: 0.86, mouth: 8, gillU: 0.76 },
  },
  gar: {
    x0: 5, x1: 52, height: 3.8, heightBelow: 4, k: 1, peduncle: 1,
    top: snoutCurve(profile(3.8, 1, 1), 0.8, 1),
    bot: snoutCurve(profile(4, 1, 1), 0.8, 1),
    tail: 'round', tailSize: 6,
    dorsal: [[0.08, 0.24, 4, 'soft']],
    anal: [0.1, 0.24, 3.5], pelvic: [0.5, 2.5], pect: [0.66, 3.5],
    face: { eye: 2, eyeU: 0.7, mouth: 7, gillU: 0.62 },
  },
  sturgeon: {
    x0: 6, x1: 52, height: 5.6, heightBelow: 4.6, k: 0.9, peduncle: 1.2,
    top: snoutCurve(profile(5.6, 1.2, 0.9), 0.8, 1.1),
    bot: snoutCurve(profile(4.6, 1.2, 0.9), 0.8, 0.9),
    tail: 'hetero', tailSize: 8,
    dorsal: [[0.1, 0.26, 5, 'soft']],
    anal: [0.12, 0.26, 3.5], pelvic: [0.42, 3], pect: [0.6, 5],
    face: { eye: 2, eyeU: 0.66, mouth: 2, gillU: 0.58 },
    scutes: true,
  },
  catfish: {
    x0: 9, x1: 47, height: 6.5, heightBelow: 5.5, k: 2.2, peduncle: 1.2, nose: 3.5,
    tail: 'round', tailSize: 6,
    dorsal: [[0.5, 0.6, 5, 'spiny']],
    anal: [0.12, 0.45, 3.5], pelvic: [0.4, 2.5], pect: [0.72, 5],
    face: { eye: 2, eyeU: 0.9, mouth: 4, gillU: 0.78 },
    barbels: true, adipose: true,
  },
  sword: {
    x0: 9, x1: 42, height: 6.8, heightBelow: 6.2, k: 0.8, peduncle: 1.1, nose: 1.5,
    tail: 'lunate', tailSize: 8,
    dorsal: [[0.34, 0.6, 9, 'sail']],
    anal: [0.2, 0.3, 3], pelvic: [0.5, 4], pect: [0.66, 6],
    face: { eye: 3, eyeU: 0.86, mouth: 1, gillU: 0.74 },
    bill: 12,
  },
};

function drawFusiform(cv: Canvas, art: FishArt, f: Fusiform): void {
  const bulk = art.bulk ?? 1;
  const cy = 14;
  const topFn = f.top ?? profile(f.height * bulk, f.peduncle, f.k);
  const botFn = f.bot ?? profile(f.heightBelow * bulk, f.peduncle, f.k);
  const b = makeBody({ x0: f.x0, x1: f.x1, cy, top: topFn, bot: botFn, nose: f.nose });

  tail(cv, art, f.x0, cy, f.tail, f.tailSize);
  const dorsals: [number, number, number, FinKind][] = art.sail ? [[0.34, 0.64, 8, 'sail']] : f.dorsal;
  for (const [ua, ub, h, kind] of dorsals) strip(cv, art, b, ua, ub, h * (kind === 'sail' ? 1 : bulk), -1, kind);
  if (f.anal) strip(cv, art, b, f.anal[0], f.anal[1], f.anal[2], 1, 'soft');
  if (f.pelvic) pelvic(cv, art, b, f.pelvic[0], f.pelvic[1]);

  if (f.bill) {
    const y = Math.round((b.topY(1) + b.botY(1)) / 2);
    const bill = dark(art.back, 0.15);
    cv.rect(Math.round(b.x1) - 2, y - 1, f.bill * 0.7, 2, bill);
    cv.rect(Math.round(b.x1) - 2 + f.bill * 0.7, y, f.bill * 0.3 + 2, 1, bill);
  }
  if (f.barbels) {
    const x = Math.round(b.x1);
    const y = Math.round((b.topY(1) + b.botY(1)) / 2);
    const w = art.flank;
    cv.line(x, y + 1, x + 5, y + 2, w);
    cv.line(x - 1, y + 3, x + 3, y + 7, w);
    cv.line(x, y - 1, x + 5, y - 3, w);
  }
  if (f.adipose) cv.tri(b.xAt(0.2), b.topY(0.2) + 1, b.xAt(0.12), b.topY(0.12) - 3, b.xAt(0.06), b.topY(0.06) + 1, art.fin);

  paintBody(cv, art, b);

  if (f.finlets) {
    for (let x = Math.round(b.xAt(0.06)); x <= Math.round(b.xAt(0.18)); x += 2) {
      cv.set(x, b.topY(b.uAt(x)) - 1, art.accent);
      cv.set(x, b.botY(b.uAt(x)) + 1, art.accent);
    }
  }
  if (f.scutes) {
    for (let x = Math.round(b.xAt(0.1)); x <= Math.round(b.xAt(0.7)); x += 3) {
      const u = b.uAt(x);
      cv.set(x, Math.round(b.topY(u)) + 1, art.accent);
      cv.set(x, Math.round(b.topY(u) + (b.botY(u) - b.topY(u)) * 0.5), art.accent);
    }
  }
  face(cv, art, b, f.face);
  pectoral(cv, art, b, f.pect[0], f.pect[1]);
}

// ---- eels, squid, turtle -----------------------------------------------------------------------

function drawEel(cv: Canvas, art: FishArt): void {
  const cy = 14;
  const wave = (u: number) => 3.2 * Math.sin(u * 8 + 0.6) * (0.35 + 0.65 * u);
  const thick = (u: number) => 0.7 + 2.1 * Math.pow(Math.sin(Math.PI * Math.min(0.98, 0.08 + u * 0.9)), 0.5);
  const b = makeBody({ x0: 4, x1: 51, cy, top: thick, bot: thick, wave });
  strip(cv, art, b, 0.06, 0.72, 2, -1, 'soft');
  strip(cv, art, b, 0.1, 0.7, 1.6, 1, 'soft');
  paintBody(cv, art, b);
  face(cv, art, b, { eye: 2, eyeU: 0.94, mouth: 3, gillU: 0.85 });
  pectoral(cv, art, b, 0.86, 3);
}

function drawSquid(cv: Canvas, art: FishArt): void {
  const cy = 14;
  // fins at the pointed end of the mantle
  cv.tri(7, cy, 17, cy - 8, 19, cy - 2, art.fin);
  cv.tri(7, cy, 17, cy + 8, 19, cy + 2, art.fin);
  cv.line(8, cy, 16, cy - 6, dark(art.fin, 0.2), art.fin);
  cv.line(8, cy, 16, cy + 6, dark(art.fin, 0.2), art.fin);

  const mantle = makeBody({ x0: 8, x1: 33, cy, top: (u) => 0.5 + 5.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + u * 0.8)), 0.7), bot: (u) => 0.5 + 5.5 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.05 + u * 0.8)), 0.7) });
  paintBody(cv, art, mantle);

  // head
  for (let y = cy - 5; y <= cy + 5; y++) {
    const half = Math.round(4.2 * Math.sqrt(1 - Math.pow((y - cy) / 5.6, 2)));
    for (let x = 33 - 1; x <= 37 + half - 1; x++) cv.set(x, y, y < cy - 2 ? art.back : art.flank);
  }
  eye(cv, 37, cy - 3, 3);

  // arms and the two long feeding tentacles
  for (let i = -2; i <= 3; i++) {
    const y0 = cy + i * 1.3 - 0.5;
    const y1 = cy + i * 2.8 - 0.5 + Math.sin(i) * 1.5;
    cv.line(41, y0, 50, y1, i % 2 === 0 ? art.flank : art.belly);
  }
  cv.line(41, cy - 2, 53, cy - 7, art.belly);
  cv.line(41, cy + 3, 53, cy + 8, art.belly);
  cv.rect(52, cy - 8, 2, 2, art.accent);
  cv.rect(52, cy + 7, 2, 2, art.accent);
}

function drawTurtle(cv: Canvas, art: FishArt): void {
  const cy = 14;
  const skin = lerpColor(art.belly, art.back, 0.45);
  const shellDark = art.back;
  const shell = art.flank;

  // tail with a ridge, then legs
  cv.tri(5, cy + 1, 15, cy - 2, 15, cy + 4, skin);
  for (let x = 7; x <= 13; x += 2) cv.set(x, cy - 1 + (x - 7) * 0.1, shellDark);
  cv.rect(30, 21, 4, 6, skin);
  cv.rect(14, 21, 4, 6, skin);
  cv.set(33, 26, art.belly);
  cv.set(17, 26, art.belly);

  // neck and head
  cv.rect(36, cy - 3, 7, 6, skin);
  for (let y = cy - 5; y <= cy + 3; y++) {
    const half = Math.round(5 * Math.sqrt(1 - Math.pow((y - (cy - 1)) / 4.6, 2)));
    for (let x = 45 - half; x <= 45 + half; x++) cv.set(x, y, skin);
  }
  cv.tri(49, cy - 3, 54, cy - 1, 49, cy + 1, light(skin, 0.25));
  cv.set(52, cy - 1, dark(skin, 0.5));
  eye(cv, 46, cy - 4, 2);

  // shell: a dome with scute lines and a lighter rim
  for (let y = cy - 9; y <= cy + 8; y++) {
    const t = (y - cy) / 9;
    const half = Math.round(13.5 * Math.sqrt(Math.max(0, 1 - t * t)));
    for (let x = 24 - half; x <= 24 + half; x++) {
      const v = (y - (cy - 9)) / 17;
      let c = v < 0.35 ? shellDark : v < 0.8 ? shell : light(shell, 0.12);
      if (((x - 11) % 6 === 0 || (y - 6) % 5 === 0) && v < 0.85) c = dark(c, 0.25);
      if (v < 0.15 && x > 18 && x < 28) c = light(c, 0.2);
      cv.set(x, y, c);
    }
  }
}

// ---- entry points -------------------------------------------------------------------------------

/** Draws one fish into a pixel canvas, outline included. */
export function renderFish(art: FishArt): Canvas {
  const cv = new Canvas();
  if (art.shape === 'eel') drawEel(cv, art);
  else if (art.shape === 'squid') drawSquid(cv, art);
  else if (art.shape === 'turtle') drawTurtle(cv, art);
  else drawFusiform(cv, art, FUSIFORM[art.shape] ?? FUSIFORM.slim!);
  cv.outline();
  return cv;
}

/**
 * Creates the textures `fish_<id>` (full colour) and `fishsil_<id>` (single dark tone, for fish not
 * yet caught) for every species. Safe to call repeatedly.
 */
export function ensureFishSprites(scene: Phaser.Scene): void {
  for (const fish of FISH) {
    const art = FISH_ART[fish.id];
    if (!art || scene.textures.exists(`fish_${fish.id}`)) continue;
    const cv = renderFish(art);
    for (const [key, flat] of [[`fish_${fish.id}`, false], [`fishsil_${fish.id}`, true]] as const) {
      const g = scene.make.graphics({}, false);
      for (let y = 0; y < FISH_H; y++) {
        for (let x = 0; x < FISH_W; x++) {
          const c = cv.px[y * FISH_W + x];
          if (c === -1) continue;
          g.fillStyle(flat ? SILHOUETTE : c, 1);
          g.fillRect(x, y, 1, 1);
        }
      }
      g.generateTexture(key, FISH_W, FISH_H);
      g.destroy();
    }
  }
}
