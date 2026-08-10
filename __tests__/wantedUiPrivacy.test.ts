import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("Wanted sharing controls", () => {
  const list = read("components/wanted/WantedList.tsx");
  const capture = read("components/wanted/WantedCapture.tsx");

  it("loads only the signed-in member's Crew projection", () => {
    expect(list).toContain("/api/social/crews?limit=50");
    expect(list).toContain("parseCrewListPage");
    expect(list).toContain("credentials: \"same-origin\"");
  });

  it("shares through the server-owned visibility action", () => {
    expect(list).toContain('action: "visibility"');
    expect(list).toContain('aria-label={`Share ${title} with`}');
    expect(capture).toContain('value="mutuals"');
    expect(capture).toContain('value={`crew:${crew.crewId}`}');
  });
});
