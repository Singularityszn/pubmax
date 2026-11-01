/**
 * WHAT A MESSAGE DOOR SAYS WHEN IT REFUSES ON SAFETY GROUNDS. Pure leaf: it
 * imports nothing, so the inbox, the thread and the routes read one copy.
 *
 * A BLOCK NAMES NOBODY. Either party's block closes the door both ways, and the
 * sentence is the same whichever side set it, so a refusal never tells the
 * sender that they were the one blocked.
 */

/** One line for a block in either direction, and for a group with a block in it. */
export const MESSAGE_BLOCKED_LINE = "You can't message this account.";

/** The tap is the way through: the account has not answered the age question. */
export const MESSAGE_ADULT_REFUSAL = "Confirm you are 18 or over before messaging.";

/** The account answered under 18. There is no tap behind this one. */
export const MESSAGE_UNDER_18_REFUSAL =
  "The date of birth on your account is under 18, so messages are not open to you.";

/**
 * MATES ONLY, UNTIL THE AGE CHECK IS LIVE. Captain decision 8 (1 November
 * 2026) puts a third-party age check in front of posting, comments and direct
 * messages. Until that check ships, a NEW conversation opens only between
 * mates: two accounts that follow each other (`lib/followRelation.ts`). It
 * lifts by setting this to false in the commit that ships the age check.
 */
export const MESSAGE_MATES_ONLY = true;

/** The refusal when the people in a new conversation do not all follow each other. */
export const MESSAGE_MATES_ONLY_LINE =
  "For now you can message mates only: people you follow who follow you back.";
