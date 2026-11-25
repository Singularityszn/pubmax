import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const email = /[\w.+%-]+@[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?!jpg\b|jpeg\b|png\b|webp\b|svg\b)[A-Za-z]{2,}\b(?![\w-]|\.[A-Za-z0-9-])/i;

function datasets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return datasets(path);
    return /\.(?:json|jsonl|geojson)$/i.test(entry.name) ? [path] : [];
  });
}

function hasPrivateText(value: unknown, field = ""): boolean {
  if (typeof value === "string") {
    return /drinker\s*:/i.test(value) || (/comment|note|description/i.test(field) && email.test(value));
  }
  if (Array.isArray(value)) return value.some((item) => hasPrivateText(item, field));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => hasPrivateText(item, key));
  }
  return false;
}

it("does not publish emails in free text or imported drinker comments", () => {
  const root = join(process.cwd(), "public", "data");
  const leaks = datasets(root).filter((path) => {
    const contents = readFileSync(path, "utf8");
    const records: unknown = path.endsWith(".jsonl")
      ? contents.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : JSON.parse(contents);
    return hasPrivateText(records);
  });
  expect(leaks.map((path) => path.slice(root.length + 1))).toEqual([]);
});

it("scrubs free text and preserves venue contacts before export", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
import csv, pathlib, sys, tempfile
sys.path.insert(0, "scripts")
from build_app_dataset import read_csv
from export_app_dataset_json import sanitize_record
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / "input.csv"
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["comment", "price_gbp", "pub_url", "email", "description", "notes"])
        writer.writeheader()
        writer.writerow({"comment": "Drinker: someone@sample.org", "price_gbp": "4.50", "pub_url": "https://example.org/pub", "email": "booking@example.org", "description": "Ask person@example.org", "notes": "Contact person@example.org"})
    row = read_csv(path)[0]
    assert not row["comment"]
    assert row["price_gbp"] == "4.50"
    assert row["pub_url"] == "https://example.org/pub"
    assert row["email"] == "booking@example.org"
    assert row["description"] == "Ask "
    assert row["notes"] == "Contact "
record = sanitize_record({"comment": "Drinker: private", "email": "someone@sample.org", "pub_url": "https://example.org/pub"})
assert record == {"comment": "", "email": "someone@sample.org", "pub_url": "https://example.org/pub"}
record = sanitize_record({"comment": "dRinKer : private", "description": "Ask person@example.org", "data_quality_notes": "Contact person@example.org", "booking_link": "https://example.org/book?email=booking@example.org"})
assert record == {"comment": "", "description": "Ask ", "data_quality_notes": "Contact ", "booking_link": "https://example.org/book?email=booking@example.org"}
record = {"comment": "Good pint", "description": "Local pub", "email": "booking@example.org", "price_gbp": "4.50", "scraped_at": "2026-11-22", "pub_url": "https://example.org/pub"}
assert sanitize_record(dict(record)) == record
assert sanitize_record({"note": "Ask guest@example.org"}) == {"note": "Ask "}
`;
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
});
