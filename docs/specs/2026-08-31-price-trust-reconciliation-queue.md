# Price Trust Reconciliation Queue

## Goal

Recover a first trust unlock when event or credit persistence fails after a
community price has already been logged.

## Contract

- A successful price and Pint Drop write keeps its `201` response.
- Trust reconciliation reports `synced` or `pending` separately from the price
  write.
- Every attributed price insert or correction queues its Venue and drink
  category in the same database transaction.
- Venue signals and moderation-only updates do not enter this queue.
- Queue work is service-role only. Browser roles cannot read or write it.
- Queue revisions use a never-reused sequence on every qualifying write. A
  worker acknowledges only the revision it processed, including after a prior
  queue row was deleted and recreated.
- Direct submission attempts reconciliation for low latency.
- A bounded cron drains remaining work. Failed work stays queued.
- Existing event fingerprints and account-credit keys remain the duplicate
  fences.
- A stored trust event with missing credits is repaired from its stored
  observation IDs. It is not replaced by a new event.
- No browser retry endpoint, viewer coordinate, handle key, or new public data
  practice is added.

## Receipt

`trustReconciliation: "synced"` means event and account credits are durable and
the processed queue revision was acknowledged.

`trustReconciliation: "pending"` means the price and Pint Drop are durable, but
trust credit still needs a worker retry. It never turns the accepted price into
a failed log.
