# Social composer proof

Checked 5 August 2026.

- TypeScript and ESLint pass.
- PostgreSQL migration tests apply 0074, exercise viewer-specific Venue projection, tag consent, private media reads, CAS edits, and restore the pre-migration schema with rollback.
- Focused Vitest coverage checks 320 px-safe shell structure, multipart photo creation, failed-write storage cleanup, metadata stripping, dimension limits, multimodal moderation, strict request shapes, and consent store RPC boundaries.
- Manual browser proof still needs a verified beta account because Social stays disabled in default and keyless environments.

Required release proof: run verified-account Playwright at 320, 390, and 430 px in light and dark modes. Check keyboard focus, no horizontal overflow, text-only posting, photo posting, draft reload, failed-submit recovery, Venue projection, tag approval and withdrawal, and edit conflict recovery.
