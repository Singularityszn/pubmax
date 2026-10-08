// Update and drift checking must resolve the same workspace identity.
export function resolveExistingTools(liveTools, attachedIds, wantedTools) {
  const attached = new Set(attachedIds ?? []);
  for (const id of attached) {
    if (!liveTools.some((row) => row?.id === id)) {
      throw new Error(`Attached tool ${id} is absent from the workspace tool list. No update was made.`);
    }
  }
  const resolved = {};
  for (const [name, wanted] of Object.entries(wantedTools)) {
    const matches = liveTools.filter((row) => row?.tool_config?.name === name);
    const attachedMatches = matches.filter((row) => attached.has(row.id));
    const compatible = (row) => row.tool_config.type === wanted.type &&
      row.tool_config.api_schema?.url === wanted.api_schema.url;
    const candidates = attachedMatches.length ? attachedMatches : matches.filter(compatible);
    if (candidates.length > 1) {
      throw new Error(`Ambiguous tool ${name}: ${candidates.length} ${attachedMatches.length ? "attached" : "compatible workspace"} identities (${candidates.map((row) => row.id).join(", ")}). No update was made.`);
    }
    const hit = candidates[0] ?? null;
    if (hit && hit.tool_config.type !== wanted.type) {
      throw new Error(`Attached tool ${name} (${hit.id}) does not match the requested ${wanted.type} type. No update was made.`);
    }
    if (hit && !hit.id) {
      throw new Error(`Tool ${name} has no workspace id. No update was made.`);
    }
    resolved[name] = hit;
  }
  return resolved;
}
