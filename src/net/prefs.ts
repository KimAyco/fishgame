import { cleanName, normalizeCode } from './protocol';

/** Player choices that live in this browser only: display name, friends' room code, online on/off. */
const NAME = 'pixel-fishing-name';
const CODE = 'pixel-fishing-code';
const ONLINE = 'pixel-fishing-online';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the choice just won't be remembered */
  }
}

export function getName(): string {
  const saved = cleanName(read(NAME) ?? '');
  if (saved) return saved;
  const fresh = `Angler-${Math.floor(1000 + Math.random() * 9000)}`;
  write(NAME, fresh);
  return fresh;
}

export function setName(name: string): void {
  const clean = cleanName(name);
  if (clean) write(NAME, clean);
}

export function getCode(): string {
  return normalizeCode(read(CODE) ?? '');
}

export function setCode(code: string): void {
  write(CODE, normalizeCode(code));
}

/** Online unless the player switched it off. */
export function getOnline(): boolean {
  return read(ONLINE) !== 'off';
}

export function setOnline(on: boolean): void {
  write(ONLINE, on ? 'on' : 'off');
}
