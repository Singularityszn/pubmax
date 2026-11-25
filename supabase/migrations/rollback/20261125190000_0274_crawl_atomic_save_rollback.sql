-- Rollback removes retry protection. It retains the author attribution backfill.
drop function if exists public.save_crawl_story(jsonb, jsonb);
alter table public.crawl_stories drop column if exists save_hash;
alter table public.crawl_stories drop column if exists save_key;
