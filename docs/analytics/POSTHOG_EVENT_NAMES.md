# PostHog product event names

Authoritative registry and sanitization: `lib/analyticsEvents.ts`. This file is the dashboard index for firstmate funnels.

## Auth

| Event | Properties |
| --- | --- |
| `sign_in_initiated` | `provider` (`google`, `apple`, `microsoft`, `email`, `email_resume`, `handle_password`) |
| `user_signed_up` | `provider` (same enum as sign-in) |
| `user_signed_in` | _(none)_ |
| `user_signed_out` | _(none)_ |

## Plan and crawl

| Event | Properties |
| --- | --- |
| `plan_started` | _(none)_ |
| `stop_added` | `surface` (`map`, `plan`, `round`) |
| `crawl_locked` | `stops` (integer 1–10) |
| `route_opened` | `surface` (`map`, `plan`) |

## Pub and Pal

| Event | Properties |
| --- | --- |
| `pub_viewed` | `layer` (`curated`, `uk_base`) |
| `voice_started` | _(none)_ |
| `voice_ended` | `reason` (`user`, `disconnect`, `cap`, `error`) |

## Share and errors

| Event | Properties |
| --- | --- |
| `content_shared` | `channel` (`copy`, `native`, `whatsapp`, `x`, `sms`, `instagram`, `tiktok`), `surface` (`plan`, `recap`, `poster`, `tonight`, `other`) |
| `error_shown` | `surface` (closed page surface enum), `kind` (`network`, `auth`, `validation`, `server`, `unknown`) |

## System (browser SDK via `/ingest`)

| Event | Notes |
| --- | --- |
| `$pageview` | Coarse route templates only |
| `$web_vitals` | CLS, FCP, INP, LCP |
| `$exception` | Redacted messages, no stacks |

## LLM observability (server capture)

| Event | Properties |
| --- | --- |
| `$ai_generation` | `$ai_model`, `$ai_provider`, `$ai_latency`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_total_cost_usd` (optional), `route` (static API tag). No prompt or completion text. |

## Identity

- Signed-in users: PostHog `identify` with Supabase `user.id` only (no email or handle).
- Sign-out: `reset` then resume anonymous device id when consent remains granted.
