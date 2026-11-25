import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const email = /[\w.+%-]+@[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?!jpg\b|jpeg\b|png\b|webp\b|svg\b)[A-Za-z]{2,}\b(?![\w-]|\.[A-Za-z0-9-])/i;

function datasets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return datasets(path);
    return /\.(?:json|jsonl|csv|geojson)$/i.test(entry.name) ? [path] : [];
  });
}

it("does not publish email addresses or drinker comments in data files", () => {
  const root = join(process.cwd(), "public", "data");
  const leaks = datasets(root).filter((path) => {
    const contents = readFileSync(path, "utf8");
    return email.test(contents) || /drinker\s*:/i.test(contents);
  });
  expect(leaks.map((path) => path.slice(root.length + 1))).toEqual([]);
});

it("removes imported drinker text and emails before export", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
import csv, pathlib, sys, tempfile
sys.path.insert(0, "scripts")
from build_app_dataset import read_csv
from export_app_dataset_json import sanitize_record
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / "input.csv"
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["comment", "price_gbp", "pub_url"])
        writer.writeheader()
        writer.writerow({"comment": "Drinker: someone@sample.org", "price_gbp": "4.50", "pub_url": "https://example.org/pub"})
    row = read_csv(path)[0]
    assert not row["comment"]
    assert row["price_gbp"] == "4.50"
    assert row["pub_url"] == "https://example.org/pub"
record = sanitize_record({"comment": "Drinker: private", "email": "someone@sample.org", "pub_url": "https://example.org/pub"})
assert record == {"comment": "", "email": "", "pub_url": "https://example.org/pub"}
`;
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
});
