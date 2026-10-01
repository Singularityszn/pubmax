# R22 digest documentation correction

30 September 2026. Source-only correction to `docs/EMAIL_DIGEST.md`.

The previous introduction said credentials and opt-in activate the scaffold. Current source contradicts that claim: `resendEmailProvider.send` rejects configured sends because HTTP delivery is absent, and `listOptInAudience` always returns an empty array. The CLI contains no provider-send call or implemented dataset loading/composition.

The document now labels delivery as parked, distinguishes the generator from the planned batch entry, and states that transport, actual opted-in recipients and unsubscribe handling are still required. Removed provider marketing and false activation promises. Existing opt-out, source/freshness and rendering contracts remain.

No script, workflow, provider, account preference, schedule or dataset changed. The stale CLI message and workflow comments are explicitly disclosed; issue #1691 is not closed or reported implemented. No mail was sent and no credentials were read or installed. No runtime test was started while the docs/friends gates held the machine. `git diff --check` passed; full final verification remains pending.
