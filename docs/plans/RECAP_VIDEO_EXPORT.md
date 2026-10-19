# Recap video: MP4 export proposal

Status: proposal. The captain picks the render path. Nothing in this file is built.

## What exists now

- The recap page shows the recap video in the browser with `@remotion/player`.
- The flag `PUBMAX_RECAP_VIDEO=1` turns it on. It is off by default.
- No server renders a video. No MP4 file is made or stored.
- The licence basis is the Remotion Free Licence: a team of 3 people or fewer,
  contractors included. The captain confirmed this on 18 October 2026.

## What an export adds

A crew member taps "Save video" and gets an MP4 file of about 20 seconds,
1080 by 1920 pixels, 30 frames each second (about 600 frames).

The MP4 holds the same facts as the public recap page, and nothing more:

- the Plan name, each Stop's Venue name, time and logged pint price,
- the Route sketch,
- the Friends from published `person` moments,
- no drink count, by the PUBMAXX Promise.

## Two render paths

### Path A: Remotion Lambda

Remotion splits the 600 frames across many AWS Lambda functions (small
cloud workers that start on demand), then joins the parts into one MP4.

- Speed: about 15 to 30 seconds for each video.
- New vendor: an AWS account, with billing, an S3 bucket (cloud file store) and
  an IAM role (a set of AWS permissions).
- Work: a deploy script, a site bundle upload, an API route that starts a
  render, and a status poll.

### Path B: a render script on one worker

A Node script uses `@remotion/renderer` to render one video at a time on one
machine. A queue table holds the render requests.

- Speed: about 1 to 2 minutes for each video, plus the wait in the queue.
- New vendor: none if it runs in GitHub Actions. One small server if it runs
  as a worker (for example, a 4-core VM at about $8 each month).
- Work: the script, the queue table and a migration, and a "your video is
  ready" step.

## Cost for each 1,000 renders

These figures are estimates, not measurements. Measure one real render before
you pick a path.

Assumptions:

- One video is 600 frames at 1080 by 1920.
- AWS Lambda x86 costs $0.0000166667 for each GB-second (one second of
  1 GB of memory).
- GitHub Actions Linux 2-core costs $0.008 for each minute.

| | Path A: Lambda | Path B: Actions | Path B: small VM |
| --- | --- | --- | --- |
| Compute for one video | about 30 workers × 12 s × 2 GB + 60 GB-s for the join ≈ 780 GB-s | about 1.5 minutes | about 1.5 minutes |
| Compute cost for 1,000 | 780,000 GB-s × $0.0000166667 ≈ **$13** | 1,500 min × $0.008 ≈ **$12** | fixed **$8** each month (1,000 videos ≈ 25 hours) |
| Storage (S3 or Supabase) | less than $0.10 | less than $0.10 | less than $0.10 |
| Remotion fee, Free Licence | $0 | $0 | $0 |
| Remotion fee, Company Licence | $0.01 × 1,000 = $10, minimum $100 each month | same | same |

Notes:

- Remotion Lambda estimates its own cost after each render. Use that figure in
  place of this table when you have it.
- The Remotion fee applies to every path when the team is more than 3 people.
  Player previews in the browser are not renders and cost nothing.
- Path B on a VM costs the same at 10 renders or 1,000 renders. Above about
  1,500 renders each month, one VM can fall behind at busy times.

## Rules for either path

- Render only a Story that is published. Read it with
  `readPublishedRecapSource`, the same read as the public page.
- Build the input with `buildRecapVideoInput`. Do not build a second script.
- Delete the MP4 when the Story is unpublished or deleted.
- Do not show a drink count, a price that was not logged, or a Friend who was
  not published.
- Add the render vendor to `/privacy` before launch.

## Recommendation

Pick Path B on GitHub Actions first. It needs no new vendor and no new monthly
bill, and the cost is about the same as Lambda. The slow speed is acceptable
for a "your video is ready" message.

Move to Path A when one of these is true:

- a crew must have the video in less than 30 seconds, or
- the queue regularly waits more than 5 minutes.

## Decision for the captain

1. Pick Path A, Path B on Actions, Path B on a VM, or no export yet.
2. If you pick Path A, approve the new AWS account and its bill.
