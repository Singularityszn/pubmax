// People you may know (lib/peopleYouMayKnow.ts and its server read): only the
// mates of the viewer's mates, never somebody the viewer already follows, and
// never a private, withdrawn or blocked account. Every store is a fake.

import { describe, expect, it } from "vitest";

import { mayKnowLine, rankMayKnow } from "@/lib/peopleYouMayKnow";
import { readPeopleYouMayKnow, type MayKnowDeps } from "@/lib/peopleYouMayKnow.server";
import type { ProfileRecord } from "@/lib/profileStore";

const request = () => new Request("https://example.test/api/profiles/may-know");

// me <-> amy and me <-> ben are mates. amy's lot: me, cat, dan, eve. ben's lot:
// me, cat, fay. I already follow dan; eve follows me.
const EDGES: Array<[string, string]> = [
  ["me", "amy"], ["amy", "me"], ["me", "ben"], ["ben", "me"],
  ["amy", "cat"], ["cat", "amy"], ["amy", "dan"], ["dan", "amy"], ["amy", "eve"], ["eve", "amy"],
  ["ben", "cat"], ["cat", "ben"], ["ben", "fay"], ["fay", "ben"],
  ["me", "dan"], ["eve", "me"],
];

function deps(overrides: Partial<MayKnowDeps> & { privateHandles?: string[] } = {}): MayKnowDeps {
  const following = (handle: string) => EDGES.filter(([from]) => from === handle).map(([, to]) => to);
  const followers = (handle: string) => EDGES.filter(([, to]) => to === handle).map(([from]) => from);
  const mutuals = (handle: string) => following(handle).filter((other) => followers(handle).includes(other));
  const { privateHandles = [], ...rest } = overrides;
  return {
    viewerHandle: async () => "me",
    follows: {
      listFollowing: async (handle) => following(handle),
      listFollowers: async (handle) => followers(handle),
      mutualsAmong: async (handles) => new Map(handles.map((handle) => [handle, mutuals(handle)])),
    },
    withdrawn: async () => new Set(),
    profile: async (handle) =>
      ({
        id: `p-${handle}`,
        handle,
        visibility: privateHandles.includes(handle) ? "private" : "public",
      }) as ProfileRecord,
    blocked: async () => false,
    ...rest,
  };
}

describe("rankMayKnow", () => {
  it("ranks mates of mates by shared mates and skips the viewer, mates and follows", () => {
    expect(
      rankMayKnow({
        viewer: "me",
        mates: ["amy", "ben"],
        matesOfMates: new Map([
          ["amy", ["me", "ben", "cat", "dan", "eve"]],
          ["ben", ["me", "amy", "cat", "fay"]],
        ]),
        viewerFollowing: ["amy", "ben", "dan"],
      }),
    ).toEqual([
      { handle: "cat", via: ["amy", "ben"] },
      { handle: "eve", via: ["amy"] },
      { handle: "fay", via: ["ben"] },
    ]);
  });

  it("names at most two mates and counts the rest", () => {
    expect(mayKnowLine(["amy"])).toBe("Mates with @amy");
    expect(mayKnowLine(["amy", "ben"])).toBe("Mates with @amy and @ben");
    expect(mayKnowLine(["amy", "ben", "cat", "dan"])).toBe("Mates with @amy, @ben and 2 more of your lot");
  });
});

describe("readPeopleYouMayKnow", () => {
  it("answers the bearer's mates of mates, and says who already added them", async () => {
    const result = await readPeopleYouMayKnow(request(), deps());
    expect(result).toEqual({
      ok: true,
      people: [
        { handle: "cat", via: ["amy", "ben"], relation: "none" },
        { handle: "eve", via: ["amy"], relation: "follows_you" },
        { handle: "fay", via: ["ben"], relation: "none" },
      ],
    });
  });

  it("refuses a caller with no handle", async () => {
    const result = await readPeopleYouMayKnow(request(), deps({ viewerHandle: async () => null }));
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("leaves out private, withdrawn and blocked accounts, and a block it cannot check", async () => {
    const result = await readPeopleYouMayKnow(
      request(),
      deps({
        privateHandles: ["cat"],
        withdrawn: async (handles) => new Set(handles.filter((handle) => handle === "eve")),
        blocked: async (_viewer, other) => other.handle === "fay",
      }),
    );
    expect(result).toEqual({ ok: true, people: [] });
  });

  it("does not suggest through a withdrawn mate", async () => {
    const result = await readPeopleYouMayKnow(
      request(),
      deps({ withdrawn: async (handles) => new Set(handles.filter((handle) => handle === "ben")) }),
    );
    expect(result.ok && result.people.map((person) => person.handle)).toEqual(["cat", "eve"]);
    expect(result.ok && result.people[0]?.via).toEqual(["amy"]);
  });

  it.each([
    ["me", "amy"],
    ["amy", "me"],
  ])("does not suggest through a block from %s to %s", async (blocker, blocked) => {
    const result = await readPeopleYouMayKnow(
      request(),
      deps({
        blocked: async (first, second) =>
          (first.handle === blocker && second.handle === blocked) ||
          (second.handle === blocker && first.handle === blocked),
      }),
    );
    expect(result).toEqual({
      ok: true,
      people: [
        { handle: "cat", via: ["ben"], relation: "none" },
        { handle: "fay", via: ["ben"], relation: "none" },
      ],
    });
  });

  it.each(["blocked", "unavailable"])("removes %s shared links before ranking", async (state) => {
    const result = await readPeopleYouMayKnow(
      request(),
      deps({
        blocked: async (first, second) => {
          if (first.handle !== "amy" || !["cat", "eve"].includes(second.handle)) return false;
          if (state === "unavailable") throw new Error("down");
          return true;
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      people: [
        { handle: "cat", via: ["ben"], relation: "none" },
        { handle: "fay", via: ["ben"], relation: "none" },
      ],
    });
  });

  it("drops a mate when the viewer-to-mate block check fails", async () => {
    const result = await readPeopleYouMayKnow(
      request(),
      deps({
        blocked: async (first, second) => {
          if (first.handle === "me" && second.handle === "amy") throw new Error("down");
          return false;
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      people: [
        { handle: "cat", via: ["ben"], relation: "none" },
        { handle: "fay", via: ["ben"], relation: "none" },
      ],
    });
  });

  it("ranks candidates by the shared links that remain unblocked", async () => {
    const dependencies = deps();
    const result = await readPeopleYouMayKnow(
      request(),
      {
        ...dependencies,
        follows: {
          ...dependencies.follows,
          mutualsAmong: async () => new Map([
            ["amy", ["cat", "fay"]],
            ["ben", ["cat", "fay"]],
          ]),
        },
        blocked: async (first, second) => first.handle === "amy" && second.handle === "cat",
      },
    );
    expect(result).toEqual({
      ok: true,
      people: [
        { handle: "fay", via: ["amy", "ben"], relation: "none" },
        { handle: "cat", via: ["ben"], relation: "none" },
      ],
    });
  });

  it("answers unavailable when the graph cannot be read", async () => {
    const result = await readPeopleYouMayKnow(
      request(),
      deps({
        follows: {
          listFollowing: async () => {
            throw new Error("down");
          },
          listFollowers: async () => [],
          mutualsAmong: async () => new Map(),
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, status: 503 });
  });
});
