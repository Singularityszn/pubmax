import { runInNewContext } from "node:vm";

type BrowserEvent = "pull_request" | "merge_group" | "push" | "workflow_dispatch";
type BrowserContext = {
  event?: BrowserEvent;
  action?: string;
  label?: string;
  fork?: boolean;
  result?: string;
  layout?: string;
  cancelled?: boolean;
  labels?: readonly string[];
  results?: readonly string[];
  runId?: number;
};

export function browserJobExpression(
  condition: string,
  {
    event = "pull_request",
    action = "synchronize",
    label = "",
    fork = false,
    result = "success",
    layout = "ui",
    cancelled = false,
    labels = [],
    results = [],
    runId = 123,
  }: BrowserContext = {},
): unknown {
  const expression = condition
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .replaceAll("needs.*.result", "jobResults")
    .replace(/needs\.([\w-]+)/g, 'needs["$1"]')
    .replaceAll("github.event.pull_request.labels.*.name", "pullRequestLabels");
  return runInNewContext(`(${expression})`, {
    github: {
      workflow: "Browser tests",
      run_id: runId,
      repository: "Singularityszn/pubmax",
      event_name: event,
      event: event === "pull_request"
        ? { action, label: { name: label }, pull_request: { number: 7, head: { repo: { full_name: fork ? "contributor/pubmax" : "Singularityszn/pubmax" } } } }
        : {},
    },
    pullRequestLabels: event === "pull_request" ? labels : [],
    jobResults: results,
    matrix: { shard: 1 },
    needs: {
      "change-scope": { result, outputs: { layout } },
      "queue-proof": { result: "skipped", outputs: {} },
    },
    cancelled: () => cancelled,
    always: () => true,
    success: () => !cancelled && (results.length ? results : [result]).every((value) => value === "success"),
    failure: () => (results.length ? results : [result]).includes("failure"),
    format: (template: string, value: unknown) => template.replace("{0}", String(value)),
    contains: (list: unknown, item: string) =>
      Array.isArray(list) && list.some((entry) => String(entry).toLowerCase() === item.toLowerCase()),
  }, { timeout: 1000 });
}

export function browserJobCondition(condition: string | undefined, context: BrowserContext = {}): boolean {
  const expression = condition ?? "true";
  const hasStatusFunction = /\b(always|success|failure|cancelled)\s*\(/.test(
    expression.replace(/'(?:[^']|'')*'/g, "''"),
  );
  if (!hasStatusFunction && !browserJobExpression("success()", context)) return false;
  return Boolean(browserJobExpression(expression, context));
}

export function browserJobName(name: string | undefined, context: BrowserContext = {}): string {
  return (name ?? "").replace(/\$\{\{([\s\S]*?)\}\}/g, (expression) =>
    String(browserJobExpression(expression, context)));
}
