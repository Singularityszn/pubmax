"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import FoundingMemberMark from "@/components/founding/FoundingMemberMark";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch, authedFetch } from "@/lib/authedFetch";
import {
  DRINK_WALL_CATEGORIES,
  DRINK_WALL_CATEGORY_LABEL,
  DRINK_WALL_SIGN_IN_LINE,
  drinkWallAltText,
  drinkWallEmptyLine,
  drinkWallPlaceLine,
  drinkWallRemoveConfirmLine,
  drinkWallSignInHref,
  type DrinkWallCategory,
  type DrinkWallPage,
  type DrinkWallPhotoDTO,
} from "@/lib/drinkWall";
import { nearestVenueIds } from "@/lib/nearby";
import { loadSlimVenues } from "@/lib/venuesSlim";
import {
  VENUE_PHOTO_OUTPUT_HEIGHT,
  VENUE_PHOTO_OUTPUT_WIDTH,
  type VenuePhotoReadStatus,
} from "@/lib/venuePhotos";

import DrinkWallComposer from "./DrinkWallComposer";
import "./drinkWall.css";

type Scope = "all" | "near";

type WallState = {
  photos: DrinkWallPhotoDTO[];
  nextCursor: string | null;
  status: VenuePhotoReadStatus;
};

const EMPTY: WallState = { photos: [], nextCursor: null, status: "ready" };

function isPage(value: unknown): value is DrinkWallPage {
  return Boolean(value) && Array.isArray((value as DrinkWallPage).photos);
}

