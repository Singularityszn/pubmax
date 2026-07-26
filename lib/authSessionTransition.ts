export type AuthSessionTransitionTracker = {
  update: (event: string | null, nextUserId: string | null) => boolean;
};

export function createAuthSessionTransitionTracker(): AuthSessionTransitionTracker {
  let currentUserId: string | null = null;

  return {
    update(event, nextUserId) {
      const signedIn = event === "SIGNED_IN"
        && currentUserId === null
        && nextUserId !== null;
      currentUserId = nextUserId;
      return signedIn;
    },
  };
}
