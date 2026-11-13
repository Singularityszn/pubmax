// Hand-written types for scripts/e2e/supabase-project-cleanup.mjs (allowJs is
// off). Keep in lockstep with the implementation.

export type DockerRunner = (program: string, args: string[]) => Promise<string>;

/** Removes what a disposable Supabase project left in Docker and returns the names still present. */
export function removeSupabaseProjectLeftovers(projectId: string, run: DockerRunner): Promise<string[]>;
