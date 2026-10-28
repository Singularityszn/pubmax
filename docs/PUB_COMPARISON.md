# Pub comparison

Status: source implementation. Validation and publication are separate steps.

`/tools` compares an exact order at two or three London pubs. The page loads no
map or voice SDK. It uses the existing venue search, canonical identities,
listed-price readers and walking provider. It creates no Round, price report,
plan or vote merely by calculating an order.

## Read contract

`GET /api/pub-comparison?venues=<comma-separated IDs>` returns public pub labels,
explicit drink/serving choices and public meeting points. An empty selection
returns the meeting points. Choices are the union of recorded items, so a drink
can be missing at another selected pub.

`POST /api/pub-comparison` accepts the bounded request defined in
`lib/pubComparison.ts`. The order contains category, exact drink label, explicit
serving and quantity. The optional meeting point is a catalogue ID. The API
rejects arbitrary coordinates, extra fields, duplicate pubs and duplicate lines.

Every response uses `private, no-store`. The body limit is 8 KiB. GET and POST
share the existing per-address limiter, with 20 requests per minute. Errors use
the common API envelope. No source URL from the request is fetched.

## Price and walking rules

Each item retains its source, publisher, read date, branch and serving. Exact
case/space normalisation does not substitute brands or serving sizes. Unknown
volume is not comparable. Legacy pint semantics apply only to qualified pint
rows, excluding half, bottle and other explicit-volume labels.

The existing listed-price age policy decides eligibility. Missing or aged
evidence remains visible with a reason, but contributes no line total. A complete
order requires every line. Incomplete subtotals never claim a saving.

Only existing published listing lanes enter this comparison. Community category
reports without exact drink and serving identity cannot complete an order.
Modelled estimates cannot complete an order either.

Walking requests contain only a selected public landmark and canonical pub
coordinates. The existing provider budget and cache limit each comparison to
three route legs. Times use the shared walking pace over routed geometry. A
straight-line fallback does not become a walking comparison.

## Planning and sharing

The chosen pub opens through its canonical map URL. The existing map acceptance
then leads into planning and invitations. This avoids inventing a new plan source
that the current database contract cannot store. The action is labelled
"Open this pub to plan". It does not claim that a plan already exists.

Public sharing includes reviewed pub labels and ledger links. Orders, totals,
meeting points, individual budgets and private plan tokens are excluded.
Private polls use the existing authenticated conversation endpoint. The user
loads their conversations, selects one, reviews the options and explicitly sends.
Account changes cancel private requests and discard their results.

Retries reuse the same message ID. The UI does not promise deduplication when
the server cannot establish the underlying migration. Unconfirmed sends ask the
user to inspect the conversation before retrying.

## Publication and measurement

The static explanation has canonical `/tools`. Personal choices never enter its
URL, metadata or sitemap. The drink-brand page links to it without changing
publication floors. Its provisional performance ceilings match the existing
planner family and require an isolated production measurement before publication.

The analytics tracking plan defines eight consent-aware events with no custom
properties. A complete comparison requires two complete totals. Link requests,
clipboard success, acknowledged poll sends and recipient engagement are distinct.

The Islington pilot and held station proposals remain separate from this tool.
