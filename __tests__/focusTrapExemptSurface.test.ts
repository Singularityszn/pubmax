// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  FOCUS_TRAP_EXEMPT_ATTRIBUTE,
  inertTargets,
  nextTrapFocus,
  trapExemptSurfaces,
} from "@/lib/useFocusTrap";

// drawer-trap-route-chip. The desktop venue drawer traps focus and inerts what
// sits outside it. The mapped-route chip is a map control a reader may still
// press while the drawer is open ("Check last train at final stop"), so a
// map-surface trap leaves an exempt surface live: the exempt node and the
// ancestors on its path stay interactive, and every other outside node is
// still inert. A strict modal exempts nothing.

function buildShell() {
  document.body.innerHTML = `
    <main>
      <nav id="nav"><a href="/">Home</a></nav>
      <section id="stage">
        <div id="canvas"></div>
        <div id="toolbar"><button>Search</button></div>
        <div id="chip" ${FOCUS_TRAP_EXEMPT_ATTRIBUTE}>
          <button id="edit">Edit</button>
          <button id="train">Check last train</button>
          <button id="hide">Hide</button>
        </div>
      </section>
      <aside id="drawer">
        <button id="close">Close</button>
        <button id="plan">Plan stop</button>
      </aside>
    </main>
    <div id="palette"></div>
  `;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  return { byId };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("trapExemptSurfaces", () => {
  it("finds an exempt surface outside a map-surface trap", () => {
    const { byId } = buildShell();
    expect(trapExemptSurfaces(byId("drawer"), "map-surface")).toEqual([byId("chip")]);
  });

  it("exempts nothing for a strict modal", () => {
    const { byId } = buildShell();
    expect(trapExemptSurfaces(byId("drawer"), "strict-modal")).toEqual([]);
  });

  it("never counts a marker inside the trapped container", () => {
    const { byId } = buildShell();
    byId("plan").setAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE, "");
    expect(trapExemptSurfaces(byId("drawer"), "map-surface")).toEqual([byId("chip")]);
  });
});

describe("inertTargets", () => {
  it("inerts the whole stage when no surface is exempt", () => {
    const { byId } = buildShell();
    const targets = inertTargets([byId("nav"), byId("stage"), byId("palette")], []);
    expect([...targets]).toEqual([byId("nav"), byId("stage"), byId("palette")]);
  });

  it("descends into the stage so the exempt chip and its path stay live", () => {
    const { byId } = buildShell();
    const targets = inertTargets([byId("nav"), byId("stage")], [byId("chip")]);
    expect(targets.has(byId("stage"))).toBe(false);
    expect(targets.has(byId("chip"))).toBe(false);
    expect(targets.has(byId("nav"))).toBe(true);
    expect(targets.has(byId("canvas"))).toBe(true);
    expect(targets.has(byId("toolbar"))).toBe(true);
  });
});

describe("nextTrapFocus", () => {
  function focusables() {
    const { byId } = buildShell();
    return {
      byId,
      container: [byId("close"), byId("plan")],
      exempt: [byId("edit"), byId("train"), byId("hide")],
    };
  }

  it("keeps the plain cycle when nothing is exempt", () => {
    const { byId, container } = focusables();
    expect(nextTrapFocus({ container, exempt: [], active: byId("plan"), shift: false })).toBe(
      byId("close"),
    );
    expect(nextTrapFocus({ container, exempt: [], active: byId("close"), shift: true })).toBe(
      byId("plan"),
    );
    expect(
      nextTrapFocus({ container, exempt: [], active: byId("close"), shift: false }),
    ).toBeNull();
  });

  it("hands focus from the drawer's last control to the chip and back", () => {
    const { byId, container, exempt } = focusables();
    expect(nextTrapFocus({ container, exempt, active: byId("plan"), shift: false })).toBe(
      byId("edit"),
    );
    expect(nextTrapFocus({ container, exempt, active: byId("hide"), shift: false })).toBe(
      byId("close"),
    );
    expect(nextTrapFocus({ container, exempt, active: byId("close"), shift: true })).toBe(
      byId("hide"),
    );
    expect(nextTrapFocus({ container, exempt, active: byId("edit"), shift: true })).toBe(
      byId("plan"),
    );
  });

  it("leaves a move inside one region to the browser", () => {
    const { byId, container, exempt } = focusables();
    expect(
      nextTrapFocus({ container, exempt, active: byId("edit"), shift: false }),
    ).toBeNull();
    expect(
      nextTrapFocus({ container, exempt, active: byId("plan"), shift: true }),
    ).toBeNull();
  });
});
