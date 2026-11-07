"use client";

import { socialLazy } from "./SocialLazy";

// The edit door on a post the viewer wrote, in the feed and in the outbox.
// While the composer code loads, the wait keeps this door's own word and quiet
// style. It never borrows the page's primary Post door: a second filled "Post"
// inside a card gave the route two primary actions with one name until the
// code arrived.
export const SocialPostEditor = socialLazy(
  () => import("./SocialComposer"),
  "Edit controls",
  <button type="button" className="socialEditButton" disabled>Edit post</button>,
);
