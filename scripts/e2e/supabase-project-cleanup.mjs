const PROJECT_ID = /^pubmax-auth-[0-9a-f]{12}$/;

// Containers come first: Docker refuses to remove a volume or network that a container still holds.
const RESOURCES = [
  { list: ["ps", "-a"], format: "{{.Names}}", remove: ["rm", "-f"] },
  { list: ["volume", "ls"], format: "{{.Name}}", remove: ["volume", "rm", "-f"] },
  { list: ["network", "ls"], format: "{{.Name}}", remove: ["network", "rm"] },
];

export async function removeSupabaseProjectLeftovers(projectId, run) {
  // An empty or loose name filter would match every container on the machine.
  if (!PROJECT_ID.test(projectId)) throw new Error("Refusing to clean an unrecognised Supabase project id.");
  const names = async ({ list, format }) =>
    (await run("docker", [...list, "--filter", `name=${projectId}`, "--format", format]))
      .split("\n").map((name) => name.trim())
      .filter((name) => name.startsWith("supabase_") && name.endsWith(`_${projectId}`));
  for (const resource of RESOURCES) {
    const found = await names(resource);
    if (!found.length) continue;
    try { await run("docker", [...resource.remove, ...found]); }
    catch { /* The final listing reports anything that stayed. */ }
  }
  const remaining = [];
  for (const resource of RESOURCES) remaining.push(...await names(resource));
  return remaining;
}
