import { describe, it, expect } from "vitest";

import {
  MAP_ICON_SPECS,
  LANDMARK_ICON_KEYS,
  TFL_ICON_KEYS,
  DRINK_ICON_KEYS,
  drinkPinIconKey,
  drinkPinKindFromCategories,
  iconId,
  type IconSpec,
  type IconTokens,
} from "@/lib/mapIcons";

// The vitest environment here is node (and jsdom's canvas.getContext("2d") returns
// null anyway), so we NEVER touch a real canvas or call `rasterize`. Instead every
// `spec.draw` is exercised against a hand-rolled recording stub that implements the
// canvas 2D methods the icons use as no-ops/recorders. This proves no draw throws
// and that each one actually issues path/fill/stroke work.

// Every required key the contract promises, listed explicitly so a rename or a
// dropped icon fails loudly here rather than at runtime in the map component.
const REQUIRED_LANDMARK_KEYS = [
  "clock-tower",
  "dome",
  "twin-towers",
  "shard",
  "wheel",
  "gherkin",
  "column",
  "civic",
  "keep",
  "market",
  "canal",
  "ship",
  "chimneys",
] as const;

const REQUIRED_TFL_KEYS = ["underground", "rail", "bus", "river"] as const;

const TOKENS: IconTokens = {
  ink: "#231a12",
  paper: "#f5ecd9",
  brass: "#a97b26",
  brassBright: "#e0a637",
  river: "#3a5a78",
  riverBright: "#5a9fd0",
  pint: "#2f8f5b",
  amber: "#d99f45",
  brick: "#d16353",
  muted: "#6b726a",
};

// A count of the drawing operations we care about, so a test can assert a given
// draw actually painted something (rather than silently doing nothing).
type StubTallies = {
  paths: number; // beginPath / moveTo / lineTo / arc / curves …
  fills: number; // fill / fillRect
  strokes: number; // stroke
};

// Build a recording stub that satisfies the subset of CanvasRenderingContext2D the
// icons use. Method bodies are no-ops (or tally-bumps); style props are plain
// writable fields. Cast `as unknown as CanvasRenderingContext2D` at the call site.
function makeStubCtx(): { ctx: CanvasRenderingContext2D; tallies: StubTallies } {
  const tallies: StubTallies = { paths: 0, fills: 0, strokes: 0 };
  const bumpPath = () => {
    tallies.paths += 1;
  };
  const bumpFill = () => {
    tallies.fills += 1;
  };
  const bumpStroke = () => {
    tallies.strokes += 1;
  };

  const stub = {
    // Writable style/state properties the icons set.
    fillStyle: "" as string | CanvasGradient,
    strokeStyle: "" as string | CanvasGradient,
    lineWidth: 1,
    lineJoin: "miter" as CanvasLineJoin,
    lineCap: "butt" as CanvasLineCap,
    globalAlpha: 1,

    // Path construction — each counts as "did some drawing".
    beginPath: bumpPath,
    moveTo: bumpPath,
    lineTo: bumpPath,
    arc: bumpPath,
    arcTo: bumpPath,
    ellipse: bumpPath,
    rect: bumpPath,
    roundRect: bumpPath,
    quadraticCurveTo: bumpPath,
    bezierCurveTo: bumpPath,
    closePath: () => {},

    // Paint ops.
    fill: bumpFill,
    stroke: bumpStroke,
    fillRect: bumpFill,
    strokeRect: bumpStroke,
    clearRect: () => {},

    // State + transform stack.
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    clip: () => {},
    setLineDash: () => {},

    // Gradient factory returns a minimal recorder.
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };

  return { ctx: stub as unknown as CanvasRenderingContext2D, tallies };
}

// Run a single spec's draw against a fresh stub and return the tallies. If roundRect
// is absent on a real target the module falls back to arcTo/lineTo, so we also cover
// that branch by deleting roundRect from the stub in one dedicated test below.
function exercise(spec: IconSpec): StubTallies {
  const { ctx, tallies } = makeStubCtx();
  spec.draw(ctx, TOKENS);
  return tallies;
}

describe("MAP_ICON_SPECS registry", () => {
  it("is a non-empty list", () => {
    expect(Array.isArray(MAP_ICON_SPECS)).toBe(true);
    expect(MAP_ICON_SPECS.length).toBeGreaterThan(0);
  });

  it("every spec has a valid namespace, a draw function, and a positive size", () => {
    for (const spec of MAP_ICON_SPECS) {
      expect(["lm", "tfl", "drink", "base"], `${spec.key} ns`).toContain(spec.ns);
      expect(typeof spec.draw, `${spec.key} draw`).toBe("function");
      expect(spec.size, `${spec.key} size`).toBeGreaterThan(0);
      expect(typeof spec.key, `${spec.key} key type`).toBe("string");
      expect(spec.key.length, `${spec.key} key length`).toBeGreaterThan(0);
    }
  });

  it("keys are unique within each namespace", () => {
    for (const ns of ["lm", "tfl"] as const) {
      const keys = MAP_ICON_SPECS.filter((s) => s.ns === ns).map((s) => s.key);
      expect(new Set(keys).size, `${ns} keys unique`).toBe(keys.length);
    }
  });
});

