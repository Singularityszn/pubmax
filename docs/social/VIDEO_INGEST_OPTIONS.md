# Video upload options

Research checked: 7 September 2026. Status: proposal, not a deployed contract.
This review used local source and current primary documentation. It did not provision services or run builds or browsers.

## Recommendation

Keep Supabase as the account, audience, media identity, and moderation authority.
Send large files directly to private storage. Process them asynchronously before staff review.
Use Supabase plus an isolated video worker as the reference design below.
Compare managed processing against that design before choosing hosting or a paid video vendor.

First finish the gallery upload contract. Add video processing through the same reservation and attachment lifecycle.
Do not widen the current MIME allowlist and call that HEVC support.
Do not advertise practical phone video uploads until real HEVC files produce checked, playable output.

## What the source already supports

| Area | Current source and implication |
| --- | --- |
| Server | Next.js on Vercel. Current Social routes receive multipart files. Vercel limits function request and response bodies to 4.5 MB. Large media must bypass these routes. [Vercel limits](https://vercel.com/docs/functions/limitations) |
| Storage | `lib/supabase.ts` selects the private `pint-drops` bucket by default. `lib/socialPostMedia.server.ts` uploads, signs, and removes objects. Keep its identity and cleanup rules. |
| Current video | `lib/socialMediaPolicy.ts` permits 4 MiB, 15 seconds, and 1920 pixels per side. It accepts bounded H.264 MP4 with optional AAC-LC. `lib/socialAvc.ts` validates headers; neither module transcodes. |
| Durable limits | Migration `0154_social_video` also constrains video bytes and duration. Larger processed video needs new policy and migration work. Changing browser limits alone cannot work. |
| Review and playback | Videos enter `needs_review`, outside the image scanner. Staff previews use native video controls. Approved audience checks precede 180-second signed URLs. See [current contract](SOCIAL_MEDIA_CONTRACT.md). |
| Native app | `capacitor.config.ts` loads the remote site. `lib/nativeCamera.ts` calls `getPhoto` and offers Camera or Photo Library. Its callers receive a photo `File`. It has no video path. |
| Installed capability | `package.json` requests `@capacitor/camera` `^8.2.3`. Local declarations include `recordVideo` and `chooseFromGallery`. A new capture dependency is unnecessary for the first native trial. |

Current Camera documentation supports native recording and gallery video selection since 8.1.0. `recordVideo` is unavailable on Web.
Its options expose persistence, but no codec or recording-duration control. Treat returned metadata as client hints.
Use native file URIs for large files. Avoid converting entire clips into base64 or several JavaScript buffers.
Bind persistent local files to the account and remove them on cancellation or completed upload.
The current iOS plist lacks a microphone usage description. Check native permission requirements before enabling sound recording.
Test the installed plugin in both shells before promising background upload or restart recovery. [Camera API](https://capacitorjs.com/docs/apis/camera)

Keep a gallery picker on Web. Offer recording separately where supported, without removing access to existing videos.
Apple documents HEVC camera output and a separate H.264 compatibility setting. Sharing can convert media, but that conversion is conditional.
The application must not depend on the picker converting HEVC. [Apple media formats](https://support.apple.com/en-us/116944)

## Decision table

Prices below are public USD rates, before tax. They are not quotes or verified account entitlements.

| Option | Upload and playback | Limits and compatibility | Cost and operational trade-off |
| --- | --- | --- | --- |
| Existing Supabase plus isolated worker | Direct private TUS upload. Worker decodes and creates H.264/AAC MP4 plus poster. Start with signed MP4 playback; add adaptive streaming only when needed. | Supabase Free permits at most 50 MB per file. Pro and higher permit configurable limits up to 500 GB. Bucket limits still apply. HEVC support depends on the deployed decoder and tested outputs. [File limits](https://supabase.com/docs/guides/storage/uploads/file-limits) | Pro starts at $25/month. Includes 100 GB storage, 250 GB uncached egress, and 250 GB cached egress. Overage: $0.0213/GB storage, $0.09/GB uncached, $0.03/GB cached. Worker compute and transfer are extra. We own decoder updates, retries, output checks, and capacity. [Pricing](https://supabase.com/pricing) |
| Mux | Direct resumable upload with UpChunk or native SDKs. Signed playback policy requires server-issued JWTs. [Uploads](https://www.mux.com/docs/guides/upload-files-directly), [playback](https://www.mux.com/docs/guides/secure-video-playback) | HEVC is documented standard input. This does not prove every phone HDR variant. Upload URL expiry defaults to one hour; allowed range is one minute to seven days. Verify hard source limits before selection. [HEVC](https://www.mux.com/docs/changelog/hevc-standard-input-general-availability), [upload API](https://www.mux.com/docs/api-reference/video/direct-uploads/create-direct-upload) | Basic input is free. At 1080p, storage is $0.003/minute/month and delivery is $0.001/minute after allowances. First 100,000 monthly delivery minutes are free. Free plan stores only ten videos; production volume needs another plan. Extra quality levels and features change pricing. [Pricing](https://www.mux.com/pricing), [quality pricing](https://www.mux.com/docs/pricing/overview) |
| Cloudflare Stream | Direct creator upload with TUS. Require signed URLs when creating the upload. Managed adaptive H.264 playback reaches 1080p. [Upload API](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/), [output](https://developers.cloudflare.com/stream/) | TUS is required above 200 MB and recommended for unreliable networks. Source files must be below 30 GB. MOV is listed, but reviewed docs do not explicitly guarantee HEVC input. Obtain confirmation and test actual phone files. HDR output becomes SDR. [Formats](https://developers.cloudflare.com/stream/uploading-videos/), [FAQ](https://developers.cloudflare.com/stream/faq/) | Storage costs $5 per 1,000 minutes of capacity. Delivery costs $1 per 1,000 minutes. Ingest and encoding are included. Pending upload duration reserves capacity. We retain application permissions and moderation work. [Pricing](https://developers.cloudflare.com/stream/pricing/) |

Supabase TUS uses the direct `project.storage.supabase.co` hostname and currently requires 6 MiB chunks.
It supports signed upload tokens through `x-signature`. Upload resources last up to 24 hours.
Signed upload tokens separately last two hours. Resume must handle both expiry rules and recheck the current account.
Use a fresh server-generated object key and disable overwrite. [TUS documentation](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [signed upload tokens](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)

Reserve the enforced object byte ceiling against account quotas until actual size is verified.
A client-declared small size must not buy a capability that can consume the whole bucket limit.

An isolated worker means a container or equivalent process with CPU, memory, disk, and wall-time bounds.
It does not mean a Supabase Edge Function. That runtime has 256 MB memory and two seconds of CPU per request.
Use functions for small control requests and job dispatch. [Edge Function limits](https://supabase.com/docs/guides/functions/limits)

### Cost example

Assume 1,000 clips lasting 30 seconds, retained for one month, with ten complete views each.
That gives 500 stored minutes and 5,000 delivered minutes, excluding staff views and buffering.

| Option | Illustrative cost calculation |
| --- | --- |
| Supabase plus worker | At 3 Mbit/s total output, clips occupy about 11.25 GB and views transfer about 112.5 GB. A 50 MB average source adds 50 GB of worker reads. Apply actual remaining allowances, transfer paths, and measured worker CPU time. Compute is unpriced until a worker host and benchmark exist. |
| Mux Basic, 1080p | Listed storage is $1.50/month. Delivery falls within the documented allowance if unused elsewhere. Before monthly usage credits, add-ons, and other account usage. This volume exceeds the ten-video Free plan. |
| Cloudflare Stream | One 1,000-minute storage block costs $5; 5,000 delivered minutes cost $5. Approximate total: $10, with sufficient free capacity for pending reservations. |

These calculations use the linked pricing above. They exclude existing database costs, moderation labour, and application hosting.
Measure upload failures, processing time, stored source bytes, and delivered minutes before estimating scale.

## Privacy, moderation, and deletion

Keep originals in private quarantine. Only processing jobs may read them by default.
Supabase private buckets require authorised reads or signed URLs. Neither route makes a signed URL account-bound after issuance. [Bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals)

Managed providers receive original media, including metadata before processing. Use opaque upload identifiers, without handles, venues, or account emails.
Provider choice must establish processing regions, subprocessors, retention, and deletion terms. This review does not confirm UK-only storage for either provider.
Require signed playback from asset creation, including posters and downloads. Domain restrictions alone do not implement Friends visibility.
Cloudflare's signed setting disables public playback links. Mux signed access requires JWTs with an expiry. [Cloudflare security](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/), [Mux security](https://www.mux.com/docs/guides/secure-video-playback)

Processing success means playable output, not acceptable content. Keep every video held until the existing staff decision.
Staff must review the full clip with sound where present. First-frame loading alone cannot establish that the whole clip was reviewed.
Do not pass video to the image scanner or approve a video from its poster.

Preserve the existing 30-day detached-media retention and audit rules. Track originals and temporary files separately from published attachments.
Proposed temporary retention: delete successful source files after output checks; expire abandoned or failed attempts after 24 hours.
Stop publication immediately on cancellation or deletion. Reconcile late upload completions until upload capabilities have expired.
Delete provider objects before completing cleanup records. Retry partial failures and retain a deletion marker against late callbacks.
Use the [Supabase Storage API](https://supabase.com/docs/guides/storage/management/delete-objects), [Mux asset deletion](https://www.mux.com/docs/api-reference/video/assets/delete-asset), or [Cloudflare video deletion](https://developers.cloudflare.com/api/resources/stream/methods/delete/).
SQL deletion alone leaves Supabase objects behind. Cloudflare cannot return the exact uploaded original, which limits later migration. [Cloudflare FAQ](https://developers.cloudflare.com/stream/faq/)

## Short implementation contract

The following choices are proposed. The gallery owner should incorporate them into the existing contract, without a second attachment system.

| Boundary | Required behaviour |
| --- | --- |
| Reserve | Authenticate the signed account and Social access. Derive the owner and immutable media ID server-side. Bind reservation to account, generation, post intent, and idempotency key. Enforce account byte budgets and concurrent-upload limits before issuing credentials. |
| Upload | Return only a scoped upload capability and small JSON. Send bytes directly to storage or the selected processor. Use a separate private raw bucket to enforce source limits without widening existing photo limits. Do not expose a service key. |
| Validate | Read actual stored bytes and derive type, duration, dimensions, tracks, and hash. Client MIME, dimensions, duration, and completion messages are hints. Never accept a client-supplied arbitrary fetch URL. Bound remote reads and decoder resources. |
| Process | Decode the complete source and encode fresh output. Apply orientation; handle HDR colour conversion explicitly. Remove location, device, creation-time metadata, and unused streams. Verify output bytes, duration, poster, audio, and complete decode before marking ready. |
| Publish | Separate processing state from moderation state. Attach only the current owned, processed generation. Keep atomic post writes, expected mutation version, consent checks, and idempotency. Processing completion cannot approve or silently replace a post. |
| Callback | Verify provider signatures over the raw request body and enforce timestamp tolerance. Bind events to stored asset ID and generation. Replays and reordered events must be harmless. Recheck status through the provider API when needed. |
| Read | Keep the authenticated `format=json` permission check. Issue short-lived playback and poster URLs only after current audience, block, and approval checks. Preserve optional legacy `photo.kind` and `contentType` compatibility while the gallery adds ordered media. |
| Client | Show upload progress, processing, held review, failure, and retry separately. Scope resume state and local drafts to the active account. Upload completion is not publication. Abort transfers and revoke local URLs on account changes. |
| Cleanup | Extend existing claimed cleanup jobs to source files, outputs, posters, and external asset IDs. Keep generation guards and audit references. Sweep unclaimed completed uploads as well as known failures. |

Webhook contracts: [Mux verification](https://www.mux.com/docs/core/verify-webhook-signatures), [Cloudflare verification](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/).
FFmpeg copies some metadata by default. Configure mapping explicitly and inspect outputs. [FFmpeg metadata controls](https://ffmpeg.org/ffmpeg.html#Advanced-options)

## Practical increments and open choices

1. Finish authenticated direct gallery uploads, reservation cleanup, and client progress. Keep current video limits until processing is available.
2. Implement one isolated-worker trial against private Supabase sources. Measure HEVC decoding, HDR conversion, cost, and failure recovery.
3. Proposed trial limits: 60 seconds, 250 MB source, and 4K source dimensions. These require sufficient bucket and plan limits.
4. Produce portrait-aware output within 1080 by 1920 or 1920 by 1080, at up to 30 fps. Preserve aspect ratio.
5. Start with H.264, 8-bit 4:2:0, AAC-LC, and fast-start MP4. Use bounded bitrate and a separate output byte cap.
6. If worker operations are unsuitable, compare the same fixture results with an approved managed trial. Select no vendor from pricing alone.
7. Add native Record video and gallery selection using the installed plugin. Verify permissions, file persistence, cancellation, and interrupted uploads.
8. Enable wider video input only after real iPhone HEVC/HDR, Android H.264, rotation, corruption, and account-switch tests pass.

The suggested caps exclude some high-bitrate camera modes. Report those limits before upload; never label support as universal.
Choose the output byte cap from measured quality and delivery cost. A short MP4 release can precede adaptive streaming.
Managed HLS needs a compatible player on every supported browser; a plain video `src` alone is not sufficient proof. [Player integration](https://developers.cloudflare.com/stream/viewing-videos/using-own-player/)
Keep existing gallery ordering and access controls when adding a reels viewer. Reels are a viewing mode, not a new public audience.

Before rollout, resolve worker ownership or vendor approval, spending limits, native permission changes, source retention, and the exact output contract.
Ship migrations and rollback guards before enabling new limits. Production configuration and migration state were not inspected in this review.
