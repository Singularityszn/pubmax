import { describe, expect, it } from "vitest";

import {
  assessPubmaxxDisplayName,
  assessPubmaxxHandle,
} from "@/lib/pubmaxxIdentity";

describe("owner impersonation handle policy", () => {
  it.each(["karansdad", "karan_father", "karanmom", "karanfucker", "xkarandad"])(
    "rejects handle %s",
    (handle) => {
      expect(assessPubmaxxHandle(handle)).toMatchObject({ ok: false });
    },
  );

  it.each(["karan", "karansznx"])(
    "keeps the owner allowlisted handle %s reserved, not registrable",
    (handle) => {
      expect(assessPubmaxxHandle(handle)).toMatchObject({
        ok: false,
        reason: "reserved",
      });
    },
  );


  it.each(["karan_mom", "karan.dad", "dadkaran"])(
    "rejects adjacent family impersonation handle %s",
    (handle) => {
      expect(assessPubmaxxHandle(handle)).toMatchObject({ ok: false });
    },
  );

  it.each(["person", "reason", "samson", "skaran"])(
    "does not reject unrelated handle %s for substring family terms",
    (handle) => {
      const result = assessPubmaxxHandle(handle);
      if (handle === "skaran") {
        expect(result.ok).toBe(true);
        return;
      }
      expect(result.ok).toBe(true);
    },
  );

  it("rejects matching display names", () => {
    expect(assessPubmaxxDisplayName("Karan's dad")).toMatchObject({ ok: false });
    expect(assessPubmaxxDisplayName("Night Owl")).toMatchObject({ ok: true });
  });
});
