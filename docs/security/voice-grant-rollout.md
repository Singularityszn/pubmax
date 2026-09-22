# Prepaid voice grant rollout

Migration 0157 and the application change exist only in this branch. We did not run a production migration, change the provider account or deploy anything.

Apply the migration before deploying the application. The new route refuses voice when its grant RPC is absent, while text remains available. Old and new app versions must not run together because the old version still trusts client release durations. Drain old deployments and wait for previously issued provider grants to expire before claiming that the new allowance governs all sessions.

The server reserves three minutes atomically against the existing 30-minute monthly allowance before requesting a provider URL. Every issuance uses a unique server-generated grant. A duplicated grant cannot issue again. Only failure before the URL is returned refunds that grant, once, to its original month. Client completion is advisory and cannot refund or change usage. A short call, a user who never connects, or an interrupted server response can still consume three minutes. The UI states this policy. It does not measure actual speech or provider billing.

Before each token issue, the route reads the configured ElevenLabs agent and verifies `conversation_config.conversation.max_duration_seconds` is a positive integer no greater than 180. The API key needs permission to read that agent and obtain its signed URL. Missing, unreadable or excessive caps fail closed with a text fallback and a refund tied to the server grant. Configure the agent with the repository provisioning script and verify its duration and override settings in the provider account before launch. This local implementation has not verified live replay, reconnect or client override behavior. Do not claim that application grants cap the provider bill. Keep provider account spend limits. No trusted completion webhook or reconciliation ledger exists yet.

Production requires durable allowance storage. Only development and test may use in-memory accounting. A failed refund keeps the allowance charged, records the unique grant id in a bounded error event and needs operator reconciliation. Never refund based on a client-reported duration.

Roll back the application before dropping the grant RPCs and table. The rollback preserves charged usage but removes grant and refund history. Export that history first if reconciliation remains pending. Returning to the old application also returns the client-duration weakness, so prefer a forward repair.

Cover privacy rollout: approved avatars remain public. Covers now use the profile owner and mate boundary with no-store responses. New browser requests use a version query and bypass old browser caches. Application code cannot recall shared-edge responses already stored under old cover URLs. Purge them during rollout or wait for the old one-hour shared cache lifetime to expire before claiming historical URLs are protected. Previously downloaded copies cannot be recalled.

Admin rollout: old timeless moderator cookies are intentionally invalidated. Moderators must sign in again. New signed sessions expire server-side after 24 hours.
