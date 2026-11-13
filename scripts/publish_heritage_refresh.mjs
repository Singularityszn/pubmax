import { execFileSync } from "node:child_process";

const refreshedPaths = [
  "public/data/wikidata_history/london.json",
  "public/data/heritage_listings.json",
  "data/heritage/nhle_london_points.json",
  "public/data/heritage_cache.json",
  "public/data/historic_pubs.json",
  "data/freshness_registry.json",
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (!git("status", "--porcelain", "--", ...refreshedPaths)) {
  console.log("Heritage facts unchanged; nothing pushed.");
  process.exit(0);
}

const stamp = execFileSync("date", ["-u", "+%Y-%m-%d"], { encoding: "utf8" }).trim();
const branch = `heritage-refresh/${stamp}-${process.env.GITHUB_RUN_ID}`;
const title = `chore(heritage): refresh heritage facts and historic index ${stamp}`;

git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("switch", "--create", branch);
git("add", "--", ...refreshedPaths);
git("commit", "--only", "-m", title, "--", ...refreshedPaths);
execFileSync("scripts/ci/with-git-token.sh", ["git", "push", "--set-upstream", "origin", branch], { stdio: "inherit" });
execFileSync("gh", [
  "pr", "create", "--base", "main", "--head", branch,
  "--title", title,
  "--body", "Scheduled monthly refresh of the stored heritage facts The Landlord reads back. Wikidata statements (npm run build:wikidata-history) and Historic England listings (npm run build:heritage-listings) were re-read through their sourcePolicy rows. The historic index was rebuilt from the committed heritage cache (node scripts/build_historic_index.mjs). Wikipedia acquisition was not run because scripts/integrate_wikipedia_london_pubs.mjs fetches outside sourcePolicy. Follow-up: fence that producer before scheduling Wikipedia cache refreshes. Review the changed facts before merging.",
], { stdio: "inherit" });
