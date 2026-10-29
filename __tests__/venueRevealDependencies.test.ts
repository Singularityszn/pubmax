import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function allDependencyNames(pkg: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const block = pkg[field];
    if (block && typeof block === "object") {
      names.push(...Object.keys(block as Record<string, string>));
    }
  }
  return names;
}

describe("venue reveal dependency fence", () => {
  const forbidden = [
    /^@react-three\//,
    /^lottie/,
    /^@rive-app\//,
    /^@designcodeio\//,
  ];

  // Three renders the requested original Pub Pal models. Venue reveals still
  // need no additional 3D framework or motion package.
  it("does not add unapproved 3D or motion-library packages", () => {
    const names = allDependencyNames(readPackageJson());
    for (const name of names) {
      for (const pattern of forbidden) {
        expect(name, `forbidden package ${name}`).not.toMatch(pattern);
      }
    }
  });

});
