# Loaded-route CI harness repair, 23 October 2026

[Browser layout job 120545044513](https://github.com/Singularityszn/pubmax/actions/runs/39991697098/job/120545044513) rejected one retried test.
The case loads the Victorian Soho crawl and opens its first venue at 1440 by 900.
Its first attempt exhausted the overall 30-second test deadline while waiting for the venue drawer.
The retry passed in 23.9 seconds. The zero-flake gate correctly kept the job red.
No failure trace artifact was available from that run.

## Diagnosis and change

The overall deadline covers cold navigation, onboarding, a click and the lazy venue drawer.
It expired before the final state assertion could use its normal wait.
The neighbouring cold desktop journey already uses a 90-second test deadline.
This repair applies that same harness budget to the loaded-route case.
It uses `expectSoleDesktopDrawer`, the existing shared assertion for drawer ownership.
The planner-transition observer remains and still rejects a transient planner handoff.
No application timer, route budget, API budget or Actions file changes.

The indexed-search file now blocks service workers because its network doubles must control the data.
The preceding test phase exposed worker-cache bypass in disposable phone fixtures.
This setting belongs to the four fixture cases, not to product service-worker behaviour.

## Evidence and limits

The exact published application source `7c4cafb790b80a77788f2f5f754900e1960d7468` built successfully.
The loopback app ran on port 3228 with disposable keyless stores and fake public auth configuration.
The unchanged case passed five local runs without retries, taking 4.0 to 8.5 seconds.
The repaired harness passed ten local runs without retries, taking 6.9 to 14.3 seconds.
All four indexed-search fixture cases also passed against that production app.
Scoped ESLint passed. [The receipt](ci-layout-repair.json) retains every observed duration.

The local baseline did not reproduce the CI timeout. The log identifies the failed overall deadline, not an application defect.
These durations are test runtimes. They are not a Web Vitals comparison or an application speed claim.
The repaired harness still requires a fresh GitHub pass with zero retries.
