import Phaser from 'phaser';
import { mulberry32, Rng } from '../logic/rng';
import type { MapDef } from '../types';
import { lerpColor } from '../ui/ui';
import type { Dir } from './mapgen';

export const WATER_FRAMES = 8;

type Draw = (g: Phaser.GameObjects.Graphics) => void;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

const px = (g: Phaser.GameObjects.Graphics, color: number, x: number, y: number, w = 1, h = 1, a = 1) => {
  g.fillStyle(color, a);
  g.fillRect(x, y, w, h);
};

const speckle = (g: Phaser.GameObjects.Graphics, rng: Rng, n: number, color: number, size = 1) => {
  for (let i = 0; i < n; i++) px(g, color, Math.floor(rng() * (16 - size + 1)), Math.floor(rng() * (16 - size + 1)), size, size);
};

const dark = (c: number, t = 0.2) => lerpColor(c, 0x000000, t);
const light = (c: number, t = 0.2) => lerpColor(c, 0xffffff, t);

/** Creates every texture the world scene needs for the given map. Safe to call repeatedly. */
export function ensureTextures(scene: Phaser.Scene, map: MapDef): void {
  const id = map.id;
  const pal = map.palette;

  // ground
  for (let v = 0; v < 3; v++) {
    make(scene, `grass_${id}_${v}`, 16, 16, (g) => {
      const rng = mulberry32(map.seed * 31 + v);
      px(g, pal.hills, 0, 0, 16, 16);
      speckle(g, rng, 14, dark(pal.hills, 0.14));
      speckle(g, rng, 8, light(pal.hills, 0.14));
      for (let i = 0; i < 3; i++) {
        const x = 1 + Math.floor(rng() * 13);
        const y = 2 + Math.floor(rng() * 12);
        px(g, light(pal.hills, 0.28), x, y - 1, 1, 2);
        px(g, light(pal.hills, 0.28), x + 1, y, 1, 1);
      }
    });
    const mud = lerpColor(pal.hills, 0x6b5a3a, 0.75);
    make(scene, `mud_${id}_${v}`, 16, 16, (g) => {
      const rng = mulberry32(map.seed * 17 + v);
      px(g, mud, 0, 0, 16, 16);
      speckle(g, rng, 16, dark(mud, 0.22));
      speckle(g, rng, 6, light(mud, 0.12));
      speckle(g, rng, 2, pal.hills, 2);
    });
  }

  // water: WATER_FRAMES-frame seamless loop. Wave strokes drift 2px per frame (wrapping the tile),
  // their brightness pulses, and a few sparkles blink in and out.
  const waterTex = (key: string, color: number, f: number) =>
    make(scene, key, 16, 16, (g) => {
      const rng = mulberry32(map.seed * 13);
      px(g, color, 0, 0, 16, 16);
      speckle(g, rng, 6, dark(color, 0.12));
      for (let i = 0; i < 4; i++) {
        const x0 = Math.floor(rng() * 16);
        const y = 1 + Math.floor(rng() * 14);
        const len = 3 + (i % 2);
        const pulse = 0.5 + 0.5 * Math.sin((f / WATER_FRAMES) * Math.PI * 2 + i * 1.7);
        const c = light(color, 0.16 + 0.2 * pulse);
        for (let d = 0; d < len; d++) px(g, c, (x0 + f * 2 + d) % 16, y);
      }
      for (let i = 0; i < 3; i++) {
        const sx = Math.floor(rng() * 16);
        const sy = Math.floor(rng() * 16);
        const on = (f + i * 3) % WATER_FRAMES;
        if (on < 2) px(g, 0xffffff, sx, sy, 1, 1, on === 0 ? 0.55 : 0.3);
      }
    });
  for (let f = 0; f < WATER_FRAMES; f++) {
    waterTex(`water_${id}_${f}`, pal.water, f);
    waterTex(`deep_${id}_${f}`, pal.deep, f);
  }

  // trees tinted by the map
  make(scene, `tree_${id}`, 16, 32, (g) => {
    const leaf = pal.hills;
    px(g, 0x6b4423, 6, 20, 4, 11);
    px(g, 0x4a2e16, 9, 20, 1, 11);
    px(g, 0x3a2410, 5, 30, 6, 2);
    g.fillStyle(dark(leaf, 0.45), 1);
    g.fillCircle(8, 12, 8);
    g.fillCircle(4, 17, 5);
    g.fillCircle(12, 17, 5);
    g.fillStyle(dark(leaf, 0.2), 1);
    g.fillCircle(8, 11, 7);
    g.fillCircle(4, 16, 4);
    g.fillCircle(12, 16, 4);
    g.fillStyle(light(leaf, 0.1), 1);
    g.fillCircle(6, 8, 3);
    g.fillCircle(11, 10, 2);
    px(g, light(leaf, 0.3), 5, 6, 2, 1);
  });

  // shared textures
  for (let v = 0; v < 2; v++) {
    make(scene, `sand_${v}`, 16, 16, (g) => {
      const rng = mulberry32(5 + v);
      px(g, 0xe8d392, 0, 0, 16, 16);
      speckle(g, rng, 14, 0xd4ba74);
      speckle(g, rng, 6, 0xf6e8b4);
    });
    make(scene, `path_${v}`, 16, 16, (g) => {
      const rng = mulberry32(9 + v);
      px(g, 0xb8935a, 0, 0, 16, 16);
      speckle(g, rng, 14, 0x9c7a44);
      speckle(g, rng, 6, 0xcfae78);
    });
  }

  make(scene, 'wood', 16, 16, (g) => {
    px(g, 0xa87444, 0, 0, 16, 16);
    for (let y = 0; y < 16; y += 4) {
      px(g, 0x6e4a26, 0, y + 3, 16, 1);
      px(g, 0xc08a58, 0, y, 16, 1);
    }
    px(g, 0x6e4a26, 3, 0, 1, 16, 0.35);
    px(g, 0x3c2812, 1, 1, 1, 1);
    px(g, 0x3c2812, 14, 5, 1, 1);
    px(g, 0x3c2812, 2, 9, 1, 1);
    px(g, 0x3c2812, 13, 13, 1, 1);
  });

  make(scene, 'rock', 16, 16, (g) => {
    g.fillStyle(0x3a3a46, 1);
    g.fillEllipse(8, 11, 14, 10);
    g.fillStyle(0x7d7f90, 1);
    g.fillEllipse(8, 10, 12, 8);
    g.fillStyle(0xa9acbd, 1);
    g.fillEllipse(6, 8, 5, 3);
  });

  const petals = [0xff6a6a, 0xffe26a, 0xffffff];
  petals.forEach((c, i) =>
    make(scene, `flower_${i}`, 16, 16, (g) => {
      px(g, 0x2f7a2f, 4, 9, 1, 3);
      px(g, c, 3, 8, 3, 1);
      px(g, c, 4, 7, 1, 3);
      px(g, 0xffd34d, 4, 8, 1, 1);
      px(g, 0x2f7a2f, 11, 5, 1, 3);
      px(g, c, 10, 4, 3, 1);
      px(g, c, 11, 3, 1, 3);
      px(g, 0xffd34d, 11, 4, 1, 1);
    }),
  );

  make(scene, 'shop', 48, 32, (g) => {
    // roof
    px(g, 0x7a2a22, 0, 0, 48, 15);
    px(g, 0xb0382c, 0, 0, 48, 12);
    for (let x = 0; x < 48; x += 6) px(g, 0xc84a3c, x, 0, 3, 12);
    px(g, 0x5a1e18, 0, 12, 48, 3);
    // wall
    px(g, 0xd9b98a, 2, 15, 44, 17);
    px(g, 0xb89868, 2, 15, 44, 2);
    for (let y = 19; y < 32; y += 4) px(g, 0xc2a274, 2, y, 44, 1);
    // windows
    for (const wx of [6, 33]) {
      px(g, 0x5a3a1e, wx, 19, 10, 8);
      px(g, 0x9fd8f0, wx + 1, 20, 8, 6);
      px(g, 0xd8f0fa, wx + 1, 20, 3, 2);
      px(g, 0x5a3a1e, wx + 4, 20, 1, 6);
    }
    // door
    px(g, 0x3c2412, 19, 18, 10, 14);
    px(g, 0x6e4426, 20, 19, 8, 13);
    px(g, 0xffd34d, 26, 26, 1, 2);
    // fish sign on the roof
    px(g, 0xf0e0b0, 17, 3, 14, 7);
    px(g, 0x5a3a1e, 17, 3, 14, 1);
    px(g, 0x5a3a1e, 17, 9, 14, 1);
    g.fillStyle(0x3a86d4, 1);
    g.fillEllipse(23, 6.5, 8, 4);
    g.fillTriangle(27, 6.5, 30, 4.5, 30, 8.5);
    px(g, 0xffffff, 20, 5, 1, 1);
  });

  // player: 4 directions x 3 frames (0 idle, 1/2 walking)
  (['down', 'up', 'left', 'right'] as Dir[]).forEach((dir) => {
    for (let f = 0; f < 3; f++) make(scene, `p_${dir}_${f}`, 16, 20, (g) => drawPlayer(g, dir, f));
  });
}

