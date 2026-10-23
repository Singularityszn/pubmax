# One build per day proposal

Status: Karan approved this operating plan in this chat on 22 October 2026.

This proposal changes no Vercel setting, schedule, environment variable, or billing configuration.

## Why Git builds stop

On 22 October, the `chengdu` project reports `commandForIgnoringBuildStep: "exit 0"`.
The linked `pubmaxx` project has the same command.
Vercel cancels a build when this command returns zero.
GitHub reports these cancellations as successful commit statuses, so a green Vercel status does not prove a deploy exists.

The normal exact-SHA preview request also stopped at this command.
The Vercel dashboard offers a per-deployment **Use project's Ignore Build Step** checkbox.
Clearing that checkbox starts a Git-source rebuild without changing the saved project command.
This run used that control for commit `325122c23eb9d8bc809c4388448c0e5459146152` in the Preview environment.

## Approved operating plan

1. Reserve one cloud build slot per London calendar day at 09:00 Europe/London.
2. Select one reviewed commit with passing required checks before that slot.
3. Record its complete SHA, target environment, and owner before the build starts.
4. Create a Git-source deployment pinned to that SHA through the Vercel dashboard.
5. Clear the ignore checkbox for that deployment only.
6. Check `READY`, the target environment, the deployment ID, and the public `/api/version` SHA.
7. Run the map, Tonight, and public Pint Drop checks against that deployment.
8. Reuse that deployment for further checks throughout the day.

Preview is the default target.
If no candidate passes its checks, skip that day's slot.
A canceled or failed attempt consumes the slot until Karan approves another attempt.
This rule avoids an unbounded retry loop.
No scheduler or additional deployment service is needed for the first operating trial.

On a release day, Karan can select a staged Production build instead of the routine Preview build.
That build must skip domain assignment and pass the existing release requirements before any promotion.
Promotion requires separate captain approval.
A Preview artifact does not become the Production artifact because its build uses Preview values.
Do not silently create a second build to move between environments.

## Alternatives and limits

| Option | Behaviour | Tradeoff |
| --- | --- | --- |
| One manual daily slot, recommended | Keep the saved ignore command. Use the existing dashboard for one selected SHA. | Requires a named operator each day. No new workflow or credential is needed. |
| Automated daily selection | Add a reviewed scheduled workflow after the manual trial proves the selection and checks. | Requires an approved schedule, credential custody, and reliable duplicate prevention. |
| Build every push | Restore automatic builds. | Produces more previews and does not meet the one-build-per-day goal. |

This plan proposes no change to the current Turbo build-machine setting.
The operator must record an exception if an urgent repair needs another build that day.
An exception must name the reason and SHA.

## Approval record

Karan approved the manual daily slot at 09:00 London and the rule that failed attempts consume the slot.
This approval does not approve a production deployment or promotion.

References: [Vercel ignored-build semantics and the redeploy checkbox](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step), and [the repository release contract](../DEPLOYMENT.md).
