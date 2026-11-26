alter table public.crawl_stories add column save_key uuid unique;
alter table public.crawl_stories add column save_hash text;

update public.crawl_stories s
set author_id = p.id
from public.profiles p
where s.author_id is null and p.user_id is not null
  and (
    (lower(s.author_handle) = lower(p.handle)
      and coalesce(p.handle_changed_at, p.created_at) <= s.created_at)
    or exists (
      select 1 from public.profile_handle_aliases a
      where a.profile_id = p.id and lower(s.author_handle) = lower(a.handle)
        and s.created_at >= a.claimed_at
        and (a.retired_at is null or s.created_at < a.retired_at)
    )
  );

create function public.save_crawl_story(p_story jsonb, p_stops jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p_story->>'id')::uuid;
  v_slug text;
  v_hash text;
begin
  insert into public.crawl_stories(id, author_id, author_handle, title, slug, summary, visibility, created_at, updated_at, save_key, save_hash)
  values (v_id, nullif(p_story->>'author_id', '')::uuid, p_story->>'author_handle', p_story->>'title', p_story->>'slug', p_story->>'summary', p_story->>'visibility', (p_story->>'created_at')::timestamptz, (p_story->>'updated_at')::timestamptz, (p_story->>'save_key')::uuid, p_story->>'save_hash')
  on conflict (save_key) do nothing returning slug into v_slug;
  if v_slug is null then
    select slug, save_hash into v_slug, v_hash from public.crawl_stories where save_key = (p_story->>'save_key')::uuid;
    if v_hash is distinct from p_story->>'save_hash' then raise exception 'save key reused with different content'; end if;
    return v_slug;
  end if;
  insert into public.crawl_story_stops(id, crawl_story_id, venue_id, position, note, pint_drop_id, arrived_at)
  select (s->>'id')::uuid, v_id, s->>'venue_id', (s->>'position')::integer, s->>'note', null, null
  from jsonb_array_elements(p_stops) s;
  return v_slug;
end $$;
revoke all on function public.save_crawl_story(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_crawl_story(jsonb, jsonb) to service_role;
