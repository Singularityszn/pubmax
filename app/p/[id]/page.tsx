import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";

import CrawlStoryCopyButton from "@/components/crawl/CrawlStoryCopyButton";
import CommentThread from "@/components/pintdrop/CommentThread";
import PintReceiptPaper from "@/components/pintdrop/PintReceiptPaper";
import ShareBar from "@/components/share/ShareBar";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { getPintDropById, type PublicDrop } from "@/lib/pintDropLookup";
import { type ViewerContext } from "@/lib/pintDrops";
import { buildPintReceipt, buildReceiptShareText, formatReceiptItem, type PintReceipt } from "@/lib/pintReceipt";

import "./permalink.css";

// Standalone Pint Drop permalink (PRD §8): share ONE pint as an honest
// receipt. A server component so it can read the drop directly, emit rich OG /
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

// "a PUBMAXXER's pint at The Hatton, £4.70": the drinker as the receipt shows them.
function receiptTitle(receipt: PintReceipt): string {
  const item = receipt.measure === "Pint" ? "pint" : formatReceiptItem(receipt);
  return `${receipt.drinker}'s ${item} at ${receipt.venueName}${receipt.price ? `, ${receipt.price}` : ""}`;
}

function receiptDescription(receipt: PintReceipt): string {
  const what = formatReceiptItem(receipt);
  const price = receipt.price ? ` for ${receipt.price}` : "";
  const day = receipt.loggedOn ? `, logged ${receipt.loggedOn}` : "";
  return `${what} at ${receipt.venueName}${price}${day}. A pint receipt on PUBMAXX.`;
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

  const receipt = buildPintReceipt(drop);
  const title = receiptTitle(receipt);
  const description = [receiptDescription(receipt), drop.note].filter(Boolean).join(" ");

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

  return <ReceiptCard drop={drop} id={id} />;
}

function ReceiptCard({ drop, id }: { drop: PublicDrop; id: string }) {
  const receipt = buildPintReceipt(drop);
  const photoUrl = drop.pintPhotoUrl || drop.venuePhotoUrl;
  const shareTitle = receiptTitle(receipt);
  const shareText = buildReceiptShareText(receipt);
  const hasExtras = Boolean(drop.note || drop.era || drop.vibeTags.length);

  return (
    <main id="main" className="permalink">
      <div className="permalink__mat">
        <div className="permalink__counter">
          <PintReceiptPaper
            receipt={receipt}
            media={
              photoUrl ? (
                <Image
                  src={photoUrl}
                  alt={`A pint at ${drop.venueName}`}
                  width={720}
                  height={720}
                  sizes="(max-width: 640px) 100vw, 360px"
                  unoptimized
                />
              ) : null
            }
            extras={
              hasExtras ? (
                <>
                  {drop.note ? <p className="permalink__note">&ldquo;{drop.note}&rdquo;</p> : null}
                  {drop.era ? <p className="permalink__era">{drop.era}</p> : null}
                  {drop.vibeTags.length ? (
                    <ul className="permalink__tags" aria-label="Vibe tags">
                      {drop.vibeTags.map((tag) => (
                        <li className="permalink__tag" key={tag}>
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null
            }
          />
        </div>

        <div className="permalink__actions">
          <CrawlStoryCopyButton className="permalink__primary" />
          <Link className="permalink__ghost" href={drop.venueMapUrl}>
            Open the pub on the map
          </Link>
          <Link className="permalink__ghost" href={`/ledger/${drop.venueId}`}>
            Open the Ledger
          </Link>
        </div>

        <div className="permalink__share">
          <ShareBar url={`/p/${id}`} title={shareTitle} text={shareText} />
        </div>
      </div>

      <section className="permalink__comments" aria-label="Comments">
        <CommentThread dropId={id} />
      </section>
    </main>
  );
}
