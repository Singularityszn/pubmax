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
