import Phaser from 'phaser';
import { bagValue, baitRows, groupBag } from '../logic/bag';
import { store } from '../save/storage';
import { equipBaitOnline, refreshPlayerSave, sellBagFish } from '../net/gameApi';
import { BAIT_COLOR } from './hud';
import { button, drawPanel, RARITY_COLOR, txt } from './ui';

/** What the fishing scene gives a panel so it can live on the HUD camera. */
export interface ModalHost {
  scene: Phaser.Scene;
  /** logical screen size, re-read on every build so panels follow window resizes */
  view(): { vw: number; vh: number };
  depth: number;
  /** keep an object off the world camera */
  register(o: Phaser.GameObjects.GameObject): void;
  nearShop(): boolean;
  toast(s: string, color?: string, ms?: number): void;
  close(): void;
}

export interface Modal {
  key(code: string): void;
  wheel(dy: number): void;
  /** rebuild from the current save and window size */
  refresh(): void;
  destroy(): void;
}

type Placed = Phaser.GameObjects.GameObject & { setDepth(v: number): unknown };

abstract class ModalBase implements Modal {
  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(protected host: ModalHost) {}

  protected abstract build(): void;
  abstract key(code: string): void;
  wheel(_dy: number): void {}

  protected add<T extends Placed>(o: T, z = 0): T {
    o.setDepth(this.host.depth + z);
    this.host.register(o);
    this.objs.push(o);
    return o;
  }

  /** Dim backdrop plus a centred panel; returns the panel's top-left corner. */
  protected frame(w: number, h: number): { x: number; y: number } {
    const { vw, vh } = this.host.view();
    const x = Math.round((vw - w) / 2);
    const y = Math.round((vh - h) / 2);
    const g = this.add(this.host.scene.add.graphics());
    g.fillStyle(0x000000, 0.55).fillRect(0, 0, vw, vh);
    drawPanel(g, x, y, w, h, 0.97);
    return { x, y };
  }

  protected text(x: number, y: number, s: string, size = 8, color = '#fff4d6', ox = 0, oy = 0): Phaser.GameObjects.Text {
    return this.add(txt(this.host.scene, x, y, s, size, color, ox, oy), 2);
  }

  refresh(): void {
    this.clear();
    this.build();
  }

  destroy(): void {
    this.clear();
  }

  private clear(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }

  protected init(): this {
    this.build();
    return this;
  }
}

// ---- bag ------------------------------------------------------------------------

const BAG_ROWS = 8;
const BAG_ROW_H = 15;

export class BagModal extends ModalBase {
  private scroll = 0;

  static open(host: ModalHost): BagModal {
    return new BagModal(host).init();
  }

  protected build(): void {
    const d = store.data;
    const { scene } = this.host;
    const rows = groupBag(d.inventory);
    const value = bagValue(d.inventory);
    this.scroll = Math.min(this.scroll, Math.max(0, rows.length - BAG_ROWS));

    const w = 244;
    const h = 38 + BAG_ROWS * BAG_ROW_H + 30;
    const { x, y } = this.frame(w, h);

    this.text(x + 8, y + 6, 'BAG', 8, '#ffe9c4');
    this.text(x + w - 8, y + 6, `${d.inventory.length} fish  $${value}`, 8, '#ffd34d', 1, 0);

    if (rows.length === 0) {
      this.text(x + w / 2, y + 70, 'Your bag is empty.\nCast a line and catch something!', 7, '#b9a67c', 0.5, 0);
    }

    const stripes = this.add(scene.add.graphics(), 1);
    for (let i = 0; i < BAG_ROWS; i++) {
      const row = rows[this.scroll + i];
      if (!row) break;
      const ry = y + 22 + i * BAG_ROW_H;
      if (i % 2 === 0) stripes.fillStyle(0x2b1d10, 0.6).fillRect(x + 6, ry, w - 12, BAG_ROW_H - 1);
      this.add(scene.add.image(x + 22, ry + 7, `fish_${row.fish.id}`).setScale(0.5), 2);
      this.text(x + 40, ry + 3, row.fish.name, 7, RARITY_COLOR[row.fish.rarity]);
      this.text(x + 128, ry + 3, `x${row.count}`, 7, '#fff4d6');
      this.text(x + 152, ry + 3, `${row.bestSize}cm`, 7, '#b9a67c');
      this.text(x + w - 10, ry + 3, `$${row.totalValue}`, 7, '#ffd34d', 1, 0);
    }
    if (this.scroll > 0) this.text(x + w - 6, y + 17, '^', 6, '#b9a67c', 1, 0);
    if (this.scroll + BAG_ROWS < rows.length) this.text(x + w - 6, y + h - 32, 'v', 6, '#b9a67c', 1, 0);

    const fy = y + h - 22;
    const canSell = this.host.nearShop() && rows.length > 0;
    const sell = button(scene, x + 8, fy, 96, 16, `Sell all $${value}`, () => this.sell());
    sell.setEnabled(canSell);
    this.add(sell.container, 2);
    if (!this.host.nearShop()) this.text(x + 110, fy + 4, 'Sell at the shop door', 6, '#b9a67c');
    const close = button(scene, x + w - 62, fy, 54, 16, 'Close [I]', () => this.host.close());
    this.add(close.container, 2);
  }

