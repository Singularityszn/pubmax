import { describe, expect, it } from "vitest";

import { removeSupabaseProjectLeftovers } from "../scripts/e2e/supabase-project-cleanup.mjs";

const PROJECT = "pubmax-auth-0123456789ab";

type Kind = "containers" | "volumes" | "networks";

function fakeDocker(
  state: Record<Kind, string[]>,
  { stuck = [] as string[] } = {},
) {
  const calls: string[][] = [];
  const kindOf = (args: string[]): Kind =>
    args[0] === "ps" || args[0] === "rm" ? "containers" : args[0] === "volume" ? "volumes" : "networks";
  const run = async (program: string, args: string[]) => {
    if (program !== "docker") throw new Error(`unexpected ${program}`);
    calls.push(args);
    const kind = kindOf(args);
    const filter = args.find((arg) => arg.startsWith("name="));
    if (filter) {
      const needle = filter.slice("name=".length);
      return state[kind].filter((name) => name.includes(needle)).map((name) => `${name}\n`).join("");
    }
    const names = args.filter((arg) => !arg.startsWith("-") && !["rm", "volume", "network"].includes(arg));
    state[kind] = state[kind].filter((name) => !names.includes(name) || stuck.includes(name));
    if (names.some((name) => stuck.includes(name))) throw new Error(`docker ${args[0]} failed (1).`);
    return "";
  };
  return { run, calls, state };
}

describe("removeSupabaseProjectLeftovers", () => {
  it("removes the project's containers, volume and network that supabase stop left behind", async () => {
    const docker = fakeDocker({
      containers: [
        `supabase_db_${PROJECT}`,
        `supabase_auth_${PROJECT}`,
        `supabase_rest_${PROJECT}`,
        `supabase_kong_${PROJECT}`,
        "supabase_db_someone-else",
      ],
      volumes: [`supabase_db_${PROJECT}`, "supabase_db_someone-else"],
      networks: [`supabase_network_${PROJECT}`, "bridge"],
    });

    await expect(removeSupabaseProjectLeftovers(PROJECT, docker.run)).resolves.toEqual([]);

    expect(docker.state).toEqual({
      containers: ["supabase_db_someone-else"],
      volumes: ["supabase_db_someone-else"],
      networks: ["bridge"],
    });
  });

  it("removes containers before the volume and network they hold", async () => {
    const docker = fakeDocker({
      containers: [`supabase_db_${PROJECT}`],
      volumes: [`supabase_db_${PROJECT}`],
      networks: [`supabase_network_${PROJECT}`],
    });

    await removeSupabaseProjectLeftovers(PROJECT, docker.run);

    const removals = docker.calls.filter((args) => !args.some((arg) => arg.startsWith("name=")));
    expect(removals.map((args) => args.slice(0, 2).join(" "))).toEqual(["rm -f", "volume rm", "network rm"]);
  });

  it("preserves another project's resources when its id contains the selected id", async () => {
    const otherProject = `${PROJECT}-other`;
    const docker = fakeDocker({
      containers: [`supabase_db_${PROJECT}`, `supabase_db_${otherProject}`, `unrelated_${PROJECT}`],
      volumes: [`supabase_db_${PROJECT}`, `supabase_db_${otherProject}`, `unrelated_${PROJECT}`],
      networks: [`supabase_network_${PROJECT}`, `supabase_network_${otherProject}`, `unrelated_${PROJECT}`],
    });

    await expect(removeSupabaseProjectLeftovers(PROJECT, docker.run)).resolves.toEqual([]);

    expect(docker.state).toEqual({
      containers: [`supabase_db_${otherProject}`, `unrelated_${PROJECT}`],
      volumes: [`supabase_db_${otherProject}`, `unrelated_${PROJECT}`],
      networks: [`supabase_network_${otherProject}`, `unrelated_${PROJECT}`],
    });
  });

  it("removes nothing when supabase stop already left the project clean", async () => {
    const docker = fakeDocker({ containers: ["supabase_db_someone-else"], volumes: [], networks: ["bridge"] });

    await expect(removeSupabaseProjectLeftovers(PROJECT, docker.run)).resolves.toEqual([]);

    expect(docker.calls.every((args) => args.some((arg) => arg === `name=${PROJECT}`))).toBe(true);
  });

  it("reports what is left when docker cannot remove it", async () => {
    const docker = fakeDocker(
      {
        containers: [`supabase_db_${PROJECT}`, `supabase_kong_${PROJECT}`],
        volumes: [`supabase_db_${PROJECT}`],
        networks: [`supabase_network_${PROJECT}`],
      },
      { stuck: [`supabase_db_${PROJECT}`] },
    );

    await expect(removeSupabaseProjectLeftovers(PROJECT, docker.run)).resolves.toEqual(
      expect.arrayContaining([`supabase_db_${PROJECT}`]),
    );
    expect(docker.state.containers).toEqual([`supabase_db_${PROJECT}`]);
  });

  it.each(["", "pubmax-auth-", "supabase", `${PROJECT} --all`])(
    "refuses project id %j before it runs docker",
    async (projectId) => {
      const docker = fakeDocker({ containers: ["supabase_db_someone-else"], volumes: [], networks: [] });

      await expect(removeSupabaseProjectLeftovers(projectId, docker.run)).rejects.toThrow();

      expect(docker.calls).toEqual([]);
    },
  );
});
