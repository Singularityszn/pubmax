# Pub Pal tool identity CLI proof

Source baseline: `d69cd6083e8d81d57d56075e35a431efb804a026`.

The production GET evidence from 8 October 2026 recorded 16 attached webhook
IDs. Each name also had an unattached client duplicate before the attached
webhook in the workspace list. The test fixture keeps those exact IDs in
[`pubPalToolIdentity.json`](../../../__tests__/fixtures/pubPalToolIdentity.json).
It reduces each collision to the client and the attached webhook. Other
workspace matches are not necessary to reproduce first-name selection.

The regression launches `scripts/pubpal/create-elevenlabs-agent.mjs` as a Node
CLI. A Node import replaces fetch with a disposable in-memory API fixture.
The fixture serves the current script's desired configuration with the captured
identity collision. Update requests receive local responses. No request reaches
ElevenLabs. The fixture records tool PATCH targets and the proposed agent
attachment list. It excludes secret payloads and header references.

Before the fix, [the CLI result](before-cli.json) shows `--check` exiting 1 with
144 differences against the client duplicates. The update path selects all
16 client IDs for both tool PATCHes and the agent's replacement attachment list.
This is a minimal reproduction, so its drift count differs from the original
provider read's 87 differences.

After the fix, [the same CLI result](after-cli.json) shows `--check` exiting 0
without a write. Update selects all 16 captured attached webhook IDs for both
tool PATCHes and the attachment list.

Run the proof with:

```sh
npx vitest run __tests__/pubPalAgentScriptCheck.test.ts -t 'captured attached' --silent=false
npx vitest run __tests__/pubPalAgentScriptCheck.test.ts __tests__/pubPalAgentScriptDryRun.test.ts
```

The suite also exercises reversed list order, multiple attached identities,
multiple compatible workspace identities, incompatible attached types, unrelated
unattached endpoints, production-to-tunnel and tunnel-to-production URL changes,
missing tools, unknown attachment IDs, incomplete lists, compatible tool reuse,
and creation. Refusal cases assert that no secret, tool, or agent write occurs.
Existing speech, timeout, prompt, event, and authentication settings retain
their existing tests.

This proof establishes script selection behavior and its correspondence to
captured production identities. It does not establish a provider update,
fresh conversation events, speech timing, typed-turn latency, deployment,
or production behavior after this source change.

The original read-only operation and its exact evidence remain separately
preserved in the task handoff directory. That operation made no provider write.
