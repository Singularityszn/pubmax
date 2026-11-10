-- 0228: a Social video is reviewed once, from held (G16).
--
-- review_social_post_video set the decision on any row, so a stale moderator
-- tab could turn an approved video into a rejected one, or back. It now moves
-- only a held video. A second decision changes nothing and returns false.

begin;

create or replace function public.review_social_post_video(p_post_id uuid, p_decision text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid Social video decision';
  end if;
  update public.social_post_videos
     set review_state = p_decision, reviewed_at = now()
   where post_id = p_post_id
     and review_state = 'held';
  return found;
end;
$$;

revoke all on function public.review_social_post_video(uuid, text) from public, anon, authenticated;
grant execute on function public.review_social_post_video(uuid, text) to service_role;

commit;
