import Phaser from 'phaser';
import { drawBar, drawPanel, txt } from './ui';

export const BAIT_COLOR: Record<string, number> = {
  dough: 0xe8d9a0,
  worm: 0xd9708a,
  minnow: 0x9ab4c8,
  glowfly: 0xb6ff5a,
};

export interface HudState {
  mapName: string;
  level: number;
  xpInto: number;
  xpNeed: number;
  coins: number;
  clock: string;
  rodName: string;
  baitId: string;
  baitName: string;
  /** Infinity for dough */
  baitCount: number;
  bagCount: number;
  bagValue: number;
}

/**
 * The always-on heads-up display: status panel (top left), time and weather (top right),
 * rod/bait chip (bottom left) and bag chip (bottom right). Every object is exposed in `objs` so
 * the scene can keep it on the HUD camera.
 */
export class Hud {
  readonly objs: Phaser.GameObjects.GameObject[] = [];
  private g: Phaser.GameObjects.Graphics;
  private mapText: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private coinText: Phaser.GameObjects.Text;
  private clockText: Phaser.GameObjects.Text;
  private gearText: Phaser.GameObjects.Text;
  private bagText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, depth: number) {
    const t = (x: number, y: number, size: number, color: string, ox = 0, oy = 0) => {
      const o = txt(scene, x, y, '', size, color, ox, oy).setDepth(depth + 1);
      this.objs.push(o);
      return o;
    };
    this.g = scene.add.graphics().setDepth(depth);
    this.objs.push(this.g);
    this.mapText = t(9, 7, 7, '#cdb98f');
    this.levelText = t(9, 18, 8, '#ffe9c4');
    this.coinText = t(0, 18, 8, '#ffd34d', 1, 0);
    this.clockText = t(0, 14, 7, '#c8d0d8', 1, 0);
    this.gearText = t(0, 0, 7, '#fff4d6', 0, 0.5);
    this.bagText = t(0, 0, 7, '#fff4d6', 1, 0.5);
  }

  update(s: HudState, vw: number, vh: number): void {
    const g = this.g;
    g.clear();

    // status panel
    const panelW = 150;
    drawPanel(g, 4, 4, panelW, 32);
    this.mapText.setText(s.mapName);
    this.levelText.setText(`Lv ${s.level}`);
    drawBar(g, 40, 21, 56, 6, s.xpNeed > 0 ? s.xpInto / s.xpNeed : 1, 0x5bb0e0);
    this.coinText.setText(`$${s.coins}`).setX(4 + panelW - 5);

    // clock (the net text sits above it, at the top right)
    this.clockText.setText(s.clock).setX(vw - 6);

    // rod + bait chip
    const left = s.baitCount === Infinity ? 'inf' :`x${s.baitCount}`;
    this.gearText.setText(`${s.rodName}   ${s.baitName} ${left}`);
    const gearW = this.gearText.width + 22;
    const gy = vh - 28;
    drawPanel(g, 4, gy, gearW, 14);
    g.fillStyle(BAIT_COLOR[s.baitId] ?? 0xffffff, 1).fillCircle(11, gy + 7, 3);
    g.lineStyle(1, 0x000000, 0.6).strokeCircle(11, gy + 7, 3);
    this.gearText.setPosition(18, gy + 7);

    // bag chip
    this.bagText.setText(`Bag ${s.bagCount}  $${s.bagValue}  [I]`);
    const bagW = this.bagText.width + 10;
    drawPanel(g, vw - 4 - bagW, gy, bagW, 14);
    this.bagText.setPosition(vw - 9, gy + 7);
  }
}
