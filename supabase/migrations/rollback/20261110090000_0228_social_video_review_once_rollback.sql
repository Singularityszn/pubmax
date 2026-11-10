-- Reverses 20261110090000_0228_social_video_review_once.sql.
--
-- COST: none to data. review_social_post_video again overwrites any earlier
-- decision, so a stale moderator tab can change a reviewed video.

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
   where post_id = p_post_id;
  return found;
end;
$$;

commit;
