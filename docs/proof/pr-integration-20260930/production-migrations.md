# Production migration handoff, 30 September 2026

Read-only production inventory on 30 September found migrations through 0160 applied on Supabase project `iankajxliutqogqkmvdg`. Recheck inventory before applying anything. The drink-aware Plan release needs the following files, in timestamp order. No production migration was applied during integration review.

| Label | Apply | Rollback |
| --- | --- | --- |
| 0161 | [20260929120000_0161_plan_selected_drink_evidence.sql](../../../supabase/migrations/20260929120000_0161_plan_selected_drink_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929120000_0161_plan_selected_drink_evidence_rollback.sql) |
| 0162 | [20260929130000_0162_plan_create_selected_drink_evidence.sql](../../../supabase/migrations/20260929130000_0162_plan_create_selected_drink_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929130000_0162_plan_create_selected_drink_evidence_rollback.sql) |
| 0163 | [20260929140000_0163_plan_replace_selected_drink_evidence.sql](../../../supabase/migrations/20260929140000_0163_plan_replace_selected_drink_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929140000_0163_plan_replace_selected_drink_evidence_rollback.sql) |
| 0164 | [20260929150000_0164_plan_proposal_selected_drink_evidence.sql](../../../supabase/migrations/20260929150000_0164_plan_proposal_selected_drink_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929150000_0164_plan_proposal_selected_drink_evidence_rollback.sql) |
| 0165 | [20260929160000_0165_plan_completion_selected_drink_evidence.sql](../../../supabase/migrations/20260929160000_0165_plan_completion_selected_drink_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929160000_0165_plan_completion_selected_drink_evidence_rollback.sql) |
| 0166 | [20260929170000_0166_plan_context_selected_drink_evidence.sql](../../../supabase/migrations/20260929170000_0166_plan_context_selected_drink_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929170000_0166_plan_context_selected_drink_evidence_rollback.sql) |
| 0167 | [20260929180000_0167_plan_replace_context_evidence.sql](../../../supabase/migrations/20260929180000_0167_plan_replace_context_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260929180000_0167_plan_replace_context_evidence_rollback.sql) |
| 0168 | [20260930120000_0168_plan_proposal_context_evidence.sql](../../../supabase/migrations/20260930120000_0168_plan_proposal_context_evidence.sql) | [Rollback](../../../supabase/migrations/rollback/20260930120000_0168_plan_proposal_context_evidence_rollback.sql) |

0161 adds a constrained evidence column. 0162-0165 update Plan creation, route replacement, proposal acceptance and completion to carry evidence. 0166-0168 clear evidence when the selected drink or zero-proof context changes, including replacement and later proposal acceptance. Read each rollback header before using it; dropping 0161 destroys saved evidence, and rolling back context protections allows stale evidence again. Undo in reverse timestamp order only after restoring a compatible app release.

Effective PostgreSQL tests cover writes, grants, constraints, context changes, proposal replay and rollback. Production-build browser tests saved and reloaded wine and cocktail evidence through real PostgREST, then changed wine context to beer and accepted the old proposal: stored evidence became null and stale wine text disappeared after reload. Both browser journeys passed on the integrated source with migrations through 0168.

After application, recheck migration inventory and PostgREST schema visibility before deploying. The scheduled release must hold if any required migration is missing. Repository authority: `supabase/AGENTS.md` says "The captain applies migrations; agents ship SQL only."
