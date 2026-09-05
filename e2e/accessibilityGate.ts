import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

// A failure has to name the ELEMENT, not just the rule: "serious:color-contrast"
// sends the next reader hunting through a whole surface, while the selector
// that failed IS the fix. Cap the list so one broken token in a long list does
// not bury the other rules that failed beside it.
const MAX_REPORTED_NODES = 5;

function describeViolation(violation: {
  id: string;
  impact?: string | null;
  help?: string;
  nodes: ReadonlyArray<{ target: ReadonlyArray<unknown> }>;
}): string {
  const selectors = violation.nodes
    .slice(0, MAX_REPORTED_NODES)
    .map((node) => node.target.map((part) => String(part)).join(" "));
  const remaining = violation.nodes.length - selectors.length;
  const tail = remaining > 0 ? `\n    (+${remaining} more)` : "";
  return `${violation.impact}:${violation.id} — ${violation.help ?? ""}\n    ${selectors.join(
    "\n    ",
  )}${tail}`;
}

export async function runAccessibilityGate({
  page,
  testInfo,
  include,
  exclude,
  label,
}: {
  page: Page;
  testInfo: TestInfo;
  include?: string[];
  exclude?: string[];
  /** Names this pass in the attached report, so one test's several runs are told apart. */
  label?: string;
}) {
  let builder = new AxeBuilder({ page });
  for (const selector of include ?? []) builder = builder.include(selector);
  for (const selector of exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();
  await testInfo.attach(label ? `axe-results ${label}` : "axe-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );
  if (blocking.length > 0) {
    const where = label ? ` [${label}]` : "";
    throw new Error(
      `accessibility gate failed${where} on ${page.url()}:\n  ${blocking
        .map(describeViolation)
        .join("\n  ")}`,
    );
  }

  return results;
}
