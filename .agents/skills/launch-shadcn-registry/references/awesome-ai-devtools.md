# jamesmurdza/awesome-ai-devtools

- Repository: https://github.com/jamesmurdza/awesome-ai-devtools
- File: `README.md`
- List: AI-powered developer tools only. General-purpose agents,
  general frameworks, and data-analysis tools are rejected.

## Eligibility gate (MCP only)

Only generate an awesome-ai-devtools artifact when the shadcn registry
ships a working **MCP server**. Otherwise skip this target and say why:

1. An MCP endpoint or package exists for the registry domain
   (e.g. `https://example.com/mcp`, `https://example.com/api/mcp`,
   or an `mcp-*` npm package).
2. Verify it before drafting: the URL returns HTTP 200 / valid SSE or
   Streamable-HTTP handshake, or the package installs and lists tools.
3. The entry describes the MCP server, not the registry in general.

Precedent entries live under `### IDE Extensions`:

```markdown
- [FlyonUI MCP](https://flyonui.com/mcp) — MCP server for generating Tailwind CSS components, blocks, and pages using FlyonUI.
- [shadcn/studio MCP](https://shadcnstudio.com/mcp) — MCP server for generating shadcn/ui components, blocks, and pages.
- [Shadcn Space MCP](https://shadcnspace.com/mcp) — Connect Cursor, Claude Code, Antigravity, VS Code, and other AI tools to the Shadcn Space component registry.
```

## Section selection

Default to **### IDE Extensions** (where all shadcn MCP entries live).
Use **### UI Generators** only when the MCP endpoint itself generates UI
from prompts and the maintainer asks for that section instead. Confirm
with the user when in doubt.

## MCP URL by registry domain

Derive the link from the registry's own domain — never point at a
third-party aggregator:

| Registry exposes | Entry link (`profile.mcpUrl`) |
|------------------|-------------------------------|
| Dedicated page, e.g. `shadcnstudio.com/mcp` | `https://<domain>/mcp` |
| API route, e.g. `example.com/api/mcp` | Full route URL |
| npm package only | Package URL, e.g. `https://www.npmjs.com/package/<pkg>` |
| No MCP surface | No submission — skip target |

Ask for `profile.mcpUrl` when it cannot be inferred. Default guess is
`{homepage}/mcp`; verify with curl before drafting.

## Entry format

```markdown
- [<Name> MCP](<mcpUrl>) — MCP server for <what it generates> using <registry name>.
```

### Example

```markdown
- [OG Image CN MCP](https://ogimagecn.vercel.app/mcp) — MCP server for generating OG image components, blocks, and pages using OG Image CN.
```

### Field rules

| Part | Source |
|------|--------|
| Name | `profile.name` + ` MCP` suffix |
| Link | `profile.mcpUrl` (domain-derived, verified live) |
| Description | One clause: `MCP server for <components/blocks/pages> using <profile.name>`; mention Cursor / Claude Code / VS Code compat when true |

Match house style: `- ` bullet, em dash `—`, trailing period.

## PR details

- File: `README.md`, under `### IDE Extensions` (after existing MCP rows)
- Title: `Add <Name> MCP`
- Body (must satisfy `.github/PULL_REQUEST_TEMPLATE.md` checklist):

```markdown
Adds <Name> MCP (<mcpUrl>) to IDE Extensions.

- AI-powered: yes, MCP server for shadcn/ui code generation
- Developer-focused: yes, installs into Cursor / Claude Code / VS Code
- MCP endpoint verified: `curl -sS -o /dev/null -w "%{http_code}" <mcpUrl>`

## Checklist

- [x] The entry is a tool that uses AI
- [x] The entry is a developer-focused tool
- [x] The description is unambiguous and clear
- [x] The description matches the style of other entries
```

## Mapping from registry profile

```
name   ← profile.name + " MCP"
mcpUrl ← profile.mcpUrl (default {profile.homepage}/mcp, verified)
desc   ← MCP server for <profile.categories hint: components/blocks/pages> using <profile.name>
```

## Warnings

- No MCP, no PR. A registry without an MCP server does not belong in
  this list — say so instead of drafting.
- Verify the endpoint per registry domain; paths differ
  (`/mcp` vs `/api/mcp` vs package). Never guess-and-submit.
- Keep the description to what the MCP server does, not registry
  marketing.
