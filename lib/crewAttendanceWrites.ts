// A host's attendance mark in flight, by crew and signed-in account. A read of that
// list waits for it to settle, so a panel that mounts again while the mark saves, or
// reads again on resume, never shows the mark it is replacing.

const writes = new Map<string, Promise<void>>();

export function holdCrewAttendanceWrite<T>(key: string, write: Promise<T>): Promise<T> {
  const settled = write.then(() => undefined, () => undefined);
  writes.set(key, settled);
  void settled.then(() => {
    if (writes.get(key) === settled) writes.delete(key);
  });
  return write;
}

/** Resolves once no mark by this account on this crew is in flight. */
export function afterCrewAttendanceWrite(key: string): Promise<void> {
  return writes.get(key) ?? Promise.resolve();
}