export default function DrinkWall() {
  const { user, handle, configured } = useAuth();
  const [category, setCategory] = useState<DrinkWallCategory | "all">("all");
  const [scope, setScope] = useState<Scope>("all");
  const [nearVenueIds, setNearVenueIds] = useState<string[]>([]);
  const [nearReady, setNearReady] = useState(true);
  const [wall, setWall] = useState<WallState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const generation = useRef(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [fetchKey, setFetchKey] = useState("all|all|");

  function startFilterChange() {
    generation.current += 1;
    setWall(EMPTY);
    setLoading(true);
  }

  function changeScope(next: Scope) {
    if (next === scope) return;
    startFilterChange();
    setScope(next);
    setNearReady(next === "all");
    setNearVenueIds([]);
  }

  function changeCategory(next: DrinkWallCategory | "all") {
    if (next === category) return;
    startFilterChange();
    setCategory(next);
  }

  useEffect(() => {
    if (scope !== "near" || nearReady) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      queueMicrotask(() => {
        setNearVenueIds([]);
        setNearReady(true);
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const venues = (await loadSlimVenues()).map((venue) => ({
            id: venue.id,
            latitude: venue.lat,
            longitude: venue.lng,
          }));
          setNearVenueIds(nearestVenueIds(pos.coords.latitude, pos.coords.longitude, venues, 60));
        } catch {
          setNearVenueIds([]);
        } finally {
          setNearReady(true);
        }
      },
      () => {
        setNearVenueIds([]);
        setNearReady(true);
      },
      { maximumAge: 120_000, timeout: 12_000 },
    );
  }, [scope, nearReady]);

  const load = useCallback(
    async (cursor: string | null, reset: boolean) => {
      if (scope === "near" && !nearReady) return;
      const ticket = reset ? ++generation.current : generation.current;
      const stale = () => ticket !== generation.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ scope });
        if (category !== "all") params.set("category", category);
        if (cursor) params.set("cursor", cursor);
        if (scope === "near") params.set("nearVenueIds", nearVenueIds.join(","));
        const response = await authedFetch(`/api/drink-wall?${params.toString()}`, {}, { requiresIdentity: true });
        const body: unknown = await response.json().catch(() => null);
        if (stale()) return;
        if (!response.ok || !isPage(body)) {
          setWall((current) => ({ ...(reset ? EMPTY : current), status: "degraded" }));
          return;
        }
        setWall((current) => ({
          photos: cursor ? [...current.photos, ...body.photos] : body.photos,
          nextCursor: body.nextCursor,
          status: body.status,
        }));
      } catch {
        if (stale()) return;
        setWall((current) => ({ ...(reset ? EMPTY : current), status: "degraded" }));
      } finally {
        if (!stale()) setLoading(false);
      }
    },
    [category, scope, nearVenueIds, nearReady],
  );

  const reloadKey = `${scope}|${category}|${nearVenueIds.join(",")}|${nearReady}`;
  const [loadedKey, setLoadedKey] = useState("");
  if (loadedKey !== reloadKey && (scope === "all" || nearReady)) {
    setLoadedKey(reloadKey);
    setFetchKey(reloadKey);
  }

  useEffect(() => {
    if (scope === "near" && !nearReady) return;
    if (fetchKey !== reloadKey) return;
    queueMicrotask(() => {
      setLoading(true);
      void load(null, true);
    });
  }, [fetchKey, reloadKey, load, nearReady, scope]);

  async function remove(photo: DrinkWallPhotoDTO) {
    if (!window.confirm(drinkWallRemoveConfirmLine(photo))) return;
    const id = photo.id;
    setRemovingId(id);
    setRemoveError(null);
    try {
      const response = await authedActionFetch(
        "/api/venue-photos",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        },
        { requiresIdentity: true },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setRemoveError(offlineOrMessage(errorMessageFrom(body, "Could not remove that photo. Try again.")));
        return;
      }
      setWall((current) => ({ ...current, photos: current.photos.filter((item) => item.id !== id) }));
    } catch {
      setRemoveError(offlineOrMessage("Could not remove that photo. Try again."));
    } finally {
      setRemovingId(null);
    }
  }

  const canPost = configured && user && handle;
  const emptyLine = drinkWallEmptyLine(wall.status === "degraded");
  const nearEmpty = scope === "near" && nearReady && nearVenueIds.length === 0;

  return (
    <div className="drinkWall">
      <div className="drinkWallHead">
        <h1 className="drinkWallTitle">Drink Wall</h1>
        <p className="drinkWallIntro">
          Pints, pub fronts and London views from drinkers on PubMaxxing.
        </p>
        <div className="drinkWallFilters">
          <div className="drinkWallScope" role="group" aria-label="Browse scope">
            <button type="button" aria-pressed={scope === "all"} onClick={() => changeScope("all")}>
              All London
            </button>
            <button type="button" aria-pressed={scope === "near"} onClick={() => changeScope("near")}>
              Near me
            </button>
          </div>
          <button
            type="button"
            className="drinkWallTag"
            aria-pressed={category === "all"}
            onClick={() => changeCategory("all")}
          >
            All
          </button>
          {DRINK_WALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className="drinkWallTag"
              aria-pressed={category === cat}
              onClick={() => changeCategory(cat)}
            >
              {DRINK_WALL_CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>
        <div className="drinkWallActions">
          {canPost ? (
            <button type="button" className="venuePhotoWallButton" onClick={() => setComposerOpen(true)}>
              Add a photo
            </button>
          ) : (
            <p className="drinkWallSignInPrompt">
              {DRINK_WALL_SIGN_IN_LINE}{" "}
              <Link href={drinkWallSignInHref("/wall")}>Sign in</Link>
            </p>
          )}
        </div>
      </div>

      {composerOpen && canPost ? (
        <DrinkWallComposer onCancel={() => setComposerOpen(false)} onPosted={() => { setComposerOpen(false); void load(null, true); }} />
      ) : null}

      {loading && wall.photos.length === 0 ? (
        <p className="drinkWallStatus" role="status">Loading the wall</p>
      ) : null}

      {nearEmpty && wall.photos.length === 0 && !loading ? (
        <p className="drinkWallEmpty" role="status">
          We need your location for Near me, or switch to All London.
        </p>
      ) : null}

      {!nearEmpty && wall.photos.length === 0 && !loading ? (
        <p className="drinkWallEmpty" role="status">{emptyLine}</p>
      ) : null}

      {removeError ? (
        <p className="drinkWallStatus" role="status">{removeError}</p>
      ) : null}

      <div className="drinkWallGrid">
        {wall.photos.map((photo) => {
          const place = drinkWallPlaceLine(photo);
          return (
          <figure className="drinkWallTile" key={photo.id}>
            <Image
              src={photo.url}
              alt={drinkWallAltText(photo)}
              width={VENUE_PHOTO_OUTPUT_WIDTH}
              height={VENUE_PHOTO_OUTPUT_HEIGHT}
              unoptimized
            />
            <figcaption className="drinkWallByline">
              {photo.caption ? <span className="drinkWallCaption">{photo.caption}</span> : null}
              {place ? <span className="drinkWallPlace">{place}</span> : null}
              <span className="drinkWallAuthor">
                @{photo.author.handle}
                {photo.author.foundingMemberNumber !== undefined ? (
                  <FoundingMemberMark number={photo.author.foundingMemberNumber} />
                ) : null}
              </span>
            </figcaption>
            {photo.ownedByViewer ? (
              <button
                type="button"
                className="drinkWallRemove"
                disabled={removingId === photo.id}
                onClick={() => void remove(photo)}
              >
                {removingId === photo.id ? "Removing…" : "Remove"}
              </button>
            ) : null}
          </figure>
          );
        })}
      </div>

      {wall.nextCursor ? (
        <button type="button" className="venuePhotoWallButton" disabled={loading} onClick={() => void load(wall.nextCursor, false)}>
          {loading ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
