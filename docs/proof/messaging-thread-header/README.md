# The thread header names who the thread is with

Shot on a production build (`NEXT_DIST_DIR=.next-prod npm run build`) at 390px,
driven with the browser suite's own auth doubles.

- `direct-header.png` - a direct thread whose read carries no membership and
  holds no messages. The inbox row names it: `@tom_the_lamb`, linked to the
  profile. Before this fix the head read "Conversation".
- `group-header.png` - a group thread named by its title, with its member count
  under it and the leave control beside it. A group is not a person, so the head
  is not a link and its monogram comes from the group's own name. Unchanged from
  #1704.
