# PUBMAXX Night Architect for ChatGPT

The plugin searches public London pubs and prepares a three-stop evening inside ChatGPT. It requires no PUBMAXX account.

## Endpoint and tools

The application serves stateless Streamable HTTP MCP at `/api/mcp`. The production address after deployment is `https://pubmaxxing.com/api/mcp`.

| Tool | Inputs | Result |
| --- | --- | --- |
| `pubmaxx_search_venues` | A name, borough or supported district, plus an optional result limit | Up to eight public pub records with a map resource |
| `pubmaxx_venue_details` | A venue ID and optional history flag | Public prices and optional cited historic facts |
| `pubmaxx_plan_evening` | A London request, optional per-person budget in pence, walking limit, start timestamp and history flag | Three numbered pubs, cost evidence, walking estimates and warnings |
| `pubmaxx_replace_stop` | Three current IDs, a position, a replacement ID, drink category, alcohol-free flag and current constraints | A new estimate using public records, without changing a saved plan |

Search accepts a district when the existing London area catalogue recognizes its name or alias. Unsupported districts can return no matches. It does not infer a location from a ChatGPT account.

The host renders the map through the MCP Apps UI bridge. The replacement button asks ChatGPT to find an alternative. The host can refuse that message. The widget then gives a conversation fallback.

Venue links open the selected pub in PUBMAXX. The plugin does not transfer the complete route into the website.

A supplied start must be in the future, within 14 days, between 17:30 and 04:00 London time.
The plugin allows six hours from that start instead of using a website preset finish.

## Evidence and privacy

A fresh response does not mean a fresh price observation. Each price retains its source and recorded observation date. Undated and old bundled prices remain estimates under the shared price authority policy.

A budget covers one selected drink at each stop for one person. Food, travel and admission are extra. Missing prices prevent a guaranteed total. Venue cards show listed pint prices separately from the selected-drink route budget.

A pint budget ceiling requires attributable current prices at every stop. Remove the ceiling when that evidence is missing.

Generation retains the existing planner's walking basis. Replacement uses a disclosed straight-line estimate. A straight-line estimate cannot confirm a strict walking limit. Replacement clears old route confidence and operating evidence. Alcohol-free and other selected-drink costs remain unavailable unless supported. They never borrow a beer price.

History uses retrieved facts with safe HTTPS citations. It calls no narration model. No facts means no invented story.

The MCP server saves no plans, conversation history or account information. The existing planner receives the explicit planning request and platform address headers for its rate limiter. Cookies and account authorization headers are not forwarded. Existing provider and spend policies still apply. Aggregate timing and error measurements must exclude request text and raw addresses.

The endpoint bounds requests to 32 KiB and applies 120 requests per minute per hashed caller address. ChatGPT can concentrate many users behind one address. This is a small-pilot limit, not a claim of public capacity. Plan generation also spends its existing, tighter budgets. Do not invent per-user identities from untrusted headers to bypass those limits.

## Local checks

1. Install root dependencies with `npm ci`.
2. Run `npx vitest run __tests__/chatgptMcp.test.ts __tests__/chatgptMcpHttp.test.ts __tests__/chatgptMcpData.test.ts __tests__/chatgptGeneration.test.ts`.
3. Run `npm run test:chatgpt-map` for the existing local map protocol tests.
4. Run `npm run verify` for the repository checks.
5. Build and serve a private production server with the commands below.
6. Run the browser proof in another terminal.

For a keyless local check, use the same build directory and keyless flag for both commands.
The keyless flag permits loopback requests to the production build without enabling them on Vercel.

```sh
PUBMAX_E2E_KEYLESS=1 NEXT_DIST_DIR=.next-night-architect npm run build
PUBMAX_E2E_KEYLESS=1 NEXT_DIST_DIR=.next-night-architect npm run start -- --hostname 127.0.0.1 --port 38761
```

The standalone map proofs also accept `PUBMAX_BROWSER_CHANNEL=chrome` when the installed Chrome browser is needed. This does not download or replace the shared Playwright cache.

```sh
PUBMAX_MCP_BASE_URL=http://127.0.0.1:38761 PUBMAX_BROWSER_CHANNEL=chrome npm --prefix scripts/chatgpt-map run proof:night
```

The browser proof uses the real HTTP tools and real public data. Its iframe host is controlled locally. It does not prove authenticated ChatGPT compatibility or public hosting.
Record source checks, protocol checks, real-data checks, browser behavior and the production build separately.

## Pilot and public release

1. Deploy an approved preview with the existing production environment and budgets.
2. Connect its HTTPS MCP endpoint in a real ChatGPT test account using OpenAI's current developer instructions.
3. Check search, missing prices, cited history, planning, replacement and host link refusal on desktop and mobile.
4. Record the deployment commit, host behavior, successful tasks, scarcity answers, response timing, errors and existing provider spend.
5. Resolve pilot defects before proposing production deployment and directory submission.

Use the directory name **PUBMAXX Night Architect**. Describe it as **Find London pubs and plan a three-stop evening with listed prices, walking estimates and cited pub history.** Example prompts include "Find pubs in Soho", "Plan three pubs near King's Cross within my budget", and "Tell me the history behind these pubs".

Use the existing PUBMAXX brand assets and published privacy notice when preparing the listing. Check that the notice covers the actual data path before submission. Do not claim live prices, guaranteed bills, universal district coverage or directory approval.

Public hosting, real ChatGPT connection and directory approval are separate release receipts. No account linking, saved plans, receipt uploads, payments or new paid data subscriptions are included.

Official references: [MCP server guide](https://developers.openai.com/plugins/build/mcp-server), [ChatGPT UI guide](https://developers.openai.com/plugins/build/chatgpt-ui), and [submission guide](https://developers.openai.com/plugins/deploy/submission).
