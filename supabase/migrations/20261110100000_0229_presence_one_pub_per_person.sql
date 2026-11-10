-- 0229: a person is "here" at one pub at a time (G11).

begin;

delete from public.pub_presence older
using public.pub_presence newer
where (older.actor_hash = newer.actor_hash or older.handle = newer.handle)
  and (older.created_at, older.id) < (newer.created_at, newer.id);

create unique index if not exists pub_presence_actor_uidx
  on public.pub_presence (actor_hash);

commit;
