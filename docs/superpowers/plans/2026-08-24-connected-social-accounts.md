# Connected Social Accounts Implementation Plan

> **For agentic workers:** Use test-driven development for every provider capability and deletion behavior.

**Goal:** Let users link lawful external profiles and selectively import approved public content without promising universal social sync.

**Architecture:** Keep `external_social_accounts` as the only connection store. Add an explicit capability matrix per provider. Manual public links are the universal fallback. OAuth, content reads, and publishing stay separate capabilities with separate consent and expiry.

## Provider contract

| Provider | v1 capability | External gate |
|---|---|---|
| Instagram | Manual link now; professional-account OAuth later | Meta app, callback, review, advanced access, encryption key |
| TikTok | Manual link now; authorised profile and selected-video reads later | TikTok developer approval and Display API scopes |
| Letterboxd | Manual profile link and outbound badge | Letterboxd API approval before any data use |
| X | Manual link now; authorised public-post metadata later | X developer project and paid/read access as applicable |
| YouTube, Spotify, Snapchat, Strava, LinkedIn, website | Manual public link only | No import claim |

### Task 1: Capability and lifecycle contract

**Files:**
- Modify: `lib/socialConnections.ts`
- Modify: `lib/socialOAuth.ts`
- Create: `lib/socialProviderCapabilities.ts`
- Create: `__tests__/socialProviderCapabilities.test.ts`
- Modify: `__tests__/socialConnections.test.ts`

- [ ] Write failing tests that separate `manual_link`, `oauth_identity`, `read_selected_content`, and `publish`.
- [ ] Make UI read the matrix. Never infer capability from presence of a client ID alone.
- [ ] Add token expiry, refresh status, consent version, fetched time, and upstream revocation state through an additive migration.

### Task 2: Safe deletion and disconnect

**Files:**
- Create: `supabase/migrations/<timestamp>_social_connection_lifecycle.sql`
- Modify: profile deletion/export stores and routes.
- Modify: `app/api/social-connections/[provider]/route.ts`
- Create: `__tests__/socialConnectionDeletion.test.ts`

- [ ] Write failing tests for disconnect, profile deletion, export, token ciphertext removal, and upstream revocation retry.
- [ ] Disconnect local access immediately even if upstream revocation fails.
- [ ] Keep a minimal audit code, never token material or imported provider payload.

### Task 3: Provider certification

- [ ] Provision `SOCIAL_CONNECTION_ENCRYPTION_KEY` through Vercel, never source control.
- [ ] Register exact production and preview callbacks.
- [ ] Complete Meta and TikTok review with smallest scopes.
- [ ] Request Letterboxd API access only with a bounded profile-link use case.
- [ ] Certify connect, refresh, disconnect, provider denial, expired grant, and deleted upstream account.

### Task 4: User-selected source link intake

**Files:**
- Modify: `lib/wanted.ts`
- Modify: `components/wanted/WantedCapture.tsx`
- Create: `lib/externalSourceLink.ts`
- Create: `__tests__/externalSourceLink.test.ts`

- [ ] Accept user-pasted public URLs as provenance without server fetch.
- [ ] Require venue confirmation before public list promotion.
- [ ] Store provider, source URL, ingest method, consent state, fetched time, and expiry when provider API content is later added.
- [ ] Do not scrape provider pages or import follower graphs.
