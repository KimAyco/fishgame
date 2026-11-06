import Phaser from 'phaser';
import { BAITS, RODS } from '../data/gear';
import { FISH_BY_ID } from '../data/fish';
import { levelOf } from '../logic/economy';
import { RARITIES } from '../logic/fishing';
import {
  buyMarketItem,
  equipBaitOnline,
  equipRodOnline,
  getGameCatalog,
  refreshPlayerSave,
  sellBagFish,
} from '../net/gameApi';
import { store } from '../save/storage';
import type { Rarity } from '../types';
import { button, H, RARITY_COLOR, txt, W, fitMenu } from '../ui/ui';

type Tab = 'sell' | 'rods' | 'bait' | 'items';

export class ShopScene extends Phaser.Scene {
  private tab: Tab = 'sell';
  private content!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super('Shop');
  }

  create(): void {
    fitMenu(this, 0x26301f);
    this.tab = 'sell';
    this.add.rectangle(W / 2, H / 2, W, H, 0x26301f);
    txt(this, 6, 4, 'SHOP', 10, '#ffe9c4');
    this.hud = txt(this, 60, 5, '', 8);
    this.message = txt(this, 6, 168, '', 8, '#ff9a8a');

    button(this, 6, 18, 50, 14, 'Sell', () => this.setTab('sell'));
    button(this, 60, 18, 50, 14, 'Rods', () => this.setTab('rods'));
    button(this, 114, 18, 50, 14, 'Bait', () => this.setTab('bait'));
    button(this, 268, 3, 48, 14, 'Back', () => this.scene.start('Fishing', { mapId: 'market' }));

    this.content = this.add.container(0, 0);
    button(this, 168, 18, 60, 14, 'Boat / Tent', () => this.setTab('items'));
    this.render();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.message.setText('');
    this.render();
  }

  private say(s: string, ok = false): void {
    this.message.setText(s).setColor(ok ? '#8aff8a' : '#ff9a8a');
  }

  private async transact(action: () => Promise<void>, success: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.say('Processing…', true);
    this.render();
    try {
      await action();
      await refreshPlayerSave();
      this.say(success, true);
    } catch (error) {
      this.say(error instanceof Error ? error.message : 'Market request failed');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    const d = store.data;
    this.hud.setText(`Lv ${levelOf(d.xp)}   $${d.coins}`);
    this.content.removeAll(true);

    if (this.tab === 'sell') this.renderSell();
    else if (this.tab === 'rods') this.renderRods();
    else if (this.tab === 'bait') this.renderBait();
    else this.renderItems();
  }

  private renderSell(): void {
    const d = store.data;
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    for (const c of d.inventory) counts[FISH_BY_ID[c.fishId].rarity]++;
    const total = d.inventory.reduce((s, c) => s + c.value, 0);

    const items: Phaser.GameObjects.GameObject[] = [txt(this, 10, 42, `Fish in bag: ${d.inventory.length}`, 9)];
    RARITIES.forEach((r, i) => {
      items.push(txt(this, 10, 58 + i * 12, `${r}`, 8, RARITY_COLOR[r]));
      items.push(txt(this, 90, 58 + i * 12, `x${counts[r]}`, 8, RARITY_COLOR[r]));
    });
    items.push(txt(this, 10, 124, `Worth: $${total}`, 9, '#ffd34d'));

    const sell = button(this, 10, 140, 100, 18, `Sell all  +$${total}`, () => {
      void this.transact(async () => {
        await sellBagFish();
      }, 'Fish sold');
    });
    sell.setEnabled(d.inventory.length > 0 && !this.busy);
    items.push(sell.container);
    this.content.add(items);
  }

  private renderRods(): void {
    const d = store.data;
    const level = levelOf(d.xp);
    const items: Phaser.GameObjects.GameObject[] = [];
    RODS.forEach((rod, i) => {
      const y = 38 + i * 24;
      const owned = d.rods.includes(rod.id);
      items.push(txt(this, 10, y, rod.name, 8, owned ? '#ffffff' : '#c8d0d8'));
      items.push(txt(this, 10, y + 10, `bite x${rod.biteSpeed}   bar ${Math.round(rod.barSize * 100)}%`, 7, '#b9a67c'));

      let label: string;
      let enabled = true;
      let action: () => void;
      if (d.rod === rod.id) {
        label = 'Equipped';
        enabled = false;
        action = () => undefined;
      } else if (owned) {
        label = 'Equip';
        action = () => {
          void this.transact(() => equipRodOnline(rod.id), `Equipped ${rod.name}`);
        };
      } else if (level < rod.minLevel) {
        label = `Lv ${rod.minLevel}`;
        enabled = false;
        action = () => undefined;
      } else {
        label = `Buy $${rod.price}`;
        enabled = d.coins >= rod.price;
        action = () => {
          void this.transact(() => buyMarketItem(`rod-${rod.id}`).then(() => undefined), `Bought ${rod.name}`);
        };
      }
      const b = button(this, 236, y, 78, 16, label, action);
      b.setEnabled(enabled && !this.busy);
      items.push(b.container);
    });
    this.content.add(items);
  }

  private renderBait(): void {
    const d = store.data;
    const items: Phaser.GameObjects.GameObject[] = [];
    BAITS.forEach((bait, i) => {
      const y = 38 + i * 28;
      const have = bait.id === 'dough' ? 'inf' : String(d.bait[bait.id] ?? 0);
      const active = d.baitId === bait.id;
      items.push(txt(this, 10, y, `${bait.name}  (have ${have})${active ? '  <- in use' : ''}`, 8, active ? '#8aff8a' : '#ffffff'));
      items.push(txt(this, 10, y + 11, `bite x${bait.biteSpeed}   rarity bias x${bait.rarityBias}`, 7, '#b9a67c'));

      if (bait.pack > 0) {
        const buy = button(this, 190, y, 60, 16, `+${bait.pack} $${bait.price}`, () => {
          void this.transact(() => buyMarketItem(`bait-${bait.id}`).then(() => undefined), `Bought ${bait.name}`);
        });
        buy.setEnabled(d.coins >= bait.price && !this.busy);
        items.push(buy.container);
      }
      const use = button(this, 254, y, 60, 16, active ? 'In use' : 'Use', () => {
        void this.transact(() => equipBaitOnline(bait.id), `Equipped ${bait.name}`);
      });
      use.setEnabled(!active && (bait.id === 'dough' || (d.bait[bait.id] ?? 0) > 0) && !this.busy);
      items.push(use.container);
    });
    this.content.add(items);
  }

  private renderItems(): void {
    const d = store.data;
    const items: Phaser.GameObjects.GameObject[] = [];
    getGameCatalog()
      .marketItems.filter((item) => item.kind === 'boat' || item.kind === 'tent')
      .forEach((item, index) => {
        const y = 44 + index * 42;
        const owned = d.placeables.some((placeable) => placeable.kind === item.kind);
        items.push(txt(this, 10, y, item.name, 9, '#ffe9c4'));
        items.push(txt(this, 10, y + 13, item.description, 7, '#c8d0d8'));
        const purchase = button(
          this,
          230,
          y + 4,
          80,
          18,
          owned ? 'Owned' : `Buy $${item.price}`,
          () => void this.transact(() => buyMarketItem(item.id).then(() => undefined), `Bought ${item.name}`),
        );
        purchase.setEnabled(!owned && d.coins >= item.price && !this.busy);
        items.push(purchase.container);
      });
    this.content.add(items);
  }
}
