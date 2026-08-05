import { requireSupabaseAdmin } from "@/lib/supabase";

export type SocialRelationshipState =
  | "self"
  | "mutual"
  | "not_mutual"
  | "blocked";

export type SocialRelationshipResolution =
  | SocialRelationshipState
  | "unavailable";

export type SocialRelationshipServerDependencies = {
  queryRelationship: (
    firstProfileId: string,
    secondProfileId: string,
  ) => Promise<unknown>;
};

const defaultDependencies: SocialRelationshipServerDependencies = {
  async queryRelationship(firstProfileId, secondProfileId) {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "social_relationship_between_profiles",
      {
        p_first_profile_id: firstProfileId,
        p_second_profile_id: secondProfileId,
      },
    );
    if (error) throw new Error(error.message);
    return data;
  },
};

function isSocialRelationshipState(
  value: unknown,
): value is SocialRelationshipState {
  return (
    value === "self" ||
    value === "mutual" ||
    value === "not_mutual" ||
    value === "blocked"
  );
}

export async function socialRelationshipBetweenProfiles(
  firstProfileId: string,
  secondProfileId: string,
  dependencies: SocialRelationshipServerDependencies = defaultDependencies,
): Promise<SocialRelationshipResolution> {
  if (firstProfileId === secondProfileId) return "self";
  try {
    const relationship = await dependencies.queryRelationship(
      firstProfileId,
      secondProfileId,
    );
    return isSocialRelationshipState(relationship)
      ? relationship
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
