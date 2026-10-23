# Plan-join Activity proof

Recorded on 8 October 2026 from baseline `8c9cfaf0f1cb3ab3fed53891bd2fd7748005981f`.

A local guest joined a host's plan through the real join handler and memory stores. The Auth provider used disposable fixture identities. An explicit follow through its real handler produced the comparison entry. Before the repair, the successful join formed mutual follows and left both recipient inboxes empty. After the repair, each recipient received one existing `follow` notification. A repeat join added no entry. A stranger who requested the host's handle received their own empty inbox.

The Activity UI ran in installed Chrome against a production build. Both baseline and repaired production builds passed. The final before screenshots use the preserved baseline follow handlers with the unchanged production Activity UI. The local fixture proxy forwarded UI requests to Next.js and served the real join, follow and notification handlers with local stores. Identity and completed-onboarding responses were fixtures. This proof does not establish production database behaviour or a production deployment.

The browser's measured inner width and height matched each listed viewport. The page had no horizontal overflow. The host saw `@guest`, and the guest saw `@host`. The desktop Follows filter retained the entry. The View link navigated to `/u/guest`.

| Viewport and theme | Before | After |
| --- | --- | --- |
| 390x844 light | [Empty inbox](before/activity-390x844-light.png) | [Follow entry](after/activity-390x844-light.png) |
| 390x844 dark | [Empty inbox](before/activity-390x844-dark.png) | [Follow entry](after/activity-390x844-dark.png) |
| 1440x900 light | [Empty inbox](before/activity-1440x900-light.png) | [Follow entry](after/activity-1440x900-light.png) |
| 1440x900 dark | [Empty inbox](before/activity-1440x900-dark.png) | [Follow entry](after/activity-1440x900-dark.png) |

The [before runtime](before-runtime.json) and [after runtime](after-runtime.json) record the explicit-follow comparison, successful join, recipient inboxes and stranger read. The regression test failed on the missing host entry before the fix and passed afterward. Related tests cover classic and collaboration retries, concurrent retries, existing mutuals, one-way follows, blocks, refused invites, failed joins and unauthenticated inbox reads. Durable insert-result tests distinguish success, the existing database uniqueness refusal, self-follow and a real insert failure.

The repair reuses the existing recipient-only follow event. It publishes no plan name, plan ID, venue or membership detail. It adds no activity kind or database schema.
