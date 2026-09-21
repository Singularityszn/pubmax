# Prepaid voice grant rollout

Migration 0157 and application change are local deliverables. No production migration, provider update or deployment was performed.

Apply migration before deploying the application. The new route refuses voice when its grant RPC is absent; text remains available. Old and new app versions must not keep serving together after rollout: the old version still trusts client release durations. Drain old deployments and wait for previously issued provider grants to expire before claiming the new allowance governs all sessions.

The server reserves three minutes atomically against the existing 30-minute monthly allowance before requesting a provider URL. Every issuance uses a unique server-generated grant. A duplicated grant cannot issue again. Only failure before the URL is returned refunds that grant, once, to its original month. Client completion is advisory and cannot refund or change usage. A short call, a user who never connects, or an interrupted server response can therefore still consume three minutes. UI discloses this conservative allowance policy; it is not a measure of actual speech or provider billing.

Before each token issue, the route reads the configured ElevenLabs agent and verifies `conversation_config.conversation.max_duration_seconds` is a positive integer no greater than 180. The API key needs permission to read that agent as well as obtain its signed URL. Missing, unreadable or excessive caps fail closed with a text fallback and a server-bound refund. Configure the agent with the repository provisioning script and verify its duration/override settings in the provider account before launch. This local implementation has not verified the live provider's grant replay/reconnect semantics or protection against client override of provider limits. Do not advertise a guaranteed provider bill ceiling from application grant accounting alone; retain provider account spend limits. A trusted completion webhook and reconciliation ledger can later refund unused time accurately, but no such integration exists here.

Production requires durable allowance storage. In-memory accounting is restricted to development/test. A failed refund keeps allowance charged, records the unique grant id in a bounded error event, and needs operator reconciliation. Never refund based on a client-reported duration.

Rollback application before dropping the grant RPCs/table. The rollback preserves already charged usage but removes grant/refund history; export that history first if reconciliation remains pending. Returning to the old application also returns the client-duration weakness, so prefer a forward repair over routine rollback.

Cover privacy rollout: approved avatars remain public; covers now use the profile owner/mate boundary and no-store responses. New browser requests use a version query and bypass old browser caches. Existing shared-edge responses at old cover URLs cannot be recalled by application code. Purge them operationally at rollout or wait the old one-hour shared cache lifetime before claiming all historical URLs are protected. Previously downloaded copies cannot be recalled.

Admin rollout: old timeless moderator cookies are intentionally invalidated. Moderators must sign in again. New signed sessions expire server-side after 24 hours.
