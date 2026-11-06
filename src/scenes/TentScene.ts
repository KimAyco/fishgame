import Phaser from 'phaser';
import { BAIT_BY_ID } from '../data/gear';
import { FISH_BY_ID } from '../data/fish';
import { loadPlayerSave, loadTentStorage, packTent, transferTentItem, type TentStorage } from '../net/gameApi';
import { store } from '../save/storage';
import { button, H, txt, W, fitMenu } from '../ui/ui';

type Tab = 'fish' | 'bait';

export class TentScene extends Phaser.Scene {
  private tentId = 0;
  private mapId = '';
  private storage: TentStorage | null = null;
  private tab: Tab = 'fish';
  private bagOffset = 0;
  private tentOffset = 0;
  private message!: Phaser.GameObjects.Text;
  private busy = false;
  private content!: Phaser.GameObjects.Container;

  constructor() {
    super('Tent');
  }

  init(data: { tentId: number; mapId: string }): void {
    this.tentId = data.tentId;
    this.mapId = data.mapId;
  }

  create(): void {
    fitMenu(this, 0x26301f);
    this.add.rectangle(W / 2, H / 2, W, H, 0x26301f);
    txt(this, 6, 4, 'TENT STORAGE', 10, '#ffe9c4');
    this.message = txt(this, 6, 167, '', 7, '#ff9a8a');
    button(this, 6, 18, 60, 14, 'Fish', () => this.setTab('fish'));
    button(this, 72, 18, 60, 14, 'Bait', () => this.setTab('bait'));
    button(this, 138, 18, 60, 14, 'Pack tent', () => void this.pack());
    button(this, 268, 3, 48, 14, 'Back', () => this.scene.start('Fishing', { mapId: this.mapId }));
    this.content = this.add.container(0, 0);
    this.render();
    void this.reload().catch((error: unknown) => this.say(error instanceof Error ? error.message : 'Could not load tent storage'));
  }

  private async reload(): Promise<void> {
    const [{ save }, storage] = await Promise.all([loadPlayerSave(), loadTentStorage(this.tentId, this.mapId)]);
    store.data = save;
    this.storage = storage;
    this.render();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.message.setText('');
    this.render();
  }

  private say(message: string, success = false): void {
    this.message.setText(message).setColor(success ? '#8aff8a' : '#ff9a8a');
  }

  private async transfer(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.say('Moving item…', true);
    this.render();
    try {
      await action();
      await this.reload();
      this.say('Storage updated', true);
    } catch (error) {
      this.say(error instanceof Error ? error.message : 'Could not transfer item');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async pack(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.say('Packing tent…', true);
    try {
      await packTent();
      this.scene.start('Fishing', { mapId: this.mapId });
    } catch (error) {
      this.say(error instanceof Error ? error.message : 'Could not pack tent');
      this.busy = false;
    }
  }

  private render(): void {
    this.content.removeAll(true);
    if (!this.storage) {
      this.content.add(txt(this, 160, 88, 'Loading storage…', 8, '#c8d0d8', 0.5));
      return;
    }
    if (this.tab === 'fish') this.renderFish();
    else this.renderBait();
  }

  private renderFish(): void {
    const storage = this.storage!;
    const bag = store.data.inventory;
    this.content.add(txt(this, 5, 37, `BAG (${bag.length})`, 7, '#ffd34d'));
    this.content.add(txt(this, 164, 37, `TENT (${storage.catches.length})`, 7, '#ffd34d'));

    for (let i = 0; i < 5; i++) {
      const bagCatch = bag[this.bagOffset + i];
      const tentCatch = storage.catches[this.tentOffset + i];
      const y = 50 + i * 19;
      if (bagCatch) {
        const fish = FISH_BY_ID[bagCatch.fishId];
        this.content.add(txt(this, 5, y + 3, `${fish?.name ?? bagCatch.fishId} ${bagCatch.size}cm`, 6, '#fff4d6'));
        const catchId = bagCatch.id;
        const move = button(this, 108, y, 44, 15, 'Store', () => {
          if (catchId === undefined) return this.say('Fish record is missing its server ID');
          void this.transfer(() => transferTentItem(this.tentId, 'fish', 'to_tent', { catchId }));
        });
        move.setEnabled(!this.busy && storage.slotsUsed < storage.capacity);
        this.content.add(move.container);
      }
      if (tentCatch) {
        const fish = FISH_BY_ID[tentCatch.fishId];
        this.content.add(txt(this, 164, y + 3, `${fish?.name ?? tentCatch.fishId} ${tentCatch.size}cm`, 6, '#fff4d6'));
        const move = button(this, 268, y, 44, 15, 'Take', () => {
          void this.transfer(() => transferTentItem(this.tentId, 'fish', 'to_bag', { catchId: tentCatch.id }));
        });
        move.setEnabled(!this.busy);
        this.content.add(move.container);
      }
    }
    this.content.add(txt(this, 5, 150, 'Capacity is 50 item slots.', 6, '#b9a67c'));
    if (this.bagOffset > 0) {
      const prev = button(this, 78, 146, 24, 14, '<', () => {
        this.bagOffset = Math.max(0, this.bagOffset - 1);
        this.render();
      });
      this.content.add(prev.container);
    }
    if (this.bagOffset + 5 < bag.length) {
      const next = button(this, 106, 146, 24, 14, '>', () => {
        this.bagOffset++;
        this.render();
      });
      this.content.add(next.container);
    }
    if (this.tentOffset > 0) {
      const prev = button(this, 236, 146, 24, 14, '<', () => {
        this.tentOffset = Math.max(0, this.tentOffset - 1);
        this.render();
      });
      this.content.add(prev.container);
    }
    if (this.tentOffset + 5 < storage.catches.length) {
      const next = button(this, 264, 146, 24, 14, '>', () => {
        this.tentOffset++;
        this.render();
      });
      this.content.add(next.container);
    }
  }

  private renderBait(): void {
    const storage = this.storage!;
    const baitIds = Object.keys(BAIT_BY_ID).filter((id) => id !== 'dough');
    this.content.add(txt(this, 5, 38, 'BAG', 7, '#ffd34d'));
    this.content.add(txt(this, 164, 38, `TENT (${storage.slotsUsed}/${storage.capacity})`, 7, '#ffd34d'));
    baitIds.forEach((baitId, index) => {
      const bait = BAIT_BY_ID[baitId];
      const quantity = store.data.bait[baitId] ?? 0;
      const tentQuantity = storage.bait[baitId] ?? 0;
      const y = 56 + index * 29;
      this.content.add(txt(this, 5, y + 4, `${bait.name} x${quantity}`, 7, '#fff4d6'));
      this.content.add(txt(this, 164, y + 4, `${bait.name} x${tentQuantity}`, 7, '#fff4d6'));
      const stow = button(this, 106, y, 46, 16, 'Store', () => {
        void this.transfer(() => transferTentItem(this.tentId, 'bait', 'to_tent', { baitId, quantity }));
      });
      stow.setEnabled(!this.busy && quantity > 0 && storage.slotsUsed < storage.capacity);
      this.content.add(stow.container);
      const take = button(this, 268, y, 44, 16, 'Take', () => {
        void this.transfer(() => transferTentItem(this.tentId, 'bait', 'to_bag', { baitId, quantity: tentQuantity }));
      });
      take.setEnabled(!this.busy && tentQuantity > 0);
      this.content.add(take.container);
    });
  }
}
