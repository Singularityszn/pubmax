# Refresh Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable the scheduled London price and What's-On refresh workflows while keeping every refresh human-reviewable and keyless failures explicit.

**Architecture:** Keep the existing GitHub Actions jobs and refresh scripts. The price workflow remains the Monday review-PR path, and the events workflow becomes a daily review-PR path by activating its existing cron. Manual `workflow_dispatch` stays available for dry runs. No served data is merged or deployed by this change.

**Tech Stack:** GitHub Actions YAML, existing Node.js refresh scripts, Vitest contract tests, Ruby YAML parser for syntax validation.

## Global Constraints

- Monday price schedule remains `30 7 * * 1` UTC.
- Daily events schedule remains `45 15 * * *` UTC.
- Weather schedule remains unchanged.
- Refresh jobs must use `--open-pr` and may not push directly to `main`.
- No secret values may be committed or hardcoded.
- Missing repository secrets must be reported, not guessed.
- Use only existing refresh scripts; do not add scrapers or change page copy.

---

### Task 1: Lock scheduler and review-output contracts

**Files:**
- Create: `__tests__/refreshWorkflows.test.ts`

**Interfaces:**
- Consumes: `.github/workflows/drink-price-refresh.yml`, `.github/workflows/events-refresh.yml`, `.github/workflows/weather-refresh.yml`.
- Produces: deterministic assertions for active schedules, manual dispatch, review PR invocation, and declared provider secret names.

- [x] **Step 1: Write the failing regression test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = (name: string) =>
  readFileSync(join(root, ".github", "workflows", name), "utf8");

describe("refresh workflow contracts", () => {
  it("runs London pint prices Monday and opens a review PR", () => {
    const source = workflow("drink-price-refresh.yml");
    expect(source).toMatch(/^  schedule:\n(?:    #.*\n)*    - cron: "30 7 \\* \\* 1"/m);
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("node scripts/refresh_drink_prices.mjs --open-pr");
  });

  it("runs London events daily and declares both provider keys", () => {
    const source = workflow("events-refresh.yml");
    expect(source).toMatch(/^  schedule:\n(?:    #.*\n)*    - cron: "45 15 \\* \\* \\*"/m);
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("TICKETMASTER_API_KEY: ${{ secrets.TICKETMASTER_API_KEY }}");
    expect(source).toContain("SKIDDLE_API_KEY: ${{ secrets.SKIDDLE_API_KEY }}");
    expect(source).toContain("npm run refresh:events -- --open-pr");
  });

  it("keeps weather on its existing daily schedule", () => {
    const source = workflow("weather-refresh.yml");
    expect(source).toContain('cron: "15 14 * * *"');
  });
});
```

- [x] **Step 2: Run the focused test and verify the real disabled-schedule failure**

Run: `npm test -- __tests__/refreshWorkflows.test.ts`

Expected: FAIL only because `events-refresh.yml` has its `schedule` block commented out; price and weather assertions pass.

- [x] **Step 3: Implement the smallest workflow change**

Uncomment the existing events schedule and replace the stale `DISABLED BY DEFAULT` comment with wording that says the job remains no-op-safe when both provider keys are absent. Do not alter the job command, permissions, or secret names. Leave the price and weather schedules unchanged.

- [x] **Step 4: Run the focused test to verify the fix**

Run: `npm test -- __tests__/refreshWorkflows.test.ts`

Expected: PASS with all scheduler contract tests green.

- [x] **Step 5: Commit the slice**

```bash
git add .github/workflows/events-refresh.yml __tests__/refreshWorkflows.test.ts
git commit -m "fix(actions): re-enable daily events refresh"
```

### Task 2: Validate dry-run behavior and repository state

**Files:**
- Review: `.github/workflows/drink-price-refresh.yml`
- Review: `.github/workflows/events-refresh.yml`
- Review: `.github/workflows/weather-refresh.yml`
- Review: `scripts/refresh_drink_prices.mjs`
- Review: `scripts/whatson/eventsRefresh.mjs`

**Interfaces:**
- Consumes: manual dispatch entrypoints and existing script no-op/review-PR flags.
- Produces: evidence that a manual run can be invoked and does not merge served data directly.

- [x] **Step 1: Validate workflow YAML syntax**

Run:

```bash
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |path| YAML.load_file(path); puts "PASS #{path}" }'
```

Expected: PASS for every workflow file.

- [x] **Step 2: Run the price dry run in scratch output mode**

Run:

```bash
scratch_dir="$(mktemp -d)"
node scripts/refresh_drink_prices.mjs --limit 1 --scratch "$scratch_dir"
find "$scratch_dir" -maxdepth 2 -type f -print
```

Expected: the script exits successfully, reports either a valid scratch artifact or a no-op, and writes only below the temporary directory. It must not create or modify `public/data/drink_price_updates/latest.json` and must not open or push a PR.

- [x] **Step 3: Run the keyless events dry run**

Run: `env -u TICKETMASTER_API_KEY -u SKIDDLE_API_KEY node scripts/whatson/eventsRefresh.mjs`

Expected: exit 0 with the explicit no-provider-keys no-op message and no change to `public/data/whats_on/events_london.json`.

- [x] **Step 4: Verify repository secret inventory through `gh-axi`**

Run: `~/.local/bin/gh-axi secret list`

Expected: record `EXA_API_KEY` as present. Record `TICKETMASTER_API_KEY` and `SKIDDLE_API_KEY` as absent if the inventory remains unchanged. The workflows declare exactly the names consumed by `eventsRefresh.mjs`; the implicit `GITHUB_TOKEN` is used only to open review PRs. Do not add provider keys.

### Task 3: Full verification, review, and commit

**Files:**
- Review: all changed files.

**Interfaces:**
- Consumes: scheduler tests, dry-run evidence, YAML validation, and repository test commands.
- Produces: committed task branch ready for firstmate validation.

- [x] **Step 1: Run requested checks**

Run:

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: typecheck exit 0, lint reports 0 errors, and unit suite meets the requested 7,495+ test count with no failures.

- [x] **Step 2: Review the final diff**

Run: `git diff --check && git status --short && git diff -- .github/workflows/events-refresh.yml __tests__/refreshWorkflows.test.ts`

Confirm no page copy, secrets, served data, generated files, direct-main push, or unrelated workflow changes are present.

- [ ] **Step 3: Commit the final branch**

```bash
git add .github/workflows/events-refresh.yml __tests__/refreshWorkflows.test.ts docs/superpowers/plans/2026-08-04-refresh-workflows.md
git commit -m "fix(actions): restore scheduled data refreshes"
```
