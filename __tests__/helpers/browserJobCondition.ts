import { runInNewContext } from "node:vm";

type BrowserEvent = "pull_request" | "merge_group" | "push" | "schedule" | "workflow_dispatch";

export function browserJobCondition(
  condition: string | undefined,
  {
    event = "pull_request",
    fork = false,
    result = "success",
    layout = "ui",
    cancelled = false,
    labels = [],
  }: {
    event?: BrowserEvent;
    fork?: boolean;
    result?: string;
    layout?: string;
    cancelled?: boolean;
    labels?: readonly string[];
  } = {},
): boolean {
  const expression = (condition ?? "true")
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .replaceAll("needs.change-scope", 'needs["change-scope"]')
    .replaceAll("github.event.pull_request.labels.*.name", "pullRequestLabels");
  return Boolean(runInNewContext(`(${expression})`, {
    github: {
      repository: "Singularityszn/pubmax",
      event_name: event,
      event: event === "pull_request"
        ? { pull_request: { head: { repo: { full_name: fork ? "contributor/pubmax" : "Singularityszn/pubmax" } } } }
        : {},
    },
    pullRequestLabels: event === "pull_request" ? labels : [],
    needs: { "change-scope": { result, outputs: { layout } } },
    cancelled: () => cancelled,
    contains: (list: unknown, item: string) =>
      Array.isArray(list) && list.some((entry) => String(entry).toLowerCase() === item.toLowerCase()),
  }, { timeout: 1000 }));
}
