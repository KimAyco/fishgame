import Phaser from 'phaser';
import { authenticate, loadGameCatalog, loadPlayerSave } from '../net/gameApi';
import { store } from '../save/storage';
import { button, H, txt, W, fitMenu } from '../ui/ui';

export class AuthScene extends Phaser.Scene {
  private usernameInput: HTMLInputElement | null = null;
  private passwordInput: HTMLInputElement | null = null;
  private message!: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super('Auth');
  }

  create(): void {
    fitMenu(this, 0x203c50);
    this.add.rectangle(W / 2, H / 2, W, H, 0x203c50);
    const panel = this.add.graphics();
    panel.fillStyle(0x142a39, 0.96).fillRoundedRect(40, 48, 240, 94, 5);
    panel.lineStyle(1, 0xd9b074, 0.9).strokeRoundedRect(40.5, 48.5, 239, 93, 5);
    txt(this, W / 2, 18, 'WELCOME, ANGLER', 13, '#ffe9c4', 0.5);
    txt(this, W / 2, 36, 'Sign in or create an account to save your catches.', 6, '#c8d0d8', 0.5);
    txt(this, 82, 50, 'USERNAME', 5, '#d9b074');
    txt(this, 82, 69, 'PASSWORD', 5, '#d9b074');
    this.message = txt(this, W / 2, 125, '', 6, '#ff9a8a', 0.5);
    this.createFields();

    button(this, 49, 99, 104, 18, 'Sign in', () => void this.submit('login'), 7);
    button(this, 167, 99, 104, 18, 'Create account', () => void this.submit('signup'), 7);
    button(this, 132, 151, 56, 15, 'Back', () => this.scene.start('Title'), 6);
    this.scale.on('resize', this.positionFields, this);
    document.addEventListener('fullscreenchange', this.positionFields);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.positionFields, this);
      document.removeEventListener('fullscreenchange', this.positionFields);
      this.removeFields();
    });
  }

  private createFields(): void {
    const make = (placeholder: string, type: string): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = type;
      input.placeholder = placeholder;
      input.autocomplete = type === 'password' ? 'current-password' : 'username';
      input.setAttribute('aria-label', type === 'password' ? 'Password' : 'Username');
      input.maxLength = type === 'password' ? 128 : 16;
      Object.assign(input.style, {
        position: 'absolute',
        zIndex: '1',
        boxSizing: 'border-box',
        padding: '0 5px',
        font: '7px monospace',
        color: '#fff4d6',
        background: '#1d2930',
        border: '1px solid #92714d',
        borderRadius: '3px',
        outline: 'none',
        pointerEvents: 'auto',
      });
      input.addEventListener('focus', () => {
        input.style.borderColor = '#ffe09a';
        input.style.boxShadow = '0 0 0 1px rgba(255, 224, 154, .35)';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = '#92714d';
        input.style.boxShadow = 'none';
      });
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') void this.submit('login');
      });
      input.addEventListener('keyup', (event) => event.stopPropagation());
      this.game.canvas.parentElement?.appendChild(input);
      return input;
    };
    this.usernameInput = make('3–16 characters', 'text');
    this.passwordInput = make('At least 8 characters', 'password');
    this.positionFields();
  }

  private positionFields(): void {
    if (!this.usernameInput || !this.passwordInput) return;
    const canvasRect = this.game.canvas.getBoundingClientRect();
    const parent = this.game.canvas.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const zoom = (this.cameras.main.zoom * canvasRect.width) / this.scale.width;
    const offsetX = (canvasRect.width - W * zoom) / 2;
    const offsetY = (canvasRect.height - H * zoom) / 2;
    const place = (input: HTMLInputElement, top: number): void => {
      input.style.left = `${canvasRect.left - parentRect.left + offsetX + 82 * zoom}px`;
      input.style.top = `${canvasRect.top - parentRect.top + offsetY + top * zoom}px`;
      input.style.width = `${156 * zoom}px`;
      input.style.height = `${18 * zoom}px`;
      input.style.padding = `0 ${5 * zoom}px`;
      input.style.fontSize = `${Math.max(10, 7 * zoom)}px`;
    };
    place(this.usernameInput, 58);
    place(this.passwordInput, 77);
  }

  private async submit(action: 'signup' | 'login'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message.setText(action === 'signup' ? 'Creating account…' : 'Signing in…').setColor('#ffd34d');
    try {
      await authenticate(action, this.usernameInput?.value ?? '', this.passwordInput?.value ?? '');
      await loadGameCatalog();
      const { save } = await loadPlayerSave();
      store.data = save;
      this.removeFields();
      this.scene.start('Title');
    } catch (error) {
      this.message.setText(error instanceof Error ? error.message : 'Account request failed').setColor('#ff9a8a');
      this.busy = false;
    }
  }

  private removeFields(): void {
    this.usernameInput?.remove();
    this.passwordInput?.remove();
    this.usernameInput = null;
    this.passwordInput = null;
  }
}
