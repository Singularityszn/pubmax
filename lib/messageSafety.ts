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
