import Phaser from 'phaser';
import type { Rarity } from '../types';

export const W = 320;
export const H = 180;
export const FONT = 'monospace';

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#c8d0d8',
  uncommon: '#6fd16f',
  rare: '#4fa8ff',
  epic: '#c07aff',
  legendary: '#ffc933',
};

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: string,
  size = 8,
  color = '#ffffff',
  originX = 0,
  originY = 0,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 2 })
    .setResolution(scene.cameras.main.zoom)
    .setOrigin(originX, originY);
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setLabel(s: string): void;
  setEnabled(on: boolean): void;
}

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
): Button {
  const bg = scene.add.rectangle(0, 0, w, h, 0x6b4a2a).setStrokeStyle(1, 0xd9b074);
  const text = scene.add
    .text(0, 0, label, { fontFamily: FONT, fontSize: '8px', color: '#fff4d6' })
    .setResolution(scene.cameras.main.zoom)
    .setOrigin(0.5);
  const container = scene.add.container(x + w / 2, y + h / 2, [bg, text]);
  let enabled = true;

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => enabled && bg.setFillStyle(0x8a6238));
  bg.on('pointerout', () => bg.setFillStyle(enabled ? 0x6b4a2a : 0x3a2a1a));
  bg.on('pointerdown', () => enabled && onClick());

  return {
    container,
    setLabel: (s) => text.setText(s),
    setEnabled: (on) => {
      enabled = on;
      bg.setFillStyle(on ? 0x6b4a2a : 0x3a2a1a);
      text.setColor(on ? '#fff4d6' : '#8a7a60');
    },
  };
}

export function lerpColor(a: number, b: number, t: number): number {
  const ca = Phaser.Display.Color.IntegerToColor(a);
  const cb = Phaser.Display.Color.IntegerToColor(b);
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 100, Math.round(t * 100));
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

const SKY_KEYS: [number, number, number][] = [
  // hour, sky color, night factor (x100)
  [0, 0x0a1230, 100],
  [5, 0x0a1230, 100],
  [7, 0xf2a76b, 50],
  [9, 0x7ec8f5, 0],
  [17, 0x7ec8f5, 0],
  [19, 0xe0704f, 50],
  [21, 0x0a1230, 100],
  [24, 0x0a1230, 100],
];

function keyframe(hour: number): { sky: number; night: number } {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const [h0, c0, n0] = SKY_KEYS[i];
    const [h1, c1, n1] = SKY_KEYS[i + 1];
    if (hour >= h0 && hour <= h1) {
      const t = (hour - h0) / (h1 - h0);
      return { sky: lerpColor(c0, c1, t), night: (n0 + (n1 - n0) * t) / 100 };
    }
  }
  return { sky: SKY_KEYS[0][1], night: 1 };
}

export const skyColor = (hour: number) => keyframe(hour).sky;
export const nightFactor = (hour: number) => keyframe(hour).night;

/** Darken a color toward night-blue by the night factor. */
export function nightShade(color: number, night: number): number {
  return lerpColor(color, 0x0a1030, night * 0.65);
}

/**
 * Fits a scene laid out for W x H into whatever size the canvas currently is (letterboxed with
 * `bg`), and rebuilds the scene when the window is resized so text stays crisp.
 */
export function fitMenu(scene: Phaser.Scene, bg: number): void {
  const cam = scene.cameras.main;
  cam.setBackgroundColor(bg);
  cam.setZoom(Math.min(scene.scale.width / W, scene.scale.height / H)).centerOn(W / 2, H / 2);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (scene.scene.isActive()) scene.scene.restart();
    }, 150);
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => {
    clearTimeout(timer);
    scene.scale.off('resize', onResize);
  });
}
