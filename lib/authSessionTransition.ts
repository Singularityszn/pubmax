export type AuthSessionTransitionTracker = {
  update: (event: string | null, nextUserId: string | null) => boolean;
  currentUserId: () => string | null;
};

/**
 * Tells a person SIGNING IN from the page finding a session it already had.
 *
 * supabase-js announces a stored session on every cold load as `SIGNED_IN`
 * (its own session recovery does it during `initialize`), and a subscriber
 * registered while that runs hears it BEFORE the `INITIAL_SESSION` that settles
 * the boot. Read as a transition from no session, that is a sign-in on every
 * page load: a "Welcome back" greeting each time and an inflated
 * `user_signed_in` count. A sign-in is only a `SIGNED_IN` that arrives after
 * the boot settled, so nothing before `INITIAL_SESSION` counts.
 */
export function createAuthSessionTransitionTracker(): AuthSessionTransitionTracker {
  let currentUserId: string | null = null;
  let bootSettled = false;

  return {
    update(event, nextUserId) {
      if (event === "INITIAL_SESSION") bootSettled = true;
      const signedIn = event === "SIGNED_IN"
        && bootSettled
        && currentUserId === null
        && nextUserId !== null;
      currentUserId = nextUserId;
      return signedIn;
    },
    currentUserId() {
      return currentUserId;
    },
  };
}
