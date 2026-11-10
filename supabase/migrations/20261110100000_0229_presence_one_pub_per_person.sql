-- 0229: a person is "here" at one pub at a time (G11).
--
-- pub_presence was unique on (actor_hash, venue_id), so one person could be
-- live at two pubs at once. The server now leaves the old pub before it marks
-- the new one; this makes it a database rule. Older duplicate rows go first:
-- each actor keeps only their newest mark. The (actor_hash, venue_id) index
-- stays, because the server upserts on it.

begin;

delete from public.pub_presence older
using public.pub_presence newer
where older.actor_hash = newer.actor_hash
  and (older.created_at, older.id) < (newer.created_at, newer.id);

create unique index if not exists pub_presence_actor_uidx
  on public.pub_presence (actor_hash);

commit;
