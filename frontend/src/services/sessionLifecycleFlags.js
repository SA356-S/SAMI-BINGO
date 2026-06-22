/** Single gate: block auto-navigation to MainGame until post-round reset is confirmed. */
let mainGameAutoEntryBlocked = false;

export function blockMainGameAutoEntry() {
  mainGameAutoEntryBlocked = true;
}

export function releaseMainGameAutoEntry() {
  mainGameAutoEntryBlocked = false;
}

export function isMainGameAutoEntryBlocked() {
  return mainGameAutoEntryBlocked;
}
