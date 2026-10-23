-- Foreign key covering indexes (0192).
--
-- An audit found foreign keys with no index on their own columns. When a
-- parent row is deleted, Postgres must check each child table for rows that
-- point at it. With no index, that check reads the whole child table while it
-- holds a lock. Deleting one profile did this on a dozen social and plan
-- tables.
--
-- This migration adds one plain btree index for each of the 53 foreign keys in
-- schema public that had no index leading with its columns. The list comes
-- from the real catalog after every migration, not from reading the SQL. A
-- partial index on `<column> IS NOT NULL` already covers its key, so those
-- keys are left alone.
--
-- Cost: each `create index` holds a SHARE lock on its table while it builds.
-- Reads continue, but writes to that table wait. These tables are small today,
-- so each build takes milliseconds. Each index also adds a little disk space
-- and a little work to every insert and update on its table. The indexes are
-- plain, not concurrent, because a migration runs inside one transaction.
--
-- Names follow <table>_<column>_fk_idx. The captain applies; agents ship SQL
-- only.
--
-- Pin: __tests__/foreignKeyIndexCoverageEffective.test.ts
-- Reverse: supabase/migrations/rollback/20261018130000_0192_foreign_key_covering_indexes_rollback.sql

begin;

create index if not exists night_memories_plan_completion_id_fk_idx on public.night_memories (plan_completion_id);
create index if not exists night_moment_consents_moment_id_fk_idx on public.night_moment_consents (moment_id);
create index if not exists night_moments_pint_drop_id_fk_idx on public.night_moments (pint_drop_id);
create index if not exists night_stories_legacy_crawl_story_id_fk_idx on public.night_stories (legacy_crawl_story_id);
create index if not exists night_story_moments_moment_id_fk_idx on public.night_story_moments (moment_id);
create index if not exists plan_constraints_member_id_fk_idx on public.plan_constraints (member_id);
create index if not exists plan_constraints_resolved_by_member_id_fk_idx on public.plan_constraints (resolved_by_member_id);
create index if not exists plan_crew_members_social_account_id_fk_idx on public.plan_crew_members (social_account_id);
create index if not exists plan_invites_created_by_member_id_fk_idx on public.plan_invites (created_by_member_id);
create index if not exists plan_route_proposals_proposed_by_member_id_fk_idx on public.plan_route_proposals (proposed_by_member_id);
create index if not exists plan_vibe_vote_requests_member_id_fk_idx on public.plan_vibe_vote_requests (member_id);
create index if not exists plan_vote_requests_member_id_fk_idx on public.plan_vote_requests (member_id);
create index if not exists plan_vote_requests_vote_id_fk_idx on public.plan_vote_requests (vote_id);
create index if not exists plan_votes_member_id_fk_idx on public.plan_votes (member_id);
create index if not exists plans_social_owner_account_id_fk_idx on public.plans (social_owner_account_id);
create index if not exists private_social_account_audit_product_account_id_fk_idx on public.private_social_account_audit (product_account_id);
create index if not exists private_social_age_verifications_product_account_id_fk_idx on public.private_social_age_verifications (product_account_id);
create index if not exists referral_milestone_ledger_triggering_edge_id_fk_idx on public.referral_milestone_ledger (triggering_edge_id);
create index if not exists social_blocks_blocked_profile_id_fk_idx on public.social_blocks (blocked_profile_id);
create index if not exists social_cheers_actor_profile_id_fk_idx on public.social_cheers (actor_profile_id);
create index if not exists social_content_reports_resolved_by_staff_role_id_fk_idx on public.social_content_reports (resolved_by_staff_role_id);
create index if not exists social_crew_invitations_crew_id_fk_idx on public.social_crew_invitations (crew_id);
create index if not exists social_crew_invitations_invited_by_member_id_fk_idx on public.social_crew_invitations (invited_by_member_id);
create index if not exists social_crew_invitations_target_account_id_fk_idx on public.social_crew_invitations (target_account_id);
create index if not exists social_crew_join_requests_decided_by_member_id_fk_idx on public.social_crew_join_requests (decided_by_member_id);
create index if not exists social_crew_join_requests_requester_account_id_fk_idx on public.social_crew_join_requests (requester_account_id);
create index if not exists social_crews_owner_account_id_fk_idx on public.social_crews (owner_account_id);
create index if not exists social_moderation_actions_staff_role_id_fk_idx on public.social_moderation_actions (staff_role_id);
create index if not exists social_notifications_actor_profile_id_fk_idx on public.social_notifications (actor_profile_id);
create index if not exists social_notifications_source_post_id_fk_idx on public.social_notifications (source_post_id);
create index if not exists social_post_create_requests_media_id_fk_idx on public.social_post_create_requests (media_id);
create index if not exists social_post_create_requests_post_id_fk_idx on public.social_post_create_requests (post_id);
create index if not exists social_post_edit_audit_actor_profile_id_fk_idx on public.social_post_edit_audit (actor_profile_id);
create index if not exists social_post_extra_photos_owner_profile_id_fk_idx on public.social_post_extra_photos (owner_profile_id);
create index if not exists social_post_media_owner_profile_id_fk_idx on public.social_post_media (owner_profile_id);
create index if not exists social_post_media_uploads_owner_profile_id_fk_idx on public.social_post_media_uploads (owner_profile_id);
create index if not exists social_post_moderation_actions_media_id_fk_idx on public.social_post_moderation_actions (media_id);
create index if not exists social_post_moderation_actions_post_id_fk_idx on public.social_post_moderation_actions (post_id);
create index if not exists social_post_moderation_actions_staff_role_id_fk_idx on public.social_post_moderation_actions (staff_role_id);
create index if not exists social_post_moderation_jobs_media_id_fk_idx on public.social_post_moderation_jobs (media_id);
create index if not exists social_post_remove_requests_post_id_fk_idx on public.social_post_remove_requests (post_id);
create index if not exists social_post_tag_events_actor_profile_id_fk_idx on public.social_post_tag_events (actor_profile_id);
create index if not exists social_post_tag_events_proposal_id_fk_idx on public.social_post_tag_events (proposal_id);
create index if not exists social_post_tag_proposals_author_profile_id_fk_idx on public.social_post_tag_proposals (author_profile_id);
create index if not exists social_post_tag_proposals_media_id_fk_idx on public.social_post_tag_proposals (media_id);
create index if not exists social_post_tag_proposals_target_profile_id_fk_idx on public.social_post_tag_proposals (target_profile_id);
create index if not exists social_post_videos_author_profile_id_fk_idx on public.social_post_videos (author_profile_id);
create index if not exists social_quotes_source_post_id_fk_idx on public.social_quotes (source_post_id);
create index if not exists social_reposts_actor_profile_id_fk_idx on public.social_reposts (actor_profile_id);
create index if not exists social_saves_actor_profile_id_fk_idx on public.social_saves (actor_profile_id);
create index if not exists social_video_uploads_claimed_post_id_fk_idx on public.social_video_uploads (claimed_post_id);
create index if not exists venue_photos_author_profile_id_fk_idx on public.venue_photos (author_profile_id);
create index if not exists venue_submission_files_owner_user_id_fk_idx on public.venue_submission_files (owner_user_id);

commit;
