import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function violations(code: string, file: string, rule: string) {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  return results.flatMap((result) => result.messages.filter((message) => message.ruleId === rule));
}

describe("the drop lane is read once", () => {
  const imports = (code: string, file = "components/map/usePintDrops.ts") =>
    violations(code, file, "pint-drop/imports");

  it.each([
    'import { provisionalPriceDrop } from "@/lib/venues";',
    'import { mergeVenueDrops, agedPriceDrop as aged } from "@/lib/venues";',
    'import * as venues from "@/lib/venues";',
    'import { confirmedPriceInputFor } from "@/lib/pintDropConfirmation";',
    'export { authoritativePriceDrop } from "@/lib/venues";',
  ])("refuses a lane of its own: %s", async (code) => {
    expect(await imports(code)).toHaveLength(1);
  });

  it("lets a caller take the rest of the venue module", async () => {
    expect(await imports('import venues, { mergeVenueDrops } from "@/lib/venues";')).toEqual([]);
  });

  it("lets the one reading take every lane", async () => {
    expect(await imports('import { agedPriceDrop } from "@/lib/venues";', "lib/pintTrust.ts")).toEqual([]);
  });
});

describe("the Pint Drop table has one name", () => {
  const tables = (code: string, file = "lib/pintDropsStore.ts") => violations(code, file, "pint-drop/table-name");

  it.each(['db.from("visit_reports")', "db.from(`pint_drops`)", 'subscribeInsert("pint_drops", onDrop)'])(
    "refuses a spelled table name: %s",
    async (body) => {
      expect(await tables(`export const read = (db, onDrop) => ${body};`)).toHaveLength(1);
    },
  );

  it("leaves the shared constant and other tables alone", async () => {
    expect(await tables('db.from(PINT_DROPS_TABLE); db.from("structured_visit_reports");')).toEqual([]);
    expect(await tables('export const PINT_DROPS_TABLE = "pint_drops";', "lib/pintDropTable.ts")).toEqual([]);
  });
});
