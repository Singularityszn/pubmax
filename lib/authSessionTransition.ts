export type AuthSessionTransitionTracker = {
  update: (event: string | null, nextUserId: string | null) => boolean;
  currentUserId: () => string | null;
};

export function createAuthSessionTransitionTracker(): AuthSessionTransitionTracker {
  let currentUserId: string | null = null;
  // supabase-js replays a stored session as SIGNED_IN before INITIAL_SESSION on
  // every cold boot. Only a SIGNED_IN after INITIAL_SESSION is a sign-in.
  let initialised = false;

  return {
    update(event, nextUserId) {
      const signedIn = initialised
        && event === "SIGNED_IN"
        && currentUserId === null
        && nextUserId !== null;
      if (event === "INITIAL_SESSION") initialised = true;
      currentUserId = nextUserId;
      return signedIn;
    },
    currentUserId() {
      return currentUserId;
    },
  };
}
