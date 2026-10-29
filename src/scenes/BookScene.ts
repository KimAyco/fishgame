import Phaser from 'phaser';
import { FISH } from '../data/fish';
import { store } from '../save/storage';
import { button, H, RARITY_COLOR, txt, W, fitMenu } from '../ui/ui';
import { ensureFishSprites } from '../world/fishart';

const COLS = 5;
const CELL_W = 60;
const CELL_H = 32;
const TOP = 20;

export class BookScene extends Phaser.Scene {
  constructor() {
    super('Book');
  }

  create(): void {
    fitMenu(this, 0x26301f);
    ensureFishSprites(this);
    this.add.rectangle(W / 2, H / 2, W, H, 0x26301f);
    const found = FISH.filter((f) => store.data.book[f.id]).length;
    txt(this, 6, 4, `FISH BOOK  ${found}/${FISH.length}`, 10, '#ffe9c4');
    button(this, 268, 3, 48, 14, 'Back', () => this.scene.start('Fishing', { mapId: store.data.lastMap }));

    const g = this.add.graphics();
    const left = (W - COLS * CELL_W) / 2;

    FISH.forEach((fish, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = left + col * CELL_W;
      const y = TOP + row * CELL_H;
      const entry = store.data.book[fish.id];

      g.fillStyle(0x3a3322, 1);
      g.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
      if (entry) {
        g.lineStyle(1, Phaser.Display.Color.HexStringToColor(RARITY_COLOR[fish.rarity]).color, 0.8);
        g.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
        this.add.image(x + CELL_W / 2, y + 10, `fish_${fish.id}`).setScale(0.6);
        txt(this, x + CELL_W / 2, y + 18, fish.name, 6, RARITY_COLOR[fish.rarity], 0.5);
        txt(this, x + CELL_W / 2, y + 24.5, `${entry.bestSize}cm x${entry.count}`, 6, '#b9a67c', 0.5);
      } else {
        this.add.image(x + CELL_W / 2, y + 10, `fishsil_${fish.id}`).setScale(0.6);
        txt(this, x + CELL_W / 2, y + 20, '???', 7, '#7a6a4a', 0.5);
      }
    });
  }
}
