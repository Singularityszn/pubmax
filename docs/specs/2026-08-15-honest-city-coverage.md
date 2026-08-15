# Honest City Coverage

## Goal

Make every city entry say what PUBMAXX has now and what still needs work. Use the existing city capability record as the only authority.

## User problem

`/choose-city` currently calls every city map price-aware and says all city guides have prices and crawls. London has dated Pint Prices. The nine other city packs have listed pubs but no Pint Prices. Bath and Llandudno also have no reviewed crawls.

## Product contract

- Every enabled city card shows a short available-now line.
- A city with missing Pint Prices or crawls shows one concise needs line.
- London says it has dated Pint Prices. No other city can make that claim until `CityCapabilityProfile.prices` changes.
- Copy uses `CityCapabilityProfile`. No second manual capability table is allowed.
- Search and page copy do not claim that every city has prices or crawls.
- `/choose-city` publishes one `ItemList` JSON-LD entry per enabled city map.
- Structured data names city maps only. It does not invent prices, ratings, opening times, or venue facts.
- Existing city links, preferred-city writes, search, and location behavior stay unchanged.

## Layout contract

- Coverage copy sits inside the existing full-card link. No extra control or nested link is added.
- Mobile cards stay one column below 560 px.
- Long city names and coverage lines wrap. No ellipsis hides capability truth.
- Existing 44 px control floors and focus states stay unchanged.

## Verification

- Unit tests pin London, Manchester, and Bath as the three capability branches.
- JSON-LD tests pin enabled-city count, position, and canonical map URLs.
- Existing city chooser, city capability, sitemap, voice, lint, and type tests remain green.
