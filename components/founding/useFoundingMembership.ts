"use client";

// Whether the person in front of this browser is a founding member, and which
// number they hold.
//
// ONE owner, for the same reason `components/auth/useViewerHandle.ts` is one
// owner: two surfaces ask this question (the account hub prints the mark, the
// arrival greeting opens the founders' door), and two copies of the rule would
// drift the moment either was edited. The rule has three states, not two:
//
//   loading  - nobody has answered yet. Show nothing. A founding surface that
//              renders on "not yet" would flash on for every arrival and then
//              vanish for the ninety-nine percent who are not founders.
//   member   - the live session answered with a number.
//   outsider - the live session answered, and there is no number.
//
// A person who is not a founding member sees NOTHING anywhere: no greyed door,
// no "you missed it" line, no count of how few are left. That is the captain's
// rule, and this hook keeps it by never handing a caller anything to render in
// the outsider state.
//
// It asks the account's own route, so the answer belongs to the live session
// and never to a device cache. It asks once per signed-in account.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { readAuthedIdentity } from "@/lib/currentIdentityRead";
import { parseFoundingMemberNumber } from "@/lib/foundingMembers";

export type FoundingMembership =
  | { state: "loading"; number: null }
  | { state: "member"; number: number }
  | { state: "outsider"; number: null };

const LOADING: FoundingMembership = { state: "loading", number: null };
const OUTSIDER: FoundingMembership = { state: "outsider", number: null };

export function useFoundingMembership(): FoundingMembership {
  const { user, identityResolved } = useAuth();
  // The answer is held WITH the account it is about, so the render that shows a
  // new account can never wear the last account's number while its own read is
  // still on the way.
  const [snapshot, setSnapshot] = useState<{
    userId: string | null;
    membership: FoundingMembership;
  }>({ userId: null, membership: LOADING });
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || !identityResolved) {
      // A signed-out reader is not an outsider, they are simply nobody here.
      // An unresolved session is not an outsider either: only a settled
      // identity may say "no number", and only about itself.
      const timer = window.setTimeout(() => setSnapshot({ userId: null, membership: LOADING }), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    let live = true;
    void readAuthedIdentity(userId)
      .then((answer) => {
        // A refused or limited read proves nothing about this account, so it
        // takes the same road as a thrown one and the surface stays loading.
        if (!answer.ok) throw new Error(`identity read answered ${answer.status}`);
        return answer.body as { foundingMemberNumber?: unknown } | null;
      })
      .then((body) => {
        if (!live || controller.signal.aborted) return;
        const number = parseFoundingMemberNumber(body?.foundingMemberNumber);
        setSnapshot({
          userId,
          membership: number === null ? OUTSIDER : { state: "member", number },
        });
      })
      .catch(() => {
        // A read that failed proves nothing. Staying in "loading" keeps the
        // founders surfaces off rather than telling a founding member they are
        // not one.
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [identityResolved, userId]);

  return snapshot.userId === userId && identityResolved ? snapshot.membership : LOADING;
}
