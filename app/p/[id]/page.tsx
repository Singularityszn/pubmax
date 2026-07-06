import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import CommentThread from "@/components/pintdrop/CommentThread";
import ShareBar from "@/components/share/ShareBar";
import { memoryFollowStore, supabaseFollowStore } from "@/lib/followStore";
import { displayHandle } from "@/lib/handleDisplay";
import { getPintDropById, type PublicDrop } from "@/lib/pintDropLookup";
import { normalizeViewerHandle, type ViewerContext } from "@/lib/pintDrops";
import { isSupabaseConfigured } from "@/lib/supabase";

import "./permalink.css";

// Standalone Pint Drop permalink (PRD §8): share ONE pint as a real collectible
// memory. A server component so it can read the drop directly, emit rich OG /
// Twitter tags, and render a per-drop share image (opengraph-image.tsx) — no
// client fetch, no id ever visible to the crawler as anything but a pub name.
//
// A hidden/unknown id resolves to null (getPintDropById is gated on
// status = "visible") and renders a friendly "not on the wall" state, never a
// crash and never a leak of moderation state.

type PageProps = {
  params: Promise<{ id: string }>;
  // A `?viewer=<handle>` search param carries the requester's self-asserted
  // handle for a friends-gated permalink (issue #29). The server can't read the
  // client's localStorage handle, so a friends/legacy link is shared WITH this
  // param (or the viewer arrives with it). No param ⇒ anonymous viewer ⇒ a
  // friends/legacy drop resolves to null and renders "not on the wall" — an
  // honest block that never confirms the drop exists. Self-asserted, no auth yet:
  // a courtesy curtain, not cryptographic privacy (same posture as notifications).
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Resolve the self-asserted viewer + their follow graph for friends-gating.
// Fail-soft: any follow-lookup hiccup degrades to an author-only viewer (they
// still see their own drops), never a 500. Returns undefined for no handle.
async function resolveViewer(
  searchParams?: PageProps["searchParams"],
): Promise<ViewerContext | undefined> {
  const params = searchParams ? await searchParams : undefined;
  const raw = params?.viewer;
  const handle = normalizeViewerHandle(Array.isArray(raw) ? raw[0] : raw);
  if (!handle) return undefined;
  const follows = isSupabaseConfigured() ? supabaseFollowStore : memoryFollowStore;
  try {
    const following = await follows.listFollowing(handle);
    return {
      handle,
      followingHandles: new Set(following.map(normalizeViewerHandle).filter(Boolean)),
    };
  } catch {
    return { handle };
  }
}

function formatGbp(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `£${value.toFixed(2)}`
    : null;
}

function formatDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const drop = await getPintDropById(id, await resolveViewer(searchParams));

  if (!drop) {
    return {
      title: "This pint isn't on the wall",
      description: "This Pint Drop couldn't be found on PUBMAXXING.",
    };
  }

  const price = formatGbp(drop.priceGbp);
  const priceBit = price ? ` — ${price}` : "";
  const title = `${displayHandle(drop.handle)}'s pint at ${drop.venueName}${priceBit}`;
  const description =
    drop.note ||
    (drop.drink
      ? `${drop.drink} at ${drop.venueName}${price ? ` for ${price}` : ""}.`
      : `A Pint Drop at ${drop.venueName} on PUBMAXXING.`);

  // opengraph-image.tsx sits beside this route, so Next auto-attaches it; we
  // still name the canonical url + card type here for a complete lockup.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `/p/${drop.id}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// ── Empty / not-found state ──────────────────────────────────────────────────
function NotOnTheWall() {
  return (
    <main className="permalink permalink--empty">
      <div className="permalink__emptyCard">
        <p className="permalink__eyebrow">Pint Drop</p>
        <h1 className="permalink__emptyTitle">This pint isn&rsquo;t on the wall</h1>
        <p className="permalink__emptyBody">
          It may have been taken down, or the link is wrong. Every real pint still
          has a home on the feed.
        </p>
        <Link className="permalink__primary" href="/feed">
          Go to the feed
        </Link>
      </div>
    </main>
  );
}

export default async function PintDropPermalink({ params, searchParams }: PageProps) {
  const { id } = await params;
  const drop = await getPintDropById(id, await resolveViewer(searchParams));

  if (!drop) return <NotOnTheWall />;

  return <MemoryCard drop={drop} id={id} />;
}

// ── The collectible pint memory card ─────────────────────────────────────────
function MemoryCard({ drop, id }: { drop: PublicDrop; id: string }) {
  const price = formatGbp(drop.priceGbp);
  const date = formatDate(drop.createdAt);
  const headline = drop.drink || "A pint worth remembering";
  const hasPhoto = Boolean(drop.pintPhotoUrl || drop.venuePhotoUrl);

  // Share lockup: a nostalgic one-liner that carries the pint into a group chat.
  const shareTitle = `${displayHandle(drop.handle)}'s pint at ${drop.venueName}${price ? ` — ${price}` : ""}`;
  const shareText = price
    ? `Found a proper pint at ${drop.venueName} — ${price}. Every pint has a story.`
    : `Found a proper pint at ${drop.venueName}. Every pint has a story.`;

  return (
    <main className="permalink">
      <div className="permalink__mat">
        {/* Kicker: brand + edition line */}
        <div className="permalink__kicker">
          <span className="permalink__brand">PUBMAXXING</span>
          <span className="permalink__edition">A Pint Drop</span>
        </div>

        {/* The pub snapshot, framed like a pub photo. Price stamp pressed over it. */}
        {hasPhoto ? (
          <figure className="permalink__frame">
            <Image
              className="permalink__photo"
              src={(drop.pintPhotoUrl || drop.venuePhotoUrl) as string}
              alt={`A pint at ${drop.venueName}`}
              width={720}
              height={720}
              sizes="(max-width: 640px) 100vw, 560px"
              unoptimized
            />
            {price ? <PriceStamp price={price} /> : null}
          </figure>
        ) : price ? (
          <div className="permalink__stampRow">
            <PriceStamp price={price} />
          </div>
        ) : null}

        {/* The pint itself */}
        <p className="permalink__eyebrow">{drop.venueName}</p>
        <h1 className="permalink__pint">{headline}</h1>

        {/* The note, as a serif caption — the passed-down memory */}
        {drop.note ? <p className="permalink__note">&ldquo;{drop.note}&rdquo;</p> : null}

        {/* Vibe tags as little pressed stamps */}
        {drop.vibeTags.length ? (
          <ul className="permalink__tags" aria-label="Vibe tags">
            {drop.vibeTags.map((tag) => (
              <li className="permalink__tag" key={tag}>
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Signature line: handle · era · date */}
        <div className="permalink__signature">
          <span className="permalink__handle">{displayHandle(drop.handle)}</span>
          {drop.era ? <span className="permalink__meta">· {drop.era}</span> : null}
          {date ? <span className="permalink__meta">· {date}</span> : null}
        </div>

        {/* Actions: copy link + open on the map */}
        <div className="permalink__actions">
          <button type="button" className="permalink__primary" data-copy-link>
            <span data-copy-idle>Copy link</span>
            <span data-copy-done hidden>
              Copied
            </span>
          </button>
          <Link className="permalink__ghost" href={drop.venueMapUrl}>
            Open the pub on the map
          </Link>
          <Link className="permalink__ghost" href={`/ledger/${drop.venueId}`}>
            Open the Ledger
          </Link>
        </div>

        {/* Share strip — the pint spreads across X, WhatsApp, and group chats. */}
        <div className="permalink__share">
          <ShareBar url={`/p/${id}`} title={shareTitle} text={shareText} />
        </div>
      </div>

      {/* Comments (delivered by a sibling agent at components/pintdrop/CommentThread) */}
      <section className="permalink__comments" aria-label="Comments">
        <CommentThread dropId={id} />
      </section>

      {/* Copy-link wiring. Kept as a server-rendered inline script (no client
          component file per the build constraints); progressive-enhancement only,
          the button is inert if JS is off. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var btn=document.querySelector('[data-copy-link]');if(!btn)return;btn.addEventListener('click',function(){var idle=btn.querySelector('[data-copy-idle]');var done=btn.querySelector('[data-copy-done]');function flash(){if(idle)idle.hidden=true;if(done)done.hidden=false;setTimeout(function(){if(idle)idle.hidden=false;if(done)done.hidden=true;},2000);}try{navigator.clipboard.writeText(window.location.href).then(flash,flash);}catch(e){flash();}});})();`,
        }}
      />
    </main>
  );
}

// The pressed brass price stamp — the one bold signature element (rotated badge).
function PriceStamp({ price }: { price: string }) {
  return (
    <div className="permalink__stamp" aria-label={`Paid ${price} a pint`}>
      <span className="permalink__stampLabel">Paid</span>
      <span className="permalink__stampPrice">{price}</span>
      <span className="permalink__stampUnit">a pint</span>
    </div>
  );
}
