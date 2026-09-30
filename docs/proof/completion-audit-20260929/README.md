# Completion and GitHub audit, 29 September 2026

Read [REPORT.md](REPORT.md) for verified repository status and recovery priorities.

Snapshot collection read local Git and filesystem metadata, GitHub records and PUBMAXX-related chat messages. It did not modify another checkout, publish files, push branches, merge PRs, apply migrations, deploy, install packages or run product tests. Reviewed source preservation and publication are a later phase, recorded separately in REPORT.md.

## Evidence boundaries

Only this README, REPORT.md and the directory's .gitignore are intended for repository publication. All JSON, NDJSON, text captures and Python scripts here are local evidence. They contain private chat context or machine-specific paths and must stay local. The .gitignore excludes them even during a broad add.

Local evidence files:

| File | What it establishes |
| --- | --- |
| `discovery.json` | Requested folder roots, Git candidates and PUBMAXX filename matches. |
| `local-git-manifest.json` | Every found PUBMAXX checkout, dirty-file metadata, branch ancestry, exact byte comparisons and exclusions. |
| `all-local-branches.json` | Local branch tips from both common Git directories, including branches without a worktree. |
| `standalone-folder-manifest.json` | Full file manifest for PUBMAXX-named folders outside embedded Git checkouts. |
| `github-remote-heads.json` | Live remote branch refs. |
| `github-live-pr-heads.json` | Live GitHub PR head refs, including closed PRs. |
| `github-completion-ledger.json` | All PR states, merge records and branch-head reachability. |
| `github-all-issues.ndjson` | All actual repository issues, excluding PR records. |
| `thread-local-metadata.json` | Local Codex inventory beyond the sidebar limit. |
| `thread-message-samples.json` | Full message-record scan of matching local sessions; recent excerpts and PR references retained. |
| `thread-surface-inventory.json` | Connector-visible recent and archived chat inventory. |
| `thread-*.json` | Selected connector thread reads, with tool payloads removed. |
| `historical-task-commit-reachability.json` | Live branch ancestry for named historical task commits. |
| `firstmate-inbox-metadata.json` | Filename-only checks of three historical review inbox paths. |
| `live-http.json` | HTTP status checks, without rendered-browser or permission claims. |
| `coordinator-production-evidence.json` | Production deployment details supplied by the coordinating lane's Vercel connector inspection. |

The scripts are one-off audit notes. They are not product tooling. No secret file contents were read. Secret-shaped tokens in chat excerpts were redacted. Metadata captures are snapshots; the active v0 owner continued work during this audit.

## Related implementation evidence

The publication also preserves the reviewed map and dependency receipts from their original branches. Their application changes were ported into the active `codex/v0-integration` branch, whose owner handles application publication. This audit includes only their committed proof files, avoiding a second application change.

| Evidence | Original source head | Boundary |
| --- | --- | --- |
| [Map opening and location checks](../maps-audit-20260929/audit.md) | `b81eecc602cc4f42bad5ca4c8406c93878456b4e` | Native browser API, permission and storage checks used controlled GPS inputs. They do not prove physical-device GPS or the later integrated branch. |
| [Dependency and skill checks](../dependency-skill-audit-20260929/README.md) | `cfd07931753deb6475ad64b0b6b36bfc95911af6` | Fresh committed-lock install, full local verification and isolated build. Browser smoke concerns the disposable gstack fixture, not PUBMAXX UI. |

Both original heads passed separate specification and standards source reviews. The dependency README retains its earlier review-pending wording as part of that dated receipt. These 29 September skill receipts precede the separate 30 September global skill cleanup. None of these records establishes a production deployment, applied SQL migration or completed integrated release.
