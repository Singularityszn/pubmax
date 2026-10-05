import path from "node:path";

import { ESLint } from "eslint";
import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

import { PER_SESSION_SERVER_PAGES } from "@/lib/routerCacheFence.mjs";

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

const REFRESHING_COMPONENT = `"use client";

import { useRouter } from "next/navigation";

export default function SaveButton() {
  const router = useRouter();
  return <button onClick={() => router.refresh()}>Save</button>;
}
`;

/** One fixture per credential door, keyed by the door an exception may argue. */
const DOOR_PAGES: Record<string, string> = {
  "cookies()": COOKIE_PAGE,
  "draftMode()": DRAFT_MODE_PAGE,
  "the credential gate @/lib/adminAuth": CREDENTIAL_GATE_PAGE,
  "the Authorization header": AUTHORIZATION_PAGE,
  "the Cookie header": COOKIE_HEADER_PAGE,
};

const EXCEPTIONS = Object.entries(PER_SESSION_SERVER_PAGES).map(
  ([file, { door }]) => [file, door] as const,
);

describe("invariant 1 - no page renders per-account content on the server", () => {
  it.each([
    ["cookies()", COOKIE_PAGE],
    ["draftMode()", DRAFT_MODE_PAGE],
    ["a credential gate module", CREDENTIAL_GATE_PAGE],
    ["the authorization header", AUTHORIZATION_PAGE],
    ["the Authorization header", CAPITALISED_AUTHORIZATION_PAGE],
    ["the cookie header", COOKIE_HEADER_PAGE],
  ])("refuses a server page that reads %s", async (_door, code) => {
    expect(await lintRules("app/fence-fixture/page.tsx", code)).toContain(CREDENTIAL_READ);
  });

  it("leaves the per-request nonce read alone", async () => {
    const rules = await lintRules("app/fence-fixture/page.tsx", NONCE_PAGE);

    expect(rules).not.toContain(CREDENTIAL_READ);
    expect(rules).not.toContain(STALE_EXCEPTION);
  });

  it("leaves API routes alone, since the router cache never holds them", async () => {
    expect(await lintRules("app/api/fence-fixture/route.ts", CREDENTIAL_ROUTE)).not.toContain(
      CREDENTIAL_READ,
    );
  });

  it.each(EXCEPTIONS)("lets the argued exception %s read %s", async (file, door) => {
    const code = DOOR_PAGES[door];
    if (code === undefined) throw new Error(`no fixture reads ${door}`);

    const rules = await lintRules(file, code);

    expect(rules).not.toContain(CREDENTIAL_READ);
    expect(rules).not.toContain(STALE_EXCEPTION);
  });

  it.each(
    EXCEPTIONS.flatMap(([file, door]) =>
      Object.entries(DOOR_PAGES)
        .filter(([other]) => other !== door)
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

describe("invariant 2 - no surface expects the server to re-render after a write", () => {
  it.each(["components/FenceFixture.tsx", "app/fence-fixture/SaveButton.tsx"])(
    "refuses a router.refresh() call in %s",
    async (file) => {
      expect(await lintRules(file, REFRESHING_COMPONENT)).toContain("no-restricted-syntax");
    },
  );
});
