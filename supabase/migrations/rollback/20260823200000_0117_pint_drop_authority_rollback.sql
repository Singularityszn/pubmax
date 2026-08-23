drop index if exists public.visit_reports_venue_authority_recent_idx;
alter table public.visit_reports drop column if exists authority_key;
