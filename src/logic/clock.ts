/**
 * The world clock that day/night and weather are derived from (see `time.ts`).
 *
 * Offline it counts from the moment the page loaded, so a new game starts at dawn. Online it
 * counts from the server's epoch, corrected for the offset between this machine's clock and the
 * server's, so every player in the same world sees the same hour and the same weather.
 */

const localStart = Date.now();
let offset = 0;
let epoch = 0;
let synced = false;

/** Align with the server. `serverNowMs` should already include half the round trip. */
export function syncClock(serverNowMs: number, serverEpochMs: number, clientNowMs = Date.now()): void {
  offset = serverNowMs - clientNowMs;
  epoch = serverEpochMs;
  synced = true;
}

export function unsyncClock(): void {
  synced = false;
}

export function isClockSynced(): boolean {
  return synced;
}

/** Milliseconds of world time. */
export function worldMs(nowMs = Date.now()): number {
  return synced ? nowMs + offset - epoch : nowMs - localStart;
}
