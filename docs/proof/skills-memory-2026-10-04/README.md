# Skills maintenance and development memory proof

Recorded 4 October 2026 against main
`0fb8308fa818c9bdc9fe948c9c8b221b6f23f3c0`. This record covers installed
skills and a local development memory pilot. It establishes no product
release, real-device, provider voice, or Pub Pal memory proof.

## Installed skills

Backups include file digests, symlink targets, canonical global skill roots,
project skills and Matt Pocock plugin trees. Backup directory:
`~/.codex/backups/pubmaxx-skills-20261004T120501Z`. A restore manifest records
the quarantined direct Codex copy of `greploop-apps`; both harnesses now link
to its canonical `~/.agents/skills` copy.

Manifest-managed collections were checked through their manager. Eighty-seven
clean requested skills were already current. Local `implement` scripts/tests,
`research/DESCRIPTION.md` and the upstream-removed `resolving-merge-conflicts`
skill were preserved. Plugin managers confirmed Matt Pocock 1.2.3. Claude's
Matt plugin remains disabled; Codex's plugin is enabled.

| Collection | Reviewed revision | Outcome |
|---|---|---|
| Poteto / How | `b1ef42969ea7a2bb50aa26c2480274828a0385e7` | Current managed files preserved |
| Poteto Mode / pstack | `157aae39a733135e93d8b5b19ff62c6a84b0ad56` | Current; custom additions preserved |
| HumanLayer / Dex Horthy | `ca7c8088db69e315a8b2deea43820270457f8f3c` | Current; custom research files preserved |
| Matt Pocock | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | Current global files and plugin managers |
| Michael Shimeles | `4b72f46b045e6fef52e6a98d4c162dd309826aed` | Added before-and-after, code-structure, evidence-driven-testing and greploop; reconciled greploop-apps |
| Vercel agent skills | `063bee94c3f4df8453406c830b0a7df0f2860278` | Four trees match; `vercel-optimize` keeps four vendoring doc notes and the `lib/vercel.mjs` scope fix |
| Emil | `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` | Thirteen trees match, preserving emil-prototype name |
| Taste | `ce26fc25c0e5e8cab638f883de62d9a86ee5e45b` | Thirteen installed trees match |
| Anthropic Frontend Design | `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4` | Added canonical Codex skill; Claude already provides synced plugin |

Existing `new-feature` was already current. Existing pstack `unslop` remains
canonical; Michael's complementary guidance lives in its reference directory.
It must not fabricate opinions, anecdotes or user experiences. Project design
system, voice, proof and worktree rules retain authority.

Michael's before-and-after workflow referenced a deprecated Vercel capture
package. A local override retains one skill name and incorporates the current
Vercel formatter at `8306d34f459b6704e08e6adb5829fcddb0dc3557`. Capture uses the
user-requested browser. Evidence stays local unless publication to a specific
PR or service is authorised. No default upload to 0x0.st.

## Dependency checks

- `agent-browser --version`: 0.38.2. No release browser session was switched.
- Legacy `@vercel/before-and-after` 0.0.4 CLI runs, but npm marks it deprecated.
  Current formatter is the supported path for existing media.
- FFmpeg and ffprobe 9.0.2 installed from official Homebrew core. The ordinary
  variant lacked `ass`, so the separate keg-only `ffmpeg-full` variant was
  installed. With its bin directory scoped to the doctor command, libx264,
  subtitle filter and macOS capture-source checks pass. Existing default PATH
  and shell startup files remain unchanged. Actual recording and OS Screen
  Recording permission were not exercised. Screenshot capture was exercised.
- No new shared Playwright browser download or global script approval occurred.
- No dependency configuration or missing credentials may be called runtime
  provider proof.

## MemPalace pilot

Pinned stable package 3.10.0 installed with isolated `uv` tooling and Python
3.12. Local MiniLM embeddings use ONNX. Palace, corpus, configuration, manifest,
evaluation reports and tested backup are under
`~/.local/share/pubmaxx-memory-pilot`. Existing Codex memory remains intact.

Fifteen reviewed PUBMAXX documents and one approved, sanitised decision
checkpoint produced 238 drawers. Source path, revision, source modification
date, snapshot date and digest are recorded. No raw conversation, customer
record, credential or unrelated project was indexed.

Codex and Claude register local stdio MCP with `--read-only`. Claude reported
Connected. A fresh Codex client completed an actual search. This already-running
desktop chat still requires reconnect to expose the new tool list. Four scoped
read tools receive automatic approval; server read-only mode refuses mutations.
No network listener, automatic hooks, background saves or update checks exist.

| Check | Evidence | Result |
|---|---|---|
| Twenty history questions | Expected source in top five | 19/20; threshold 18 |
| Superseded and corrected decisions | ADR 0004 supersession, accepted ADR 0006, approved twelve-city checkpoint visible | Pass; rank is not authority |
| Restart | Same returned sources | Pass |
| Cold backup restoration | Same returned sources and 238 drawers | Pass |
| Concurrent readers | Both completed and retrieved expected ADR | Functional reads pass; strict ranking repeatability fails |
| Mutation denial | Delete probe against nonexistent id | Refused with read-only error -32003 |

The one retrieval miss did not return designated `docs/REFERRALS.md` within
five results. Other authoritative documents supported the rule; expected
source was not changed after the miss. Concurrent rankings and hydrated
passages varied. Keep this limitation visible while piloting development use.

Use explicit reviewed checkpoints. Retrieved memories are evidence requiring
current-repository verification. Read source status and supersession links,
not only the first search result. Source observation dates remain distinct
from indexing dates.

Pub Pal experimentation remains after V0, over confirmed memories only.
Supabase stays authoritative. Require owner isolation, correction freshness,
physical deletion, export, outage fallback and measurable retrieval benefit
before proposing production adoption. Browser clients receive no direct
MemPalace access. No raw typed or voice transcript retention.
