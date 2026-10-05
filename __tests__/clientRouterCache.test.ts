import path from "node:path";

import { ESLint } from "eslint";
import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

import { missingExceptionPages, PER_SESSION_SERVER_PAGES } from "@/lib/routerCacheFence.mjs";

// The client Router Cache window (experimental.staleTimes in next.config.mjs)
// is what makes a return to a tab instant: the browser reuses a route it
// already holds instead of paying a fresh RSC round trip and a fresh server
// render for a page it just left.
//
// It is only safe while no page server-renders per-account content and no
// surface expects a server re-render after a write. The window below is the
// one derived from those two invariants, so moving it means re-deriving it.
// `npm run lint` holds both invariants over the tree (eslint.config.mjs, rules
// from lib/routerCacheFence.mjs); this file proves those rules fire.

/** The ceiling this window may take without a fresh argument for it. */
const MAX_STALE_SECONDS = 300;

const DERIVED_STALE_TIMES = { dynamic: 180, static: 300 } as const;

async function resolvedStaleTimes() {
  const configUrl = new URL("../next.config.mjs", import.meta.url).href;
  const { default: config } = (await import(configUrl)) as { default: NextConfig };
  return config.experimental?.staleTimes;
}

describe("the router cache window", () => {
  it("resolves to the derived window", async () => {
    expect(await resolvedStaleTimes()).toEqual(DERIVED_STALE_TIMES);
  });

  it.each(["dynamic", "static"] as const)(
    "loads a positive %s window within its ceiling",
    async (kind) => {
      const seconds = (await resolvedStaleTimes())?.[kind];

      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(MAX_STALE_SECONDS);
    },
  );
});

const eslint = new ESLint({ cwd: process.cwd() });

/**
 * The rule ids the repository lint config reports for `code` saved at `file`.
 * A fixture that does not parse throws, so a negative assertion cannot pass on
 * a file no rule ever read.
 */
async function lintRules(file: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  const messages = results.flatMap((result) => result.messages);
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file} did not parse: ${fatal.message}`);
  return messages.flatMap((message) => (message.ruleId ? [message.ruleId] : []));
}

const CREDENTIAL_READ = "router-cache/credential-read";
const STALE_EXCEPTION = "router-cache/stale-exception";

const COOKIE_PAGE = `import { cookies } from "next/headers";

export default async function Page() {
  const jar = await cookies();
  return <p>{jar.get("sb-account")?.value}</p>;
}
`;

const DRAFT_MODE_PAGE = `import { draftMode } from "next/headers";

export default async function Page() {
  const { isEnabled } = await draftMode();
  return <p>{String(isEnabled)}</p>;
}
`;

const CREDENTIAL_GATE_PAGE = `import { headers } from "next/headers";

import { canOpenAdminDocument } from "@/lib/adminAuth";

export default async function Page() {
  return <p>{String(await canOpenAdminDocument(await headers()))}</p>;
}
`;

const AUTHORIZATION_PAGE = `import { headers } from "next/headers";

export default async function Page() {
  const auth = (await headers()).get("authorization");
  return <p>{auth ? "signed in" : "anonymous"}</p>;
}
`;

const CAPITALISED_AUTHORIZATION_PAGE = `import { headers } from "next/headers";

export default async function Page() {
  const h = await headers();
  return <p>{h.get("Authorization") ? "signed in" : "anonymous"}</p>;
}
`;

const COOKIE_HEADER_PAGE = `import { headers } from "next/headers";

export default async function Page() {
  const h = await headers();
  return <p>{h.get("cookie")?.includes("sb-") ? "signed in" : "anonymous"}</p>;
}
`;

const PINT_DROP_VIEWER_PAGE = `import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";

export default async function Page() {
  const viewer = await resolveViewerContextFromRequest(new Request("http://localhost/p"));
  return <p>{viewer ? "friend" : "anonymous"}</p>;
}
`;

const AUTH_SERVER_HELPER_PAGE = `import { headers } from "next/headers";

