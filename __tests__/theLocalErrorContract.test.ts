import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

describe("THE LOCAL public error envelope", () => {
  it("routes every documented THE LOCAL error through the flat public helper", () => {
    const files = [
      ...routeFiles(join(ROOT, "app/api/plans")),
      ...routeFiles(join(ROOT, "app/api/night-areas")),
      join(ROOT, "app/api/late-food/route.ts"),
      join(ROOT, "app/api/me/night-profile/route.ts"),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /jsonNoStore\s*\(\s*(?:\{\s*error\b|publicError\s*\(|PLAN_IDEMPOTENCY_ERROR\b|failure\.body\b)/,
      );
      expect(source, file).not.toMatch(/Response\.json\s*\(\s*\{\s*error\b/);
      if (/\berror\s*:|publicApiError|collaborationErrorResponse/.test(source)) {
        expect(source, file).toMatch(/publicApiError|collaborationErrorResponse/);
      }
    }
  });

  it("keeps the flat helper's stable human and machine fields", async () => {
    const { publicApiError } = await import("@/lib/apiError");
    const response = publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
    expect(await response.json()).toEqual({
      error: "That Plan doesn't exist.",
      code: "PLAN_NOT_FOUND",
      retryable: false,
    });
  });
});
