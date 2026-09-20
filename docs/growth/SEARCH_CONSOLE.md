# Google Search Console setup (one-time)

Run these steps once on the captain's account for **pubmaxxing.com**. Generic terms such as "pub" or "pubbing" are not winnable through markup alone; this checklist targets **brand** queries (PubMaxxing, PUBMAXX, PubMaxx, Pubmax, Pub Maxxing, Pubmaxing).

## 1. Verify pubmaxxing.com (DNS at GoDaddy)

1. Open [Google Search Console](https://search.google.com/search-console).
2. Add property **URL prefix** `https://pubmaxxing.com` (or Domain property `pubmaxxing.com` if you prefer DNS at the root).
3. Choose **Domain name provider** verification or **TXT record** verification.
4. In GoDaddy DNS for `pubmaxxing.com`, add the TXT record Google shows (name `@` or as instructed, value copied exactly).
5. Wait for propagation, then click **Verify** in Search Console.

## 2. Submit the sitemap

1. In the `pubmaxxing.com` property, open **Sitemaps**.
2. Submit: `https://pubmaxxing.com/sitemap.xml`
3. Confirm status **Success** after the next crawl (can take hours).

## 3. Remove indexed `*.vercel.app` URLs

Production already **308-redirects** every `*.vercel.app` document host to `https://pubmaxxing.com` and sets `X-Robots-Tag: noindex` on that redirect response.

1. In Search Console, open **Removals** (temporary) or use **Change of address** only if Google still shows old hostnames in results.
2. For any URL still indexed under `pubmaxx.vercel.app` or another deployment host, request **Remove this URL** (temporary removal) or use **Removals → Outdated content** after the 308 has been live for a few days.
3. Prefer letting the 308 plus canonical on `pubmaxxing.com` consolidate signals; use manual removal only for stubborn `vercel.app` snippets.

## 4. Request indexing of the homepage

1. Open **URL inspection** for `https://pubmaxxing.com/`
2. Confirm **User-declared canonical** is `https://pubmaxxing.com/`
3. Click **Request indexing** after deploy.

## 5. pubmaxxing.co.uk (redirect-only property)

1. Add a separate Search Console property for `pubmaxxing.co.uk` (DNS TXT at GoDaddy, same flow as step 1).
2. Do **not** submit a sitemap or request broad indexing for `.co.uk`. The domain **308-redirects** to `https://pubmaxxing.com` at the Vercel edge.
3. Use the `.co.uk` property only to monitor that Google treats it as a redirect alias, not a second site.

## Optional: Bing Webmaster Tools

Repeat verification and sitemap submission at [Bing Webmaster Tools](https://www.bing.com/webmasters) for the same apex URL if you want Bing brand coverage.
