// Which tool writes a --branch-id run may make. Workspace tools are shared by
// every branch of an agent, so a branch run never changes a tool Main has
// attached: a Main webhook whose endpoint or argument schema must change gets
// a new branch-only copy, and any other change to one stops the run before
// its first write. Pure.

import { toolDrift } from "./agent-drift.mjs";

/**
 * @param {object} input
 * @param {Record<string, object>} input.wantedTools The desired tool config by name.
 * @param {Record<string, {id: string, tool_config: object} | null>} input.resolvedTools The branch's tools by name.
 * @param {Set<string>} input.mainToolIds The tool ids Main has attached.
 * @param {string} input.secretId The existing workspace secret the webhooks name.
 * @returns {{name: string, method: "keep" | "POST" | "PATCH", id: string | null, config: object}[]}
 */
export function planBranchTools({ wantedTools, resolvedTools, mainToolIds, secretId }) {
  return Object.entries(wantedTools).map(([name, config]) => {
    const hit = resolvedTools[name];
    if (!hit) return { name, method: "POST", id: null, config };
    const drift = toolDrift(name, config, hit, secretId);
    if (drift.length === 0) return { name, method: "keep", id: hit.id, config };
    if (!mainToolIds.has(hit.id)) return { name, method: "PATCH", id: hit.id, config };
    if (config.api_schema && drift.every(({ path }) => path.startsWith(`tools.${name}.api_schema.`))) {
      return { name, method: "POST", id: null, config };
    }
    throw new Error(`Tool ${name} (${hit.id}) is attached to Main and differs from this repo. A branch run will not change it. No update was made.`);
  });
}
