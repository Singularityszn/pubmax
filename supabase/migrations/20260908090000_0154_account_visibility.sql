-- WHO CAN SEE A PROFILE IS THE ACCOUNT'S OWN CHOICE, AND THIS COLUMN IS WHERE
-- THAT CHOICE LIVES.
--
-- Privacy in this product has been per-surface and per-capability from the
-- start: a Plan is read through a member capability, a Social Crew through
-- membership, a conversation through participation. Every one of those is a
-- property of a surface rather than a decision a drinker made, so there has
-- never been a place to answer "who can see me". This is that place, and it is
-- the foundation of the account-privacy wave in docs/factory/roadmap.md.
--
-- A CLOSED WORD, NOT A BOOLEAN. `lib/accountVisibility.ts` owns the vocabulary
-- and the CHECK below mirrors it, exactly as `lib/drinks.ts` is mirrored by the
-- drink CHECKs: a third answer would then be a migration, which is the point.
-- A boolean column full of `true` says nothing about what it was true of.
--
-- ADDITIVE, NOT NULL, DEFAULT PUBLIC. Every account that exists today was made
-- under a public promise, so the default states what those rows already are
-- rather than changing what anybody agreed to. NOT NULL with a constant default
-- rewrites no table on PostgreSQL 11 or later, so this is safe on a live
-- `profiles`. `parseAccountVisibility` reads an ABSENT column as public too, so
-- a deploy that lands ahead of this apply serves every account exactly as it
-- serves them now; what it cannot do is SAVE a choice, and the store's guard
-- (`isMissingVisibilityColumnError`, lib/profileStore.ts) REFUSES that write
-- rather than answering 200 to somebody who asked to be private. That is the
-- opposite of the receipt-photo guard beside it, on purpose: losing a photo is
-- a cost, and losing a privacy choice is a lie.
--
-- NO GRANT AND NO POLICY MOVES. The column inherits `public.profiles`' existing
-- row-level security whole: 0067 grants SELECT to `authenticated` behind
-- `profiles_owner_select` (`user_id = auth.uid()`, so a browser JWT reads its
-- OWN row and no other), full DML to `service_role`, and NOTHING to `anon`.
-- Every public read of somebody else's profile therefore goes through the
-- service-role route in front of the table, which is where the projection seam
-- (`lib/profileVisibilityBoundary.server.ts`) decides what a reader may have.
-- Widening a grant here would hand a browser the one column that says what to
-- withhold, and it would say it about every account at once.

alter table public.profiles
  add column if not exists visibility text not null default 'public';

alter table public.profiles
  drop constraint if exists profiles_visibility_check;

alter table public.profiles
  add constraint profiles_visibility_check
  check (visibility in ('public', 'private'));

comment on column public.profiles.visibility is
  'The account''s own public/private choice (lib/accountVisibility.ts owns the vocabulary). Public on every row written before 0154, and public for every new account: the choice is offered on the profile, never asked for at the door. It governs the owner-authored profile card and the linked socials, never a price this account logged, which stays public evidence about a pub under the standing rule that we keep the prices.';
