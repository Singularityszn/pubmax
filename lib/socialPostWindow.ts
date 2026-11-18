import type { SocialPostDTO } from "@/lib/socialPosts";

export type SocialPostPosition = Pick<SocialPostDTO, "id" | "createdAt">;
export type SocialPostPage = {
  posts: SocialPostDTO[];
  nextCursor: string | null;
  scannedThrough: SocialPostPosition | null;
};
export type SocialPostWindow = Pick<SocialPostPage, "posts" | "nextCursor"> & { pages: number };
export const SOCIAL_REFRESH_PAGE_CAP = 3;
export const SOCIAL_POST_PAGE_SIZE = 20;

function samePostValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => samePostValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && samePostValue(a[key], b[key]));
}

export function compareSocialPostPositions(left: SocialPostPosition, right: SocialPostPosition): number {
  const byMilliseconds = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (byMilliseconds) return byMilliseconds;
  const fraction = (timestamp: string) => (timestamp.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  const leftFraction = fraction(left.createdAt), rightFraction = fraction(right.createdAt);
  if (leftFraction !== rightFraction) return leftFraction < rightFraction ? 1 : -1;
  return left.id === right.id ? 0 : left.id < right.id ? 1 : -1;
}

export function chronological(posts: SocialPostDTO[]): SocialPostDTO[] {
  return [...posts].sort(compareSocialPostPositions);
}

export async function readSocialPostWindow(
  read: (cursor: string | null) => Promise<SocialPostPage>,
  pageCount: number,
): Promise<SocialPostWindow> {
  const posts = new Map<string, SocialPostDTO>();
  let nextCursor: string | null = null;
  let pages = 0;
  const seen = new Set<string>();
  do {
    const page = await read(nextCursor);
    for (const post of page.posts) posts.set(post.id, post);
    pages += 1;
    nextCursor = page.nextCursor;
    if (nextCursor && seen.has(nextCursor)) throw new Error("Social feed repeated its cursor");
    if (nextCursor) seen.add(nextCursor);
  } while (nextCursor && pages < Math.min(pageCount, SOCIAL_REFRESH_PAGE_CAP));
  return { posts: chronological([...posts.values()]), nextCursor, pages };
}

export async function readSocialPostHead(
  read: (cursor: string | null) => Promise<SocialPostPage>,
  current: SocialPostWindow,
): Promise<{ head: SocialPostPage; contiguous: boolean }> {
  const posts = new Map<string, SocialPostDTO>();
  const cursors = new Set<string>();
  let nextCursor: string | null = null;
  let scannedThrough: SocialPostPosition | null = null;
  for (let page = 0; page < SOCIAL_REFRESH_PAGE_CAP; page++) {
    const head = await read(nextCursor);
    for (const post of head.posts) posts.set(post.id, post);
    nextCursor = head.nextCursor;
    scannedThrough = head.scannedThrough;
    const contiguous = !current.posts.length || !nextCursor || Boolean(scannedThrough &&
      current.posts.some(post => compareSocialPostPositions(post, scannedThrough!) <= 0));
    if (contiguous) return { head: { posts: chronological([...posts.values()]), nextCursor, scannedThrough }, contiguous: true };
    if (cursors.has(nextCursor!)) throw new Error("Social feed repeated its cursor");
    cursors.add(nextCursor!);
  }
  return { head: { posts: chronological([...posts.values()]), nextCursor, scannedThrough }, contiguous: false };
}

export function mergeSocialPostHead(current: SocialPostWindow, head: SocialPostPage): SocialPostWindow {
  const boundary = head.scannedThrough;
  const retained = head.nextCursor
    ? current.posts.filter(post => boundary && compareSocialPostPositions(post, boundary) > 0) : [];
  const currentById = new Map(current.posts.map(post => [post.id, post]));
  const byId = new Map(retained.map(post => [post.id, post]));
  for (const post of head.posts) {
    const held = currentById.get(post.id);
    byId.set(post.id, held && samePostValue(held, post) ? held : post);
  }
  const posts = chronological([...byId.values()]);
  const nextCursor = retained.length ? current.nextCursor : head.nextCursor;
  if (nextCursor === current.nextCursor && posts.length === current.posts.length &&
    posts.every((post, index) => post === current.posts[index])) return current;
  return { ...current, posts, nextCursor, pages: Math.max(retained.length ? current.pages : 1, Math.ceil(posts.length / SOCIAL_POST_PAGE_SIZE)) };
}
