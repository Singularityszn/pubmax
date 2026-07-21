"use client";

import { useCallback, useMemo, useState } from "react";
import { MapPin, Send } from "lucide-react";

import {
  buildAreaDemandRequest,
  formatApproxKm,
  matchNightPatch,
  normaliseArea,
  type AreaDemandSource,
  type NearestPatch,
} from "@/lib/areaDemand";
import { NIGHT_PATCHES, type NightPatch } from "@/lib/nightPatches";

import "./unsupportedAreaPreview.css";

export type UnsupportedAreaPreviewProps = {
  /** The area as the user named or picked it, when known. Null when we only know
   *  they are outside coverage (e.g. geolocated with nothing priced nearby). */
  area?: string | null;
  /** The real nearest supported patch (with distance), when a coordinate is
   *  known. Rendered first as the live alternative — value before the ask. */
  nearest?: NearestPatch | null;
  /** Supported areas offered as working alternatives. Defaults to NIGHT_PATCHES. */
  patches?: readonly NightPatch[];
  /** Which surface this preview renders on (provenance for the demand signal). */
  source: AreaDemandSource;
  /** Switch the surface to a supported patch (the alternative is live, one tap). */
  onPickPatch: (patch: NightPatch) => void;
};

type SubmitState = "idle" | "sending" | "done" | "error";

/**
 * Honest unsupported-area preview + demand capture (Wayfinder 3.2).
 *
 * When PUBMAXX cannot serve an area, this says so plainly, shows the nearest
 * supported patch as a LIVE alternative (value first — the alternative always
 * renders BEFORE the ask, never a form-wall), then offers a one-tap "tell us you
 * want [area]" with an OPTIONAL email. Capture works with no email at all.
 *
 * Copy is plain British, no invented counts, no em dashes. A failed POST fails
 * soft (a quiet retry line), never a crash.
 */
export default function UnsupportedAreaPreview({
  area = null,
  nearest = null,
  patches = NIGHT_PATCHES,
  source,
  onPickPatch,
}: UnsupportedAreaPreviewProps) {
  const [asking, setAsking] = useState(false);
  const [typedArea, setTypedArea] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");

  const knownArea = normaliseArea(area);
  // The area the demand is FOR: the known name, or what the user types when we
  // only know they are outside coverage.
  const effectiveArea = knownArea ?? normaliseArea(typedArea);

  // Offer the supported patches as alternatives, dropping the one already shown
  // as the headline nearest so it is not listed twice.
  const alternativePatches = useMemo(
    () => patches.filter((patch) => patch.id !== nearest?.patch.id),
    [patches, nearest],
  );

  const factLine = knownArea
    ? `We have not mapped pubs in ${knownArea} yet.`
    : "We do not have priced pubs right where you are yet.";

  const submit = useCallback(async () => {
    if (!effectiveArea || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/area-demand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildAreaDemandRequest({
            area: effectiveArea,
            matchedPatchId: nearest?.patch.id ?? matchNightPatch(effectiveArea),
            source,
            email,
          }),
        ),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }, [effectiveArea, email, nearest, source, state]);

  return (
    <section className="uap" aria-label="Area not covered yet">
      {/* ── Value first: the honest fact + the live alternative ─────────────── */}
      <p className="uapFact">{factLine}</p>

      {nearest ? (
        <div className="uapNearest">
          <p className="uapNearestCopy">
            Nearest we cover well is {nearest.patch.label}, {formatApproxKm(nearest.distanceKm)} away.
          </p>
          <button
            type="button"
            className="uapPrimary"
            onClick={() => onPickPatch(nearest.patch)}
          >
            <MapPin size={15} aria-hidden="true" /> Show {nearest.patch.label}
          </button>
        </div>
      ) : (
        <p className="uapNearestCopy">Here is where we have the pints mapped:</p>
      )}

      <ul className="uapPatches" aria-label="Areas we cover">
        {alternativePatches.map((patch) => (
          <li key={patch.id}>
            <button type="button" className="uapChip" onClick={() => onPickPatch(patch)}>
              {patch.label}
            </button>
          </li>
        ))}
      </ul>

      {/* ── The ask: only below the alternative, never a wall ───────────────── */}
      <div className="uapAsk">
        {state === "done" ? (
          <p className="uapThanks" role="status">
            Thanks, we have noted it{knownArea ? ` for ${knownArea}` : ""}.
          </p>
        ) : asking ? (
          <div className="uapForm">
            {!knownArea ? (
              <label className="uapField">
                <span className="uapLabel">Which area?</span>
                <input
                  type="text"
                  className="uapInput"
                  value={typedArea}
                  onChange={(event) => setTypedArea(event.target.value)}
                  placeholder="e.g. Peckham"
                  maxLength={80}
                  autoComplete="off"
                />
              </label>
            ) : null}
            <label className="uapField">
              <span className="uapLabel">Email for a heads-up (optional)</span>
              <input
                type="email"
                className="uapInput"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <button
              type="button"
              className="uapPrimary uapSend"
              onClick={submit}
              disabled={!effectiveArea || state === "sending"}
            >
              <Send size={14} aria-hidden="true" />
              {state === "sending" ? "Sending…" : "Send"}
            </button>
            {state === "error" ? (
              <p className="uapRetry" role="status">
                Could not note that just now. Try again in a moment.
              </p>
            ) : null}
          </div>
        ) : (
          <button type="button" className="uapAskBtn" onClick={() => setAsking(true)}>
            {knownArea ? `Tell us you want ${knownArea}` : "Ask us to cover your area"}
          </button>
        )}
      </div>
    </section>
  );
}