  private async sell(): Promise<void> {
    if (!this.host.nearShop() || store.data.inventory.length === 0) return;
    try {
      const result = await sellBagFish();
      await refreshPlayerSave();
      this.host.toast(`Sold ${result.sold} fish for $${result.coins}`, '#8aff8a');
      this.host.close();
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : 'Could not sell fish', '#ff9a8a');
    }
  }

  key(code: string): void {
    const step = code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
    if (step) this.scrollBy(step);
    else if (code === 'PageUp') this.scrollBy(-BAG_ROWS);
    else if (code === 'PageDown') this.scrollBy(BAG_ROWS);
    else if (code === 'Enter') void this.sell();
  }

  wheel(dy: number): void {
    this.scrollBy(dy > 0 ? 1 : -1);
  }

  private scrollBy(n: number): void {
    const max = Math.max(0, groupBag(store.data.inventory).length - BAG_ROWS);
    const next = Math.min(max, Math.max(0, this.scroll + n));
    if (next === this.scroll) return;
    this.scroll = next;
    this.refresh();
  }
}

// ---- bait -----------------------------------------------------------------------

const BAIT_ROW_H = 26;

export class BaitModal extends ModalBase {
  private sel = 0;
  private msg = '';

  static open(host: ModalHost): BaitModal {
    const m = new BaitModal(host);
    m.sel = Math.max(0, baitRows(store.data).findIndex((r) => r.active));
    return m.init();
  }

  protected build(): void {
    const { scene } = this.host;
    const rows = baitRows(store.data);
    const w = 224;
    const h = 28 + rows.length * BAIT_ROW_H + 26;
    const { x, y } = this.frame(w, h);

    this.text(x + 8, y + 6, 'BAIT', 8, '#ffe9c4');
    this.text(x + w - 8, y + 7, '[B] close', 6, '#b9a67c', 1, 0);

    const g = this.add(scene.add.graphics(), 1);
    rows.forEach((r, i) => {
      const ry = y + 22 + i * BAIT_ROW_H;
      g.fillStyle(i === this.sel ? 0x5a3d20 : 0x2b1d10, 0.9).fillRect(x + 6, ry, w - 12, BAIT_ROW_H - 2);
      if (r.active) g.lineStyle(1, 0xffc933, 1).strokeRect(x + 6.5, ry + 0.5, w - 13, BAIT_ROW_H - 3);
      g.fillStyle(BAIT_COLOR[r.bait.id] ?? 0xffffff, r.selectable ? 1 : 0.35).fillCircle(x + 17, ry + 12, 4);

      const color = r.selectable ? '#fff4d6' : '#8a7a60';
      this.text(x + 28, ry + 3, r.bait.name + (r.active ? '  (in use)' : ''), 8, color);
      this.text(x + 28, ry + 15, `bites x${r.bait.biteSpeed}   rarity x${r.bait.rarityBias}`, 6, '#b9a67c');
      this.text(x + w - 12, ry + 7, r.count === Infinity ? 'inf' : `x${r.count}`, 8, r.selectable ? '#ffd34d' : '#8a7a60', 1, 0);

      const hit = this.add(scene.add.rectangle(x + w / 2, ry + 12, w - 12, BAIT_ROW_H - 2, 0x000000, 0), 3);
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.choose(i));
    });

    const fy = y + h - 15;
    if (this.msg) this.text(x + 8, fy, this.msg, 6, '#ff9a8a');
    else this.text(x + 8, fy, 'UP/DOWN + ENTER choose    TAB quick-swap', 6, '#b9a67c');
  }

  private async choose(i: number): Promise<void> {
    const row = baitRows(store.data)[i];
    if (!row) return;
    this.sel = i;
    if (!row.selectable) {
      this.msg = 'None left. Buy more at the shop.';
      this.refresh();
      return;
    }
    try {
      await equipBaitOnline(row.bait.id);
      store.data.baitId = row.bait.id;
      this.host.toast(`Using ${row.bait.name}`, '#c8d0d8', 1200);
      this.host.close();
    } catch (error) {
      this.msg = error instanceof Error ? error.message : 'Could not equip bait';
      this.refresh();
    }
  }

  key(code: string): void {
    const n = baitRows(store.data).length;
    if (code === 'ArrowUp' || code === 'KeyW') this.sel = (this.sel + n - 1) % n;
    else if (code === 'ArrowDown' || code === 'KeyS') this.sel = (this.sel + 1) % n;
    else if (code === 'Enter') {
      void this.choose(this.sel);
      return;
    }
    else return;
    this.msg = '';
    this.refresh();
  }
}
