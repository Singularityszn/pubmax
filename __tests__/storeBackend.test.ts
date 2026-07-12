import { describe, expect, it } from "vitest";

import {
  errorMessage,
  isMissingTableSchema,
  missingTables,
  selectStore,
} from "@/lib/storeBackend";

describe("storeBackend", () => {
  it("selectStore prefers supabase when configured", () => {
    type Backend = { kind: "memory" | "supabase" };
    const memory: Backend = { kind: "memory" };
    const supabase: Backend = { kind: "supabase" };
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(selectStore(memory, supabase)).toBe(memory);
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
      expect(selectStore(memory, supabase)).toBe(supabase);
    } finally {
      if (prevUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });

  it("detects missing-table PostgREST shapes", () => {
    const miss = missingTables("price_confirms");
    expect(
      miss(new Error("Could not find the table 'public.price_confirms' in the schema cache")),
    ).toBe(true);
    expect(miss(new Error('relation "public.price_confirms" does not exist'))).toBe(true);
    expect(isMissingTableSchema(new Error("schema cache"), "plans")).toBe(true);
    expect(miss(new Error("permission denied"))).toBe(false);
  });

  it("stringifies unknown errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
