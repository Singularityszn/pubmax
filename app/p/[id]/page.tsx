import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";

import CrawlStoryCopyButton from "@/components/crawl/CrawlStoryCopyButton";
import CommentThread from "@/components/pintdrop/CommentThread";
import HandleAvatar from "@/components/profile/HandleAvatar";
import ShareBar from "@/components/share/ShareBar";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { displayHandle } from "@/lib/handleDisplay";
import { getPintDropById, type PublicDrop } from "@/lib/pintDropLookup";
import { buildPintDropShareText } from "@/lib/shareArtifacts";
import { type ViewerContext } from "@/lib/pintDrops";
import { formatGbp } from "@/lib/formatGbp";

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
  // Optional `?viewer=` is a dev/test fallback only — production friends-gating
  // requires a verified JWT (Authorization header) that resolves to a profile
  // handle. Without auth, friends/legacy drops render "not on the wall".
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Resolve the verified viewer + follow graph for friends-gating on the permalink.
async function resolveViewer(
  searchParams?: PageProps["searchParams"],
): Promise<ViewerContext | undefined> {
  const h = await headers();
  const auth = h.get("authorization") ?? h.get("Authorization") ?? "";
  const reqHeaders: Record<string, string> = {};
  if (auth) reqHeaders.Authorization = auth;
  const request = new Request("http://localhost/p", { headers: reqHeaders });
  const params = searchParams ? await searchParams : undefined;
  const raw = params?.viewer;
  const queryViewer = Array.isArray(raw) ? raw[0] : raw;
  return resolveViewerContextFromRequest(request, queryViewer);
}

function formatDropPrice(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? formatGbp(value)
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
      description: "This Pint Drop couldn't be found on PUBMAXX.",
    };
  }

  const price = formatDropPrice(drop.priceGbp);
  const priceBit = price ? `, ${price}` : "";
  const title = `${displayHandle(drop.handle)}'s pint at ${drop.venueName}${priceBit}`;
  const description =
    drop.note ||
    (drop.drink
      ? `${drop.drink} at ${drop.venueName}${price ? ` for ${price}` : ""}.`
      : `A Pint Drop at ${drop.venueName} on PUBMAXX.`);

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
    <main id="main" className="permalink permalink--empty">
      <div className="permalink__emptyCard">
        <Link className="permalink__home" href="/">
          PUBMAXX
        </Link>
        <p className="permalink__eyebrow">Pint Drop</p>
        <h1 className="permalink__emptyTitle">This pint isn&rsquo;t on the wall</h1>
        <p className="permalink__emptyBody">
          It may have been taken down, or the link is wrong.
        </p>
        <Link className="permalink__primary" href="/social?tab=discover">
          Browse pubs &amp; pints
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
  const price = formatDropPrice(drop.priceGbp);
  const date = formatDate(drop.createdAt);
  const headline = drop.drink || "A pint worth remembering";
  const hasPhoto = Boolean(drop.pintPhotoUrl || drop.venuePhotoUrl);

  // Share lockup: a nostalgic one-liner that carries the pint into a group chat.
  const shareTitle = `${displayHandle(drop.handle)}'s pint at ${drop.venueName}${price ? `, ${price}` : ""}`;
  const shareText = buildPintDropShareText({
    venueName: drop.venueName,
    priceGbp: drop.priceGbp,
  });

  return (
    <main id="main" className="permalink">
      <div className="permalink__mat">
        {/* Kicker: brand + edition line */}
        <div className="permalink__kicker">
          <Link className="permalink__brand" href="/">
            PUBMAXX
          </Link>
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
          <HandleAvatar
            handle={drop.handle}
            avatarUrl={drop.avatarUrl}
            className="permalink__avatar"
            imageClassName="permalink__avatar"
            size={32}
          />
          <span className="permalink__handle">{displayHandle(drop.handle)}</span>
          {drop.era ? <span className="permalink__meta">· {drop.era}</span> : null}
          {date ? <span className="permalink__meta">· {date}</span> : null}
        </div>

        {/* Actions: copy link + open on the map */}
        <div className="permalink__actions">
          <CrawlStoryCopyButton className="permalink__primary" />
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
