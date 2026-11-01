import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Pub Pal UI audit (19 Oct 2026, 1440x900, 1280x720, 390x844 and 360x740,
// light and dark). Each pin below is a defect a browser showed:
//
// 1. The analytics consent card covered /pal/chat's field and Ask button at
//    every width until the reader scrolled to the foot of the page.
// 2. The "Tonight" and "Listed price" panels ran edge to edge on a phone and
//    sat off the transcript's column on a desktop.
// 3. The portrait's state motion swung the photograph's square edge inside
//    its circular mask and showed a light sliver of the core's ground.
const ROOT = join(__dirname, "..");

function css(path: string): string {
  // Comments first: a brace inside one would end a block early.
  return readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first `@media <query> { ... }` block, braces balanced. */
function mediaBlock(sheet: string, query: string, from = 0): string {
  const start = sheet.indexOf(`@media ${query}`, from);
  expect(start, `@media ${query}`).toBeGreaterThan(-1);
  const open = sheet.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < sheet.length; index += 1) {
    if (sheet[index] === "{") depth += 1;
    if (sheet[index] === "}") {
      depth -= 1;
      if (depth === 0) return sheet.slice(open + 1, index);
    }
  }
  throw new Error(`unbalanced @media ${query}`);
}

/** Every declaration block whose selector is exactly `selector`. */
function rules(sheet: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...sheet.matchAll(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1] ?? "",
  );
}

const chat = css("components/pal/palChat.css");
const pal = css("app/pal/pal.css");

describe("the Pal chat composer stands on the consent card, never under it", () => {
  it("adds the card's measured height to the phone composer's clearance", () => {
    // Several phone blocks exist; read the one that owns the composer's clearance.
    const owner = chat.indexOf("--pal-composer-clearance: calc(");
    expect(owner).toBeGreaterThan(-1);
    const block = mediaBlock(chat, "(max-width: 640px)", chat.lastIndexOf("@media (max-width: 640px)", owner));
    const [consent] = rules(block, "body:has(.analyticsConsentPrompt) .palChatComposer:not([data-keyboard-open])");
    expect(consent).toBeDefined();
    expect(consent).toContain("--pal-composer-clearance: calc(");
    // It stands on the phone's own foot rather than restating it, so the
    // re-open pill's fallback (nightMode.css is not loaded on every route) is
    // never dropped: without it the whole calc was invalid and the composer
    // stopped being sticky.
    expect(consent).toContain("var(--pal-composer-foot)");
    const foot = rules(block, ".palChatComposer").find((body) => body.includes("--pal-composer-foot:"));
    expect(foot).toContain("var(--tabbar-h, 64px)");
    expect(foot).toContain("var(--night-pill-clearance, 0px)");
    expect(consent).toContain("var(--analytics-consent-reserve, var(--analytics-consent-mobile-clearance))");
    // A person typing has the field first: the card steps aside for the keyboard.
    const [aside] = rules(block, "body:has(.palChatComposer[data-keyboard-open]) .analyticsConsentPrompt");
    expect(aside).toContain("visibility: hidden;");
    expect(aside).toContain("pointer-events: none;");
  });

  it("stands the desktop composer on the strip's measured top edge", () => {
    const block = mediaBlock(chat, "(min-width: 641px)");
    const [consent] = rules(block, "body:has(.analyticsConsentPrompt) .palChatComposer");
    expect(consent).toBeDefined();
    expect(consent).toContain(
      "--pal-composer-clearance: var(--analytics-consent-reserve, var(--analytics-consent-clearance));",
    );
  });

  it("keeps the sticky composer reading the one clearance variable", () => {
    const [composer] = rules(chat, ".palChatComposer");
    expect(composer).toContain("position: sticky;");
    expect(composer).toContain("bottom: calc(var(--pal-composer-clearance) + var(--keyboard-inset, 0px));");
  });
});

