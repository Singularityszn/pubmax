// Taking words back out of a conversation, said once, in a pure leaf.
//
// TWO DIFFERENT REMOVALS, and they must never be confused:
//
// 1. UNSEND takes ONE message away from EVERYBODY. Only its sender may do it,
//    and the thread keeps one line where it was, because a gap a reader cannot
//    explain reads as a fault. A reported message keeps its content for the
//    moderator out of every reader's sight: unsending is never a way to destroy
//    a report's evidence.
//
// 2. DELETE CHAT takes a WHOLE conversation away from ONE person. Everybody
//    else keeps it. A message that arrives later brings the thread back for
//    them, holding only what was said after they deleted it.

/** What every reader sees where an unsent message was. */
export const MESSAGE_UNSENT_LINE = "Message unsent";

export const MESSAGE_UNSEND_LABEL = "Unsend";
export const MESSAGE_UNSEND_CONFIRM_TITLE = "Unsend this message?";
export const MESSAGE_UNSEND_CONFIRM_LINE =
  "It comes off the thread for everybody in it.";
export const MESSAGE_UNSEND_FAILED_LINE = "Couldn't unsend that. Try again.";

export const CHAT_DELETE_LABEL = "Delete chat";
export const CHAT_DELETE_CONFIRM_TITLE = "Delete this chat?";
export const CHAT_DELETE_CONFIRM_LINE =
  "It goes from your inbox only. Anyone else in it keeps it, and a new message brings it back.";
export const CHAT_DELETED_LINE = "Chat deleted.";
export const CHAT_DELETE_FAILED_LINE = "Couldn't delete that chat. Try again.";
