# herdr shortcuts - PUBMAXX fleet

Herdr 0.8.2, config at `~/.config/herdr/config.toml`. Prefix is **ctrl+b** (same as tmux). Press the prefix, release, then the key. Bold rows are your overrides; everything else is the herdr default. Keep it in a pinned tab.

## Attach, detach, sessions

| Do | Type |
|---|---|
| Open or re-attach to the persistent session | `herdr` |
| Detach, leave everything running | **prefix q** |
| Attach to a named session | `herdr session attach <name>` |
| List sessions | `herdr session list` |
| Stop a session (kills its panes and agents) | `herdr session stop <name>` |
| Reload config without restart | **prefix shift+r** or `herdr server reload-config` |
| Stop the server entirely (only before a reboot) | `herdr server stop` |
| Attach from another Mac over SSH | `herdr --remote <user@host>` |
| Check the client and server | `herdr status` |

Detach and close the terminal window freely: workers, firstmate and their panes keep running on the server. Never run `herdr server stop` while workers are live; that is a teardown.

## Workspaces (one per repo or project)

| Do | Key |
|---|---|
| Workspace picker | **prefix w** |
| Go to anything (fuzzy: workspace, tab, agent) | **prefix g** |
| New workspace | prefix shift+n |
| Rename workspace | prefix shift+w |
| Close workspace | prefix shift+d |
| New git worktree workspace | prefix shift+g |
| Toggle the agents sidebar | prefix b |

Fleet layout: workspace 1 `karan-agent-workspace` (firstmate in tab 1, one tab per worker), workspace 3 `COMMAND DECK` (nine monitoring panes). Presentation spaces (`└ <task>` workspaces) appear only when `config/herdr-presentation-spaces` is on.

## Tabs (one per worker)

| Do | Key |
|---|---|
| New tab | **prefix c** |
| Close tab | **prefix &** (shift+7) |
| Next / previous tab | prefix n / prefix p |
| Jump to tab 1..9 | prefix 1..9 |
| Rename tab | prefix shift+t |

## Panes

| Do | Key |
|---|---|
| Split side by side | **prefix %** (shift+5) |
| Split top and bottom | **prefix "** (shift+') |
| Focus left / down / up / right | **prefix h / j / k / l** |
| Cycle panes | prefix tab, prefix shift+tab |
| Zoom the focused pane full screen (toggle) | prefix z |
| Resize mode (then h/j/k/l, esc to leave) | prefix r |
| Rename pane | prefix shift+p |
| Close pane | prefix x |
| Open scrollback in your editor | prefix e |

## Copy, scroll, notifications

| Do | Key |
|---|---|
| Copy mode | **prefix y** |
| Inside copy mode: select | v or space |
| Inside copy mode: copy | y or enter |
| Inside copy mode: cancel | q or esc |
| Open the target of the latest notification (the worker that pinged) | prefix o |
| Settings | prefix s |
| Help overlay with every binding | prefix ? |

## Agents sidebar

The sidebar lists every agent with state icon, name, state text, pane, workspace and tab. Colours: Claude blue, Codex red, Grok cyan, OpenCode green, Pi mauve, Kimi peach. Click a row or use **prefix g** and type its name to jump to it. A row showing `working` with no output change for 15 minutes is a wedged pipeline step; tell firstmate before killing anything.

## hunk (diff review plugin)

From any worker pane, open the command palette (prefix ?) and pick `hunk: review changes`, `review this branch against its base`, `review staged`, or `review the last commit`. Comment inline, then `hunk: send review to agent` pushes the comments into that worker's composer. `hunk: close the review pane` when done.

## CLI you will use by hand

```bash
herdr workspace list                         # what is open, which agents are working
herdr agent list                             # every agent with state
herdr pane read <pane> --lines 40            # peek at a worker without focusing it
herdr pane send-keys <pane> Enter            # submit a stuck composer
herdr tab close <tab>                        # close a finished worker's tab
herdr notification list                      # pending pings
herdr --skill                                # the full agent-facing command reference
```

Panes are addressed `w<id>:p<id>` and tabs `w<id>:t<id>` as shown by `herdr workspace list`.

## Habits that keep the fleet healthy

- Detach with **prefix q**, do not close panes, when you leave.
- Firstmate owns worker tabs: let it open and close them; you only look.
- If a worker's pane looks frozen, read it with `herdr pane read` first; a `no-mistakes` step at 0% CPU for under 30 minutes is normal.
- Typing into a worker's composer directly is allowed; firstmate treats what you type as an order and reconciles it at the next check.
- After editing `config.toml`, **prefix shift+r** reloads it live.
