const blocks = new Set<string>();
const mutes = new Set<string>();

export function socialMemoryBlocked(first: string, second: string): boolean {
  return blocks.has(`${first}:${second}`) || blocks.has(`${second}:${first}`);
}

/** One-way: whether `blocker` blocked `blocked`, the way `set_social_block` writes it. */
export function socialMemoryBlocks(blocker: string, blocked: string): boolean {
  return blocks.has(`${blocker}:${blocked}`);
}

export function setSocialMemoryBlock(first: string, second: string, active: boolean): void {
  const key = `${first}:${second}`;
  if (active) blocks.add(key); else blocks.delete(key);
}

export function socialMemoryBlockedProfiles(profileId: string): Set<string> {
  const result = new Set<string>();
  for (const key of blocks) {
    const [first, second] = key.split(":");
    if (first === profileId && second) result.add(second);
    if (second === profileId && first) result.add(first);
  }
  return result;
}

/** One-way, unlike a block: only the muter's lanes change. */
export function socialMemoryMutes(muter: string, muted: string): boolean {
  return mutes.has(`${muter}:${muted}`);
}

export function setSocialMemoryMute(muter: string, muted: string, active: boolean): void {
  const key = `${muter}:${muted}`;
  if (active) mutes.add(key); else mutes.delete(key);
}

export function socialMemoryMutedProfiles(profileId: string): Set<string> {
  const result = new Set<string>();
  for (const key of mutes) {
    const [muter, muted] = key.split(":");
    if (muter === profileId && muted) result.add(muted);
  }
  return result;
}

export function clearSocialMemoryBlocks(): void {
  blocks.clear();
  mutes.clear();
}

/** One-way, the owner's own list: every account `blocker` has blocked, never who blocked them. */
export function socialMemoryBlocksBy(blocker: string): Set<string> {
  const result = new Set<string>();
  for (const key of blocks) {
    const [first, second] = key.split(":");
    if (first === blocker && second) result.add(second);
  }
  return result;
}
