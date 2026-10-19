-- Rollback 0192: drop the foreign key covering indexes.
--
-- Cost: no data is lost. Deleting a parent row (a profile, a post, a plan
-- member) goes back to reading each child table in full while it holds a lock.
-- Each drop takes a short ACCESS EXCLUSIVE lock on its table.

begin;

drop index if exists public.night_memories_plan_completion_id_fk_idx;
drop index if exists public.night_moment_consents_moment_id_fk_idx;
drop index if exists public.night_moments_pint_drop_id_fk_idx;
drop index if exists public.night_stories_legacy_crawl_story_id_fk_idx;
drop index if exists public.night_story_moments_moment_id_fk_idx;
drop index if exists public.plan_constraints_member_id_fk_idx;
drop index if exists public.plan_constraints_resolved_by_member_id_fk_idx;
drop index if exists public.plan_crew_members_social_account_id_fk_idx;
drop index if exists public.plan_invites_created_by_member_id_fk_idx;
drop index if exists public.plan_route_proposals_proposed_by_member_id_fk_idx;
drop index if exists public.plan_vibe_vote_requests_member_id_fk_idx;
drop index if exists public.plan_vote_requests_member_id_fk_idx;
drop index if exists public.plan_vote_requests_vote_id_fk_idx;
drop index if exists public.plan_votes_member_id_fk_idx;
drop index if exists public.plans_social_owner_account_id_fk_idx;
drop index if exists public.private_social_account_audit_product_account_id_fk_idx;
drop index if exists public.private_social_age_verifications_product_account_id_fk_idx;
drop index if exists public.referral_milestone_ledger_triggering_edge_id_fk_idx;
drop index if exists public.social_blocks_blocked_profile_id_fk_idx;
drop index if exists public.social_cheers_actor_profile_id_fk_idx;
drop index if exists public.social_content_reports_resolved_by_staff_role_id_fk_idx;
drop index if exists public.social_crew_invitations_crew_id_fk_idx;
drop index if exists public.social_crew_invitations_invited_by_member_id_fk_idx;
drop index if exists public.social_crew_invitations_target_account_id_fk_idx;
drop index if exists public.social_crew_join_requests_decided_by_member_id_fk_idx;
drop index if exists public.social_crew_join_requests_requester_account_id_fk_idx;
drop index if exists public.social_crews_owner_account_id_fk_idx;
drop index if exists public.social_moderation_actions_staff_role_id_fk_idx;
drop index if exists public.social_notifications_actor_profile_id_fk_idx;
drop index if exists public.social_notifications_source_post_id_fk_idx;
drop index if exists public.social_post_create_requests_media_id_fk_idx;
drop index if exists public.social_post_create_requests_post_id_fk_idx;
drop index if exists public.social_post_edit_audit_actor_profile_id_fk_idx;
drop index if exists public.social_post_extra_photos_owner_profile_id_fk_idx;
drop index if exists public.social_post_media_owner_profile_id_fk_idx;
drop index if exists public.social_post_media_uploads_owner_profile_id_fk_idx;
drop index if exists public.social_post_moderation_actions_media_id_fk_idx;
drop index if exists public.social_post_moderation_actions_post_id_fk_idx;
drop index if exists public.social_post_moderation_actions_staff_role_id_fk_idx;
drop index if exists public.social_post_moderation_jobs_media_id_fk_idx;
drop index if exists public.social_post_remove_requests_post_id_fk_idx;
drop index if exists public.social_post_tag_events_actor_profile_id_fk_idx;
drop index if exists public.social_post_tag_events_proposal_id_fk_idx;
drop index if exists public.social_post_tag_proposals_author_profile_id_fk_idx;
drop index if exists public.social_post_tag_proposals_media_id_fk_idx;
drop index if exists public.social_post_tag_proposals_target_profile_id_fk_idx;
drop index if exists public.social_post_videos_author_profile_id_fk_idx;
drop index if exists public.social_quotes_source_post_id_fk_idx;
drop index if exists public.social_reposts_actor_profile_id_fk_idx;
drop index if exists public.social_saves_actor_profile_id_fk_idx;
drop index if exists public.social_video_uploads_claimed_post_id_fk_idx;
drop index if exists public.venue_photos_author_profile_id_fk_idx;
drop index if exists public.venue_submission_files_owner_user_id_fk_idx;

commit;
