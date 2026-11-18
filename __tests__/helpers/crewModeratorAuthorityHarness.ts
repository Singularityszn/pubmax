import { expect } from "vitest";
import { db, hold, key, outcome, rpc } from "./crewAdmissionHarness";

export type StaffInterruption = "crew-wait" | "revocation-commits" | "revocation-rolls-back";

export async function moderatorDuringInterruption(crew: string, staff: string, statement: string, interruption: StaffInterruption) {
  const suffix = key();
  const waiter = `staff_waiter_${suffix}`;
  const holder = `staff_holder_${suffix}`;
  const revoke = `update public.private_social_staff_roles set active=false,revoked_at=now() where id='${staff}'`;
  const barrier = interruption === "crew-wait"
    ? `select id from public.social_crews where id='${crew}' for update`
    : revoke;
  const held = await hold(`set local application_name='${holder}'; ${barrier}`, "postgres",
    interruption === "revocation-rolls-back" ? "rollback" : "commit");
  const pending = outcome(waiter, rpc(statement));
  try {
    await expect.poll(() => db().sqlAsync(`select exists(select 1 from pg_stat_activity waiter
      join pg_stat_activity holder on holder.pid=any(pg_blocking_pids(waiter.pid))
      where waiter.application_name='${waiter}' and holder.application_name='${holder}'
        and waiter.wait_event_type='Lock')`)).toBe("t");
    if (interruption === "crew-wait") db().sql(revoke);
  } finally {
    try { await held.finish(); } finally { await pending; }
  }
  return pending;
}
