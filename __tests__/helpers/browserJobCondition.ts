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
  }: {
    event?: BrowserEvent;
    fork?: boolean;
    result?: string;
    layout?: string;
    cancelled?: boolean;
  } = {},
): boolean {
  const expression = (condition ?? "true")
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .replaceAll("needs.change-scope", 'needs["change-scope"]');
  return Boolean(runInNewContext(`(${expression})`, {
    github: {
      repository: "Singularityszn/pubmax",
      event_name: event,
      event: event === "pull_request"
        ? { pull_request: { head: { repo: { full_name: fork ? "contributor/pubmax" : "Singularityszn/pubmax" } } } }
        : {},
    },
    needs: { "change-scope": { result, outputs: { layout } } },
    cancelled: () => cancelled,
  }, { timeout: 1000 }));
}