describe("derived key lists", () => {
  it("LANDMARK_ICON_KEYS matches the ns==='lm' specs in order", () => {
    const fromSpecs = MAP_ICON_SPECS.filter((s) => s.ns === "lm").map((s) => s.key);
    expect([...LANDMARK_ICON_KEYS]).toEqual(fromSpecs);
  });

  it("TFL_ICON_KEYS matches the ns==='tfl' specs in order", () => {
    const fromSpecs = MAP_ICON_SPECS.filter((s) => s.ns === "tfl").map((s) => s.key);
    expect([...TFL_ICON_KEYS]).toEqual(fromSpecs);
  });

  it("DRINK_ICON_KEYS covers every kind × price bucket", () => {
    expect(DRINK_ICON_KEYS).toHaveLength(16);
    expect(DRINK_ICON_KEYS).toContain(drinkPinIconKey("pint", 0));
    expect(DRINK_ICON_KEYS).toContain(drinkPinIconKey("cocktail", 2));
    expect(drinkPinKindFromCategories(["vodka"], false)).toBe("spirits");
    expect(drinkPinKindFromCategories([], true)).toBe("cocktail");
    expect(drinkPinKindFromCategories(["wine"], false)).toBe("wine");
    expect(drinkPinKindFromCategories(["champagne"], false)).toBe("wine");
    // Recorded categories outrank the cocktails amenity: a beer-led pub that
    // also mixes cocktails stays a pint pin (owner audit, The Black Friar).
    expect(drinkPinKindFromCategories(["beer"], true)).toBe("pint");
    expect(drinkPinKindFromCategories(["cocktail"], false)).toBe("cocktail");
  });

  it("drink pin draws do not throw for every kind × bucket", () => {
    const kinds = ["pint", "wine", "cocktail", "spirits"] as const;
    for (const kind of kinds) {
      for (const bucket of [0, 1, 2, 3] as const) {
        const key = drinkPinIconKey(kind, bucket);
        const spec = MAP_ICON_SPECS.find((s) => s.ns === "drink" && s.key === key);
        expect(spec, `spec ${key}`).toBeDefined();
        const tallies = exercise(spec!);
        expect(tallies.paths, `${key} path ops`).toBeGreaterThan(0);
        expect(tallies.fills + tallies.strokes, `${key} paint ops`).toBeGreaterThan(0);
      }
    }
  });

  it("contains every required landmark key", () => {
    for (const key of REQUIRED_LANDMARK_KEYS) {
      expect(LANDMARK_ICON_KEYS, `landmark ${key}`).toContain(key);
    }
  });

  it("contains every required TfL key", () => {
    for (const key of REQUIRED_TFL_KEYS) {
      expect(TFL_ICON_KEYS, `tfl ${key}`).toContain(key);
    }
  });

  it("has no landmark/tfl keys beyond those declared required", () => {
    // The lists are exactly the required sets (guards against an accidental extra
    // or stray icon slipping into the registry unreviewed).
    expect([...LANDMARK_ICON_KEYS].sort()).toEqual([...REQUIRED_LANDMARK_KEYS].sort());
    expect([...TFL_ICON_KEYS].sort()).toEqual([...REQUIRED_TFL_KEYS].sort());
  });
});

describe("iconId", () => {
  it("namespaces a key with a colon", () => {
    expect(iconId("lm", "clock-tower")).toBe("lm:clock-tower");
    expect(iconId("tfl", "underground")).toBe("tfl:underground");
    expect(iconId("drink", "pint-0")).toBe("drink:pint-0");
  });
});

describe("spec.draw (recording stub)", () => {
  it("no draw throws, and each issues at least one path + a fill or stroke", () => {
    for (const spec of MAP_ICON_SPECS) {
      const tallies = exercise(spec);
      expect(tallies.paths, `${spec.key} path ops`).toBeGreaterThan(0);
      expect(
        tallies.fills + tallies.strokes,
        `${spec.key} paint ops`,
      ).toBeGreaterThan(0);
    }
  });

  it("still draws when roundRect is unavailable (fallback path)", () => {
    // Prove the manual rounded-rect fallback works on targets lacking roundRect.
    for (const spec of MAP_ICON_SPECS) {
      const { ctx, tallies } = makeStubCtx();
      // Simulate an older canvas implementation without roundRect.
      delete (ctx as unknown as { roundRect?: unknown }).roundRect;
      expect(() => spec.draw(ctx, TOKENS)).not.toThrow();
      expect(tallies.paths, `${spec.key} fallback path ops`).toBeGreaterThan(0);
    }
  });
});