function drawPlayer(g: Phaser.GameObjects.Graphics, dir: Dir, f: number): void {
  const skin = 0xf0c9a0;
  const hair = 0x5a3a1e;
  const shirt = 0x3a6ac8;
  const shirtD = 0x2c50a0;
  const pants = 0x3a3a5a;
  const boot = 0x2a1c10;
  const hat = 0xe8c860;
  const hatD = 0xb89a40;

  // shadow
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(8, 18.5, 10, 3);

  // legs
  const liftL = f === 1 ? 1 : 0;
  const liftR = f === 2 ? 1 : 0;
  px(g, pants, 5, 14, 3, 4 - liftL);
  px(g, pants, 8, 14, 3, 4 - liftR);
  px(g, boot, 5, 18 - liftL, 3, 2);
  px(g, boot, 8, 18 - liftR, 3, 2);

  // body + arms
  px(g, shirt, 4, 9, 8, 6);
  px(g, shirtD, 4, 13, 8, 2);
  if (dir === 'left' || dir === 'right') {
    px(g, shirtD, dir === 'left' ? 9 : 4, 9, 3, 5);
    px(g, skin, dir === 'left' ? 4 : 11, 11, 1, 3);
  } else {
    px(g, skin, 3, 10, 1, 4);
    px(g, skin, 12, 10, 1, 4);
  }

  // head
  px(g, skin, 4, 4, 8, 6);
  if (dir === 'down') {
    px(g, 0x1a1a1a, 6, 6, 1, 2);
    px(g, 0x1a1a1a, 9, 6, 1, 2);
    px(g, 0xd9967a, 7, 8, 2, 1);
  } else if (dir === 'up') {
    px(g, hair, 4, 4, 8, 6);
  } else if (dir === 'left') {
    px(g, hair, 8, 4, 4, 6);
    px(g, 0x1a1a1a, 5, 6, 1, 2);
  } else {
    px(g, hair, 4, 4, 4, 6);
    px(g, 0x1a1a1a, 10, 6, 1, 2);
  }

  // straw hat
  px(g, hatD, 2, 3, 12, 2);
  px(g, hat, 3, 3, 10, 1);
  px(g, hat, 4, 0, 8, 3);
  px(g, 0xc0392b, 4, 2, 8, 1);
}
