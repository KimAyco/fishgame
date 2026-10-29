import Phaser from 'phaser';
import { MAPS } from '../data/maps';
import { levelOf, unlockMap } from '../logic/economy';
import { net } from '../net/NetClient';
import { getOnline } from '../net/prefs';
import { persist, store } from '../save/storage';
import type { MapDef } from '../types';
import { button, Button, H, txt, W, fitMenu } from '../ui/ui';

export class WorldMapScene extends Phaser.Scene {
  private selected: MapDef = MAPS[0];
  private nodes = new Map<string, Phaser.GameObjects.Arc>();
  private title!: Phaser.GameObjects.Text;
  private desc!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private action!: Button;

  constructor() {
    super('WorldMap');
  }

  create(): void {
    fitMenu(this, 0x1e5a8a);
    this.nodes.clear();
    this.selected = MAPS.find((m) => m.id === store.data.lastMap) ?? MAPS[0];

    this.add.rectangle(W / 2, H / 2, W, H, 0x1e5a8a);
    const land = this.add.graphics();
    land.fillStyle(0x3f7a4a, 1);
    land.fillEllipse(60, 72, 90, 52);
    land.fillEllipse(138, 98, 80, 40);
    land.fillEllipse(250, 62, 80, 44);
    land.fillEllipse(226, 116, 70, 34);
    land.fillStyle(0x5aa05a, 1);
    land.fillEllipse(56, 68, 60, 32);
    land.fillEllipse(246, 58, 50, 26);

    // dotted routes between consecutive maps
    const routes = this.add.graphics();
    routes.fillStyle(0xffffff, 0.35);
    for (let i = 0; i < MAPS.length - 1; i++) {
      const a = MAPS[i].worldPos;
      const b = MAPS[i + 1].worldPos;
      for (let t = 0; t <= 1; t += 0.08) routes.fillRect(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 2, 2);
    }

    for (const map of MAPS) {
      const node = this.add.circle(map.worldPos.x, map.worldPos.y, 7, 0xffffff).setStrokeStyle(2, 0x000000);
      node.setInteractive({ useHandCursor: true });
      node.on('pointerdown', () => {
        this.selected = map;
        this.message.setText('');
        this.refresh();
      });
      this.nodes.set(map.id, node);
    }

    // how many players are in each map right now (only when online play is on)
    if (net.enabled && getOnline()) {
      const counts = new Map<string, Phaser.GameObjects.Text>();
      for (const map of MAPS) counts.set(map.id, txt(this, map.worldPos.x, map.worldPos.y + 9, '', 6, '#a6e36a', 0.5, 0));
      void net.fetchMapCounts().then((list) => {
        if (!list || !this.scene.isActive('WorldMap')) return;
        for (const m of list) {
          const t = counts.get(m.id);
          if (t?.active) t.setText(m.players ? `${m.players} online` : '');
        }
      });
    }

    this.add.rectangle(W / 2, 154, W, 52, 0x3b2818).setStrokeStyle(1, 0xd9b074);
    this.title = txt(this, 8, 132, '', 10, '#ffe9c4');
    this.desc = txt(this, 8, 146, '', 8, '#c8d0d8');
    this.message = txt(this, 8, 164, '', 8, '#ff9a8a');
    this.hud = txt(this, 6, 4, '', 8, '#ffffff');

    this.action = button(this, 226, 134, 88, 18, 'Fish here', () => this.onAction());
    button(this, 226, 156, 42, 16, 'Shop', () => this.scene.start('Shop'));
    button(this, 272, 156, 42, 16, 'Book', () => this.scene.start('Book'));
    button(this, 266, 3, 52, 14, 'Title', () => this.scene.start('Title'));

    this.refresh();
  }

  private refresh(): void {
    const d = store.data;
    const level = levelOf(d.xp);
    this.hud.setText(`Lv ${level}   $${d.coins}   Bag ${d.inventory.length}`);

    for (const map of MAPS) {
      const node = this.nodes.get(map.id)!;
      const unlocked = d.maps.includes(map.id);
      node.setFillStyle(unlocked ? 0xffd34d : 0x6b7690);
      node.setScale(map.id === this.selected.id ? 1.4 : 1);
      node.setStrokeStyle(2, map.id === this.selected.id ? 0xffffff : 0x000000);
    }

    const m = this.selected;
    const unlocked = d.maps.includes(m.id);
    this.title.setText(unlocked ? m.name : `${m.name} (locked)`);
    this.desc.setText(m.description);

    if (unlocked) {
      this.action.setLabel('Fish here');
      this.action.setEnabled(true);
    } else if (level < m.unlock.level) {
      this.action.setLabel(`Needs Lv ${m.unlock.level}`);
      this.action.setEnabled(false);
    } else {
      this.action.setLabel(`Unlock $${m.unlock.price}`);
      this.action.setEnabled(d.coins >= m.unlock.price);
    }
  }

  private onAction(): void {
    const d = store.data;
    if (d.maps.includes(this.selected.id)) {
      d.lastMap = this.selected.id;
      persist();
      this.scene.start('Fishing', { mapId: this.selected.id });
      return;
    }
    const res = unlockMap(d, this.selected);
    if (res.ok) {
      persist();
      this.message.setText(`${this.selected.name} unlocked!`).setColor('#8aff8a');
    } else {
      this.message.setText(res.reason).setColor('#ff9a8a');
    }
    this.refresh();
  }
}
