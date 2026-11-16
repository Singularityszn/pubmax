import type { SocialPostDTO } from "@/lib/socialPosts";

export type SocialPostPage = { posts: SocialPostDTO[]; nextCursor: string | null };
export type SocialPostWindow = SocialPostPage & { pages: number };
export const SOCIAL_REFRESH_PAGE_CAP = 3;

export function chronological(posts: SocialPostDTO[]): SocialPostDTO[] {
  return [...posts].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
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
