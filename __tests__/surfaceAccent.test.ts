import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import {
  CATEGORY_ROTATION,
  WEDGE_CATEGORY,
  categoryGradient,
  categoryTint,
  isWedgeKey,
  rotateCategory,
  wedgeCategory,
} from "@/lib/surfaceAccent";

describe("CATEGORY_ROTATION", () => {
  it("starts on beer so brass stays the through-line", () => {
    expect(CATEGORY_ROTATION[0]).toBe("beer");
  });

  it("contains only valid, unique drink categories", () => {
    const set = new Set(CATEGORY_ROTATION);
    expect(set.size).toBe(CATEGORY_ROTATION.length);
    for (const cat of CATEGORY_ROTATION) {
      expect(DRINK_CATEGORIES).toContain(cat);
    }
  });
});

describe("rotateCategory", () => {
  it("returns the i-th rotation entry", () => {
    expect(rotateCategory(0)).toBe(CATEGORY_ROTATION[0]);
    expect(rotateCategory(1)).toBe(CATEGORY_ROTATION[1]);
    expect(rotateCategory(CATEGORY_ROTATION.length - 1)).toBe(
      CATEGORY_ROTATION[CATEGORY_ROTATION.length - 1],
    );
  });

  it("wraps past the end of the rotation", () => {
    const n = CATEGORY_ROTATION.length;
    expect(rotateCategory(n)).toBe(CATEGORY_ROTATION[0]);
    expect(rotateCategory(n + 2)).toBe(CATEGORY_ROTATION[2]);
  });

  it("handles negative indices with a non-negative modulo", () => {
    const n = CATEGORY_ROTATION.length;
    expect(rotateCategory(-1)).toBe(CATEGORY_ROTATION[n - 1]);
    expect(rotateCategory(-n)).toBe(CATEGORY_ROTATION[0]);
  });

  it("truncates fractional indices", () => {
    expect(rotateCategory(2.9)).toBe(CATEGORY_ROTATION[2]);
  });

  it("always returns a valid category for any index", () => {
    for (let i = -20; i <= 20; i++) {
      expect(DRINK_CATEGORIES).toContain(rotateCategory(i));
    }
  });
});

describe("wedgeCategory / WEDGE_CATEGORY", () => {
  it("maps the three wedge slots to their intended hues", () => {
    expect(wedgeCategory("price")).toBe("beer");
    expect(wedgeCategory("setting")).toBe("gin");
    expect(wedgeCategory("story")).toBe("rum");
  });

  it("only maps to valid drink categories", () => {
    for (const cat of Object.values(WEDGE_CATEGORY)) {
      expect(DRINK_CATEGORIES).toContain(cat as DrinkCategory);
    }
  });

  it("isWedgeKey narrows known vs unknown keys", () => {
    expect(isWedgeKey("price")).toBe(true);
    expect(isWedgeKey("setting")).toBe(true);
    expect(isWedgeKey("story")).toBe(true);
    expect(isWedgeKey("nonsense")).toBe(false);
    expect(isWedgeKey("")).toBe(false);
  });
});

describe("categoryGradient", () => {
  it("references the category token, never a literal hex", () => {
    const g = categoryGradient("wine");
    expect(g).toContain("var(--cat-wine)");
    expect(g).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("builds a 2-stop linear-gradient on the default panel base", () => {
    const g = categoryGradient("gin");
    expect(g).toMatch(/^linear-gradient\(160deg,/);
    expect(g).toContain("var(--panel)");
    expect(g).toContain("color-mix(in srgb, var(--cat-gin) 9%, var(--panel))");
    expect(g).toContain("var(--panel) 68%");
  });

  it("honours a custom base, angle, strength and fade", () => {
    const g = categoryGradient("rum", "var(--panel-raised)", {
      angle: 135,
      strength: 14,
      fade: 55,
    });
    expect(g).toMatch(/^linear-gradient\(135deg,/);
    expect(g).toContain(
      "color-mix(in srgb, var(--cat-rum) 14%, var(--panel-raised))",
    );
    expect(g).toContain("var(--panel-raised) 55%");
  });

  it("clamps out-of-range strength / fade into [0,100]", () => {
    const hi = categoryGradient("shot", "var(--panel)", {
      strength: 999,
      fade: -5,
    });
    expect(hi).toContain("var(--cat-shot) 100%");
    expect(hi).toContain("var(--panel) 0%");
  });

  it("falls back to a finite angle when given a non-finite one", () => {
    const g = categoryGradient("beer", "var(--panel)", {
      angle: Number.NaN,
    });
    expect(g).toMatch(/^linear-gradient\(160deg,/);
  });

  it("produces a valid gradient for every category", () => {
    for (const cat of DRINK_CATEGORIES) {
      const g = categoryGradient(cat);
      expect(g).toContain(`var(--cat-${cat})`);
      expect(g.startsWith("linear-gradient(")).toBe(true);
    }
  });
});

describe("categoryTint", () => {
  it("builds a color-mix tint referencing the token, default transparent base", () => {
    expect(categoryTint("vodka")).toBe(
      "color-mix(in srgb, var(--cat-vodka) 12%, transparent)",
    );
  });

  it("honours a custom strength and base", () => {
    expect(categoryTint("cocktail", 20, "var(--panel)")).toBe(
      "color-mix(in srgb, var(--cat-cocktail) 20%, var(--panel))",
    );
  });

  it("clamps strength into [0,100]", () => {
    expect(categoryTint("whisky", 500)).toContain("var(--cat-whisky) 100%");
    expect(categoryTint("whisky", -3)).toContain("var(--cat-whisky) 0%");
  });
});