import { callerUserId } from "@/lib/authServer";

export default async function Page() {
  const request = new Request("http://localhost/x", { headers: await headers() });
  return <p>{(await callerUserId(request)) ?? "anonymous"}</p>;
}
`;

// lib/messageAuth reads no credential itself; it imports lib/authServer, which does.
const TRANSITIVE_HELPER_PAGE = `import * as messageAuth from "@/lib/messageAuth";

export default async function Page() {
  return <p>{Object.keys(messageAuth).length}</p>;
}
`;

const TYPE_ONLY_HELPER_PAGE = `import type { ResolvedViewer } from "@/lib/pintDropViewer";

export default function Page({ viewer }: { viewer?: ResolvedViewer }) {
  return <p>{viewer ? "friend" : "anonymous"}</p>;
}
`;

const CREDENTIAL_ROUTE = `import { cookies, headers } from "next/headers";

export async function GET() {
  const jar = await cookies();
  const h = await headers();
  return Response.json({
    v: jar.get("x")?.value,
    signedIn: Boolean(h.get("authorization") ?? h.get("cookie")),
  });
}
`;

const NONCE_PAGE = `import { headers } from "next/headers";

export default async function Page() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script nonce={nonce} />;
}
`;

function refreshingComponent(imports: string, body: string): string {
  return `"use client";

${imports}

