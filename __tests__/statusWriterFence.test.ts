import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// `npm run lint` holds one writer module per persisted lifecycle over the tree
// (eslint.config.mjs, rules from lib/statusWriterFence.mjs). This file proves
// those rules fire.

const eslint = new ESLint({ cwd: process.cwd() });

async function lintRules(file: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  const messages = results.flatMap((result) => result.messages);
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file} did not parse: ${fatal.message}`);
  return messages.flatMap((message) =>
    message.ruleId?.startsWith("status-writer/") ? [message.ruleId] : [],
  );
}

const HIDE_PINT_DROP = `import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";
import { requireSupabaseAdmin } from "@/lib/supabase";

const TABLE = PINT_DROPS_TABLE;

export async function hide(id: string) {
  return requireSupabaseAdmin().from(TABLE).update({ status: "hidden" }).eq("id", id);
}
`;

describe("the status writer fence", () => {
  it("lets the owner store write its lifecycle", async () => {
    expect(await lintRules("lib/pintDropsStore.ts", HIDE_PINT_DROP)).toEqual([]);
  });

  it("refuses the same write from another module", async () => {
    expect(await lintRules("app/api/pint-drops/hide/route.ts", HIDE_PINT_DROP)).toEqual([
      "status-writer/one-writer",
    ]);
  });

  it("refuses a lifecycle write on a table with no owner", async () => {
    const code = `import { requireSupabaseAdmin } from "@/lib/supabase";

export async function close(id: string) {
  return requireSupabaseAdmin().from("unowned_things").update({ state: "closed" }).eq("id", id);
}
`;
    expect(await lintRules("lib/unownedThingStore.ts", code)).toEqual(["status-writer/one-writer"]);
  });
});
