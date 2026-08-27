# Editorial overlay

Credited link-out picks for `/out` and `/tonight`. Not a harvest. Not a What's-On kind.

`latest.json` is written by `npm run editorial:poll` (`scripts/editorial/poll.mjs`). The rail reads that static file. This repo cannot run serverless cron for ingest, so a poll is a build or manual step.

## The hard rule

Store headline, canonical URL, publish time, a 240-character tag-stripped excerpt, and the publisher name. Never store `content:encoded` or Atom content. Never scrape HTML. Never invent a start time. Never imply PUBMAXX observed the event.

Allowlist lives in `lib/editorialRss.mjs`. ArtRabbit stays out.

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-08-27T12:00:00.000Z",
  "status": "ready", // or "degraded" when a feed could not be checked
  "items": [
    {
      "source_id": "leytonstoner",
      "title": "Point Taproom opens",
      "canonical_url": "https://leytonstoner.substack.com/p/point",
      "published_at": "2026-08-16T09:00:00.000Z",
      "excerpt": "A new tap in Leytonstone.",
      "attribution_label": "Leytonstoner"
    }
  ]
}
```

GLA rows (`gla-80117`) carry Open Government Licence credit in the rail, not as a stored field. Poll state (`poll-state.json`) is gitignored.

## Refresh

```
npm run editorial:poll        # due feeds only
npm run editorial:poll -- --all
```

UA is `PubmaxxBot/1.0 (+https://pubmaxxing.com)`. One request per feed per tick. If-Modified-Since. 24h backoff on 403/429. A 200 with zero items is degraded, not empty.