export default function SaveButton() {
${body}
}
`;
}

const NAVIGATION = 'import { useRouter } from "next/navigation";';

/** Each spelling of a refresh on the next/navigation router. */
const REFRESHING_COMPONENTS: Array<[string, string]> = [
  [
    "a router named router",
    refreshingComponent(NAVIGATION, `  const router = useRouter();
  return <button onClick={() => router.refresh()}>Save</button>;`),
  ],
  [
    "a router under another name",
    refreshingComponent(NAVIGATION, `  const navigation = useRouter();
  return <button onClick={() => navigation.refresh()}>Save</button>;`),
  ],
  [
    "the hook's return value",
    refreshingComponent(NAVIGATION, `  return <button onClick={() => useRouter().refresh()}>Save</button>;`),
  ],
  [
    "a destructured refresh",
    refreshingComponent(NAVIGATION, `  const { refresh } = useRouter();
  return <button onClick={() => refresh()}>Save</button>;`),
  ],
  [
    "a router copied into another binding",
    refreshingComponent(NAVIGATION, `  const router = useRouter();
  const again = router;
  return <button onClick={() => again?.refresh()}>Save</button>;`),
  ],
  [
    "a renamed hook",
    refreshingComponent('import { useRouter as useNavigation } from "next/navigation";', `  const nav = useNavigation();
  return <button onClick={() => nav["refresh"]()}>Save</button>;`),
  ],
  [
    "the hook through a namespace import",
    refreshingComponent('import * as navigation from "next/navigation";', `  const nav = navigation.useRouter();
  return <button onClick={() => nav.refresh()}>Save</button>;`),
  ],
];

const UNRELATED_REFRESH = refreshingComponent(NAVIGATION, `  const router = useRouter();
  const poll = { refresh() {} };
  return <button onClick={() => { poll.refresh(); router.push("/"); }}>Save</button>;`);

/** One fixture per credential door, keyed by the door an exception may argue. */
const DOOR_PAGES: Record<string, string> = {
  "cookies()": COOKIE_PAGE,
  "draftMode()": DRAFT_MODE_PAGE,
  "the credential helper @/lib/adminAuth": CREDENTIAL_GATE_PAGE,
  "the credential helper @/lib/pintDropViewer": PINT_DROP_VIEWER_PAGE,
  "the Authorization header": AUTHORIZATION_PAGE,
  "the Cookie header": COOKIE_HEADER_PAGE,
};

const EXCEPTIONS = Object.entries(PER_SESSION_SERVER_PAGES).flatMap(([file, { doors }]) =>
  doors.map((door) => [file, door] as const),
);

describe("invariant 1 - no page renders per-account content on the server", () => {
  it.each([
    ["cookies()", COOKIE_PAGE],
    ["draftMode()", DRAFT_MODE_PAGE],
    ["a credential gate module", CREDENTIAL_GATE_PAGE],
    ["the authorization header", AUTHORIZATION_PAGE],
    ["the Authorization header", CAPITALISED_AUTHORIZATION_PAGE],
    ["the cookie header", COOKIE_HEADER_PAGE],
    ["a credential helper", AUTH_SERVER_HELPER_PAGE],
    ["a module that imports a credential helper", TRANSITIVE_HELPER_PAGE],
  ])("refuses a server page that reads %s", async (_door, code) => {
    expect(await lintRules("app/fence-fixture/page.tsx", code)).toContain(CREDENTIAL_READ);
  });

  it("leaves the per-request nonce read alone", async () => {
    const rules = await lintRules("app/fence-fixture/page.tsx", NONCE_PAGE);

    expect(rules).not.toContain(CREDENTIAL_READ);
    expect(rules).not.toContain(STALE_EXCEPTION);
  });

  it("leaves a type-only import of a credential helper alone", async () => {
    expect(await lintRules("app/fence-fixture/page.tsx", TYPE_ONLY_HELPER_PAGE)).not.toContain(
      CREDENTIAL_READ,
    );
  });

  it("leaves API routes alone, since the router cache never holds them", async () => {
    expect(await lintRules("app/api/fence-fixture/route.ts", CREDENTIAL_ROUTE)).not.toContain(
      CREDENTIAL_READ,
    );
  });

  it.each(EXCEPTIONS)("lets the argued exception %s read %s", async (file, door) => {
    const code = DOOR_PAGES[door];
    if (code === undefined) throw new Error(`no fixture reads ${door}`);

    expect(await lintRules(file, code)).not.toContain(CREDENTIAL_READ);
  });

  it.each(
    Object.entries(PER_SESSION_SERVER_PAGES).flatMap(([file, { doors }]) =>
      Object.entries(DOOR_PAGES)
        .filter(([other]) => !doors.includes(other))
        .map(([other, code]) => [file, other, code] as const),
    ),
  )("still refuses the argued exception %s reading %s", async (file, _door, code) => {
    expect(await lintRules(file, code)).toContain(CREDENTIAL_READ);
  });

  it.each(Object.keys(PER_SESSION_SERVER_PAGES))(
    "reports the argued exception %s as stale once it stops reading the credential",
    async (file) => {
      expect(await lintRules(file, NONCE_PAGE)).toContain(STALE_EXCEPTION);
    },
  );
});

describe("the argued exception list", () => {
  it("names only pages that exist", () => {
    expect(missingExceptionPages()).toEqual([]);
  });

  it("reports an entry whose page is gone, so a later page at that path cannot inherit it", () => {
    expect(
      missingExceptionPages({
        "app/admin/page.tsx": { doors: ["the credential helper @/lib/adminAuth"], reason: "kept" },
        "app/fence-fixture/gone/page.tsx": { doors: ["cookies()"], reason: "removed" },
      }),
    ).toEqual(["app/fence-fixture/gone/page.tsx"]);
  });
});

const ROUTER_REFRESH = "router-cache/no-router-refresh";

describe("invariant 2 - no surface expects the server to re-render after a write", () => {
  it.each(
    ["components/FenceFixture.tsx", "app/fence-fixture/SaveButton.tsx"].flatMap((file) =>
      REFRESHING_COMPONENTS.map(([spelling, code]) => [spelling, file, code] as const),
    ),
  )("refuses a refresh through %s in %s", async (_spelling, file, code) => {
    expect(await lintRules(file, code)).toContain(ROUTER_REFRESH);
  });

  it("leaves a refresh on anything but the router alone", async () => {
    expect(await lintRules("components/FenceFixture.tsx", UNRELATED_REFRESH)).not.toContain(
      ROUTER_REFRESH,
    );
  });
});
