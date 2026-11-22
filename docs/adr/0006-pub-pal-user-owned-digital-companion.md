# ADR 0006: Pub Pal is a user-owned digital companion

## Status

Accepted

## Context

ADR 0004 limited Pub Pal to an optional presentation layer so character work could not weaken planning quality. The product direction now requires account-owned customization, voice, confirmed memory, and cosmetic progression. Treating those capabilities as presentation-only would hide durable ownership and privacy responsibilities.

## Decision

Pub Pal is an account-owned digital companion with a curated species, appearance, voice, structured personality, explicit visibility controls, confirmed structured memory, and nightlife-mastery progression.

The shared planning engine remains authoritative. A Pal may explain, search, and propose actions, but it cannot silently change recommendations, persist memory, publish content, invite people, or mutate Plans. Consequential actions require a visible confirmation. Generated prose, raw audio, and transcripts are never source-of-truth memory.

Progression unlocks only cosmetics, animation, home objects, reactions, and city lore. It never rewards alcohol quantity or changes planning quality. Core PubMax remains usable without creating a Pal, and every Pal-assisted action has a non-character equivalent.

The chat comes first, for every person. Nothing stands between a person and the chat composer:

- A signed-out person can open the chat and type. Sign-in is asked only when they send, and the typed question survives the sign-in round trip. The chat route refuses a signed-out caller when a paid model answers.
- Plain chat needs no 18+ answer. The 18+ check comes at the first action that acts in the world for the person: a table request (`POST /api/table-requests`) or a summon of mates (`/api/summon`). Both routes enforce it on the server.
- An account whose stored date of birth is under 18 stays out of Pal. The chat, Pal creation and voice routes refuse it.
- Look, name and voice setup are optional and never block the chat.

## Consequences

- Pal creation and voice access follow the [account age requirements](../../README.md#pub-pal-age-requirements).
- Users control creative identity and privacy, but cannot disable factuality, moderation, legal, or safety constraints.
- Voice credentials stay server-side. Raw audio and transcripts are never Pal memory.
  [STORE_READINESS section 5](../STORE_READINESS.md#5-privacy-questionnaire-answers)
  owns the provider privacy settings and live verification requirements.
- Futuristic brand expression lives in the interface, map, motion, and Pub Pal. Humanoid Night Signals are not part of the production experience.
