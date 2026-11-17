import type { SocialPostDTO } from "@/lib/socialPosts";

export type SocialPostPage = { posts: SocialPostDTO[]; nextCursor: string | null };
export type SocialPostWindow = SocialPostPage & { pages: number };
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

function comparePosts(left: SocialPostDTO, right: SocialPostDTO): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}

export function chronological(posts: SocialPostDTO[]): SocialPostDTO[] {
  return [...posts].sort(comparePosts);
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
  const held = new Set(current.posts.map(post => post.id));
  const posts = new Map<string, SocialPostDTO>();
  const cursors = new Set<string>();
  let nextCursor: string | null = null;
  for (let page = 0; page < SOCIAL_REFRESH_PAGE_CAP; page++) {
    const head = await read(nextCursor);
    for (const post of head.posts) posts.set(post.id, post);
    nextCursor = head.nextCursor;
    const contiguous = !held.size || !nextCursor || head.posts.some(post => held.has(post.id));
    if (contiguous) return { head: { posts: chronological([...posts.values()]), nextCursor }, contiguous: true };
    if (cursors.has(nextCursor!)) throw new Error("Social feed repeated its cursor");
    cursors.add(nextCursor!);
  }
  return { head: { posts: chronological([...posts.values()]), nextCursor }, contiguous: false };
}

export function mergeSocialPostHead(current: SocialPostWindow, head: SocialPostPage): SocialPostWindow {
  const boundary = chronological(head.posts).at(-1);
  const retained = head.nextCursor
    ? current.posts.filter(post => !boundary || comparePosts(post, boundary) > 0) : [];
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
