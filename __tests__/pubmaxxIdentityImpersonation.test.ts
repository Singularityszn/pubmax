import { describe, expect, it } from "vitest";

import {
  assessPubmaxxDisplayName,
  assessPubmaxxHandle,
} from "@/lib/pubmaxxIdentity";

describe("owner impersonation handle policy", () => {
  it.each([
    "karansdad",
    "karan_father",
    "karanmom",
    "karanfucker",
    "xkarandad",
    "karan_sdad",
    "karansdadd",
    "karansdadreal",
    "karansdadofficial",
  ])(
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
      expect(assessPubmaxxHandle(handle)).toEqual({ ok: true, handle });
    },
  );

  it.each(["karan_dadlani", "karan_sisodia", "karan_momin", "karansonawane", "karandadlani"])(
    "does not reject handle %s whose surname only starts with a family term",
    (handle) => {
      expect(assessPubmaxxHandle(handle)).toEqual({ ok: true, handle });
    },
  );

  it.each([
    "Karan's dad",
    "Karan dad",
    "karan_dad",
    "Dad of Karan",
    "KaransDad",
    "The real karansdad",
    "Karan'sDad",
    "Karan’sDad",
    "KaransDadOfficial",
  ])(
    "rejects display name %s",
    (name) => {
      expect(assessPubmaxxDisplayName(name)).toMatchObject({ ok: false });
    },
  );

  it.each(["Night Owl", "Karan Dadlani", "Karan Momin", "Karan Sisodia", "Karan Sonawane"])(
    "accepts display name %s",
    (name) => {
      expect(assessPubmaxxDisplayName(name)).toEqual({ ok: true, displayName: name });
    },
  );
});