describe("the Pal chat glance panels keep the transcript's column", () => {
  it("pays the transcript's gutter and measure instead of running edge to edge", () => {
    const [transcript] = rules(chat, ".palChatTranscript");
    expect(transcript).toContain("width: min(46rem, 100%);");
    expect(transcript).toContain("padding: 0.75rem clamp(1rem, 4vw, 1.5rem) 1rem;");
    const [glance] = rules(chat, ".palGlance");
    expect(glance).toContain("width: calc(min(46rem, 100%) - 2 * clamp(1rem, 4vw, 1.5rem));");
    expect(glance).toContain("margin: 0.9rem auto 0;");
    expect(glance).not.toMatch(/width:\s*min\(30rem/);
  });
});

describe("the Pal portrait's motion never shows the core's ground", () => {
  it("overscans the photograph inside the circular core", () => {
    const [overscan] = rules(pal, ".palPortraitCore > .palPortraitMascot");
    expect(overscan).toContain("scale: 1.1;");
    // The base rule: the one that draws the circle and clips to it.
    const core = rules(pal, ".palPortraitCore").find((body) => body.includes("border-radius"));
    expect(core).toContain("overflow: hidden;");
    expect(core).toContain("border-radius: 50%;");
  });

  it("paints a core that holds a photograph on the photograph's own dark", () => {
    const [ground] = rules(pal, ".palPortrait .palPortraitCore:has(> .palPortraitMascot)");
    expect(ground).toContain("background: var(--ink-deep);");
  });

  it("still moves the photograph with transform keyframes, which compose with scale", () => {
    for (const name of ["palMascotIdle", "palMascotNotice", "palMascotCelebrate", "palMascotWake"]) {
      const keyframes = pal.slice(pal.indexOf(`@keyframes ${name}`));
      expect(keyframes.slice(0, keyframes.indexOf("\n"))).toContain("transform:");
      expect(keyframes.slice(0, keyframes.indexOf("\n"))).not.toMatch(/[{;]\s*scale:/);
    }
  });
});

// The 3D model (a GLB with no mouth) stands in for the photograph once it is
// ready. Captain's call of 1 Nov 2026: while the Pal talks, the model fades
// back to the photograph and its talking-mouth frame, on the big portrait and
// the phone voice face alike. A Chromium check of these rules at 390x844
// showed the photograph visible and the model at opacity 0 while speaking or
// listening, and the old sheet hiding the photograph throughout.
describe("the 3D Pal shows its talking mouth and its genome", () => {
  const sheet = css("app/pal/pal.css");
  const talking = ':is([data-pal-state="speaking"], [data-pal-state="listening"])';

  it("shows the photograph and its mouth frame while the Pal talks", () => {
    expect(sheet).toContain(
      `.palPortrait${talking} .palPortraitCore:has(> .palOriginalModelHost[data-model-state="ready"]) > .palPortraitMascot`,
    );
    expect(sheet).toContain(
      `.palVoiceFace${talking} .palVoiceFaceMask:has(> .palOriginalModelHost[data-model-state="ready"]) > .palVoiceFaceImg`,
    );
  });

  it("fades the model out while the Pal talks, takes no drag on it, and fades only under motion", () => {
    expect(sheet).toMatch(
      /\.palPortrait:is\(\[data-pal-state="speaking"\], \[data-pal-state="listening"\]\) \.palOriginalModelHost\[data-model-state="ready"\],\s*\.palVoiceFace:is\(\[data-pal-state="speaking"\], \[data-pal-state="listening"\]\) \.palOriginalModelHost\[data-model-state="ready"\] \{\s*opacity: 0;\s*pointer-events: none;\s*\}/,
    );
    const reduced = mediaBlock(sheet, "(prefers-reduced-motion: reduce)", sheet.indexOf(`.palVoiceFace${talking} .palOriginalModelHost`));
    expect(reduced).toContain('.palOriginalModelHost[data-model-state="ready"] { transition: none; }');
  });

  it("holds the saved genome on the phone voice face's model, as on the big portrait", () => {
    expect(sheet).toMatch(
      /\.palPortrait\[data-genome\] \.palOriginalModelHost\[data-model-state="ready"\] > \.palOriginalModelFraming,\s*\.palVoiceFace\[data-genome\] \.palOriginalModelHost\[data-model-state="ready"\] > \.palOriginalModelFraming \{/,
    );
  });

  it("marks the phone voice face with the Pal's state, so the sheet can read it", () => {
    const face = readFileSync(join(ROOT, "components/pubpal/PalVoiceFace.tsx"), "utf8");
    expect(face).toContain("data-pal-state={state}");
  });
});
