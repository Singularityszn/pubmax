// PR-AGENT ANSWERS A TRUSTED COMMENT, HOLDS ONE SECRET AND RUNS A PINNED IMAGE.
//
// .github/workflows/pr-agent.yml carries the model key, so it may not be a
// pull_request workflow (__tests__/ciRunnerIsolation.test.ts). It answers an
// issue_comment instead, which always runs the copy of the file on main.
//
//   1. the only trigger is a new comment, and only a trusted author's slash
//      command on a pull request starts the job;
//   2. the job checks out nothing and uses no action, and the image it runs is
//      pinned by digest, because the upstream action builds FROM a moving tag;
//   3. the key reaches one step through its environment and is never
//      interpolated into the script, and every setting the step declares
//      reaches the container;
//   4. /describe posts a comment and never rewrites the pull request body.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { defined } from "@/__tests__/helpers/defined";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
type Job = {
  if?: string;
  "runs-on"?: string;
  permissions?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  on: Record<string, { types?: string[] } | null>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

const source = readFileSync(join(process.cwd(), ".github/workflows/pr-agent.yml"), "utf8");
const workflow = parse(source) as Workflow;
const job = defined(workflow.jobs["pr-agent"], "pr-agent job");
const step = defined(
  job.steps.find((entry) => entry.name === "Run PR-Agent"),
  'step "Run PR-Agent"',
);
const env = step.env ?? {};
const script = defined(step.run, "Run PR-Agent script");

describe("PR-Agent workflow", () => {
  it("starts on a new comment and nothing else", () => {
    expect(workflow.on).toEqual({ issue_comment: { types: ["created"] } });
  });

  it("starts the job only for a trusted author's slash command on a pull request", () => {
    const gate = defined(job.if, "job if").replace(/\s+/g, " ").trim();
    expect(gate).toBe(
      [
        "github.event.issue.pull_request",
        "startsWith(github.event.comment.body, '/')",
        "github.event.sender.type != 'Bot'",
        `contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)`,
      ].join(" && "),
    );
  });

  it("grants the token only what a comment needs", () => {
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: "read", issues: "write", "pull-requests": "write" });
  });

  it("checks out nothing and runs an image pinned by digest", () => {
    expect(job.steps.filter((entry) => entry.uses !== undefined)).toEqual([]);
    expect(env.PR_AGENT_IMAGE).toMatch(/^pragent\/pr-agent@sha256:[0-9a-f]{64}$/);
    expect(script).toMatch(/docker run --rm[\s\S]*"\$PR_AGENT_IMAGE"\s*$/);
  });

  it("hands the model key to one step through its environment", () => {
    const secretReads = [...source.matchAll(/\$\{\{[^}]*\bsecrets\b[^}]*\}\}/g)].map((match) => match[0]);
    expect(secretReads).toEqual(["${{ secrets.ANTHROPIC_KEY }}"]);
    expect(env.ANTHROPIC__KEY).toBe("${{ secrets.ANTHROPIC_KEY }}");
    expect(script).not.toContain("${{");
  });

  it("passes every declared setting to the container, and nothing undeclared", () => {
    const passed = [...script.matchAll(/--env ([A-Z0-9_]+)/g)].map((match) => defined(match[1]));
    const declared = Object.keys(env).filter((name) => name !== "PR_AGENT_IMAGE");
    expect([...passed].sort()).toEqual([...declared, "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH"].sort());
  });

  it("posts /describe as a comment and leaves the pull request body alone", () => {
    expect(env.PR_DESCRIPTION__PUBLISH_DESCRIPTION_AS_COMMENT).toBe("true");
  });
});
