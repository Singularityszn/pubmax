"use client";

// Today get-there strip (card 3) — "how you'll get home tonight".
//
// Follows the TonightGetHomeStrip pattern (lib/tfl.ts via /api/last-train,
// reduced by summariseGetHome), but owns its own location prompt because the
// morning brief has no shared location state to lean on.
//
// TWO ORIGINS, ONE LANE. A reader may hand over a rounded point (nearest
// ~110m, coarsenViewerPoint) or pick an AREA and hand over nothing at all.
// Both resolve to the same rounded coordinate and the same fetch; what differs
// is the wording of the answer, because an area's nearest station is the
// area's and never "yours" (lib/locationDisclosure).
//
// The disclosure itself is not written here: lib/locationDisclosure owns every
// sentence, so the prompt, /privacy and this card cannot drift apart again
// (Astra F01, 6 Sep 2026).
//
// React 19 rules: the fetch fires in an effect keyed on the rounded origin,
// state settles only inside the async resolution/catch, and an AbortController
// cancels on unmount or origin change. Honest states throughout: a prompt
// before sharing, a calm line when TfL has nothing, never a fabricated time.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LocateFixed, MapPin, TrainFront, X } from "lucide-react";

import DisruptionLine from "@/components/transport/DisruptionLine";
import { coarsenViewerPoint } from "@/lib/geo";
import {
  LOCATION_FINDING_LABEL,
  LOCATION_FINDING_STATUS,
  LOCATION_MANUAL_CHANGE_LABEL,
  LOCATION_MANUAL_GROUP_LABEL,
  LOCATION_MANUAL_OPEN_LABEL,
  LOCATION_MANUAL_PROMPT,
  LOCATION_POLICY_LINK,
  LOCATION_REMOVE_LABEL,
  LOCATION_RETRY_LABEL,
  LOCATION_SHARE_LABEL,
  LOCATION_UNAVAILABLE_STATUS,
  locationAreaOriginLine,
  locationDisclosureLines,
} from "@/lib/locationDisclosure";
import { CENTRAL_PATCH, NIGHT_PATCHES, type NightPatch } from "@/lib/nightPatches";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { summariseGetHome, type GetHomeSummary } from "@/lib/tonightGetHome";
import type { LastTrainResult } from "@/lib/tfl";

import { todayTextButtonClass } from "./todayTextButton";
import styles from "./Today.module.css";

const SURFACE = "today-last-train" as const;

/** Where the coordinate we ask with came from. It changes the wording, only. */
type Origin =
  | { kind: "viewer"; lat: number; lng: number }
  | { kind: "area"; lat: number; lng: number; areaLabel: string };

type LocationStatus = "idle" | "requesting" | "unavailable";
type Result = { kind: "summary"; summary: GetHomeSummary } | { kind: "none" } | null;

/** Central London first: it is the answer for a reader who picks nothing. */
const MANUAL_AREAS: readonly NightPatch[] = [CENTRAL_PATCH, ...NIGHT_PATCHES];

export default function TodayGetThereStrip() {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [areaPickerAsked, setAreaPickerAsked] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const egressPoint = origin ? coarsenViewerPoint(origin) : null;
  const lat = egressPoint?.lat ?? null;
  const lng = egressPoint?.lng ?? null;

  // The browser is asked ONLY from this handler, which is bound to a button.
  // Nothing on this card reads geolocation on mount.
  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({
          kind: "viewer",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocationStatus("idle");
      },
      () => setLocationStatus("unavailable"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  }, []);

  const pickArea = useCallback((patch: NightPatch) => {
    setOrigin({
      kind: "area",
      lat: patch.lat,
      lng: patch.lng,
      areaLabel: patch.label,
    });
    setResult(null);
  }, []);

  const clearOrigin = useCallback(() => {
    setOrigin(null);
    setResult(null);
    setLocationStatus("idle");
    setAreaPickerAsked(false);
  }, []);

  useEffect(() => {
    if (lat === null || lng === null) return;
    // State settles only inside the async resolution/catch (never synchronously
    // in the effect body): the "Checking..." state is already the null default.
    const controller = new AbortController();
    void loadSurfaceJson<LastTrainResult>(
      `/api/last-train?lat=${lat}&lng=${lng}`,
      {
        signal: controller.signal,
        validate: (body) =>
          Boolean(
            body &&
              typeof body === "object" &&
              "station" in body &&
              "trains" in body,
          ),
      },
      (body) => {
        const summary = summariseGetHome(body);
        setResult(summary ? { kind: "summary", summary } : { kind: "none" });
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setResult({ kind: "none" });
      }
    });
    return () => controller.abort();
  }, [lat, lng]);

  // An area answer says whose station it is. A viewer's own point needs no such
  // line: summariseGetHome already names the station it found.
  const originLine =
    origin?.kind === "area" ? locationAreaOriginLine(origin.areaLabel) : null;
  const removeLabel =
    origin?.kind === "area" ? LOCATION_MANUAL_CHANGE_LABEL : LOCATION_REMOVE_LABEL;
  // A browser that refused opens the area chooser without being asked twice:
  // the refusal IS the reader saying they want the other way.
  const areaPickerOpen = areaPickerAsked || locationStatus === "unavailable";

  return (
    <section className={styles.todayCard} aria-labelledby="today-getthere-title" data-testid="today-get-there">
      <div className={styles.todayCardHead}>
        <span className={styles.todayCardIcon} aria-hidden="true">
          <TrainFront size={18} />
        </span>
        <div>
          <p className={styles.todayCardEyebrow}>Getting home</p>
          <h2 className={styles.todayCardTitle} id="today-getthere-title">
            Your last train, before you commit to the night.
          </h2>
        </div>
      </div>

      {origin && result?.kind === "summary" ? (
        <div className={styles.todayGetThere}>
          {originLine ? <p className={styles.todayOriginLine}>{originLine}</p> : null}
          <p className={styles.todayGetThereCopy}>
            <span className={styles.todayGetThereStatus}>{result.summary.statusLine}</span>{" "}
            <span>{result.summary.trainLine}</span>
          </p>
          <DisruptionLine lat={origin.lat} lng={origin.lng} />
          <div className={styles.todayCardFootRow}>
            <span className={styles.todayProvenance}>via TfL</span>
            <button type="button" className={todayTextButtonClass(styles.todayTextButton)} onClick={clearOrigin}>
              <X size={14} aria-hidden="true" />
              {removeLabel}
            </button>
          </div>
        </div>
      ) : origin && result?.kind === "none" ? (
        <div className={styles.todayGetThere}>
          {originLine ? <p className={styles.todayOriginLine}>{originLine}</p> : null}
          <p className={styles.todayCardEmpty}>
            Couldn&rsquo;t find a last train {origin.kind === "area" ? "there" : "near you"} just
            now. Check TfL before you head out.
          </p>
          <DisruptionLine lat={origin.lat} lng={origin.lng} />
          <div className={styles.todayCardFootRow}>
            <button type="button" className={todayTextButtonClass(styles.todayTextButton)} onClick={clearOrigin}>
              <X size={14} aria-hidden="true" />
              {removeLabel}
            </button>
          </div>
        </div>
      ) : origin ? (
        <p className={styles.todayCardEmpty} role="status">
          Checking the last train&hellip;
        </p>
      ) : (
        <div className={styles.todayGetThere}>
          {/* The disclosure, in the order lib/locationDisclosure sets: what is
              sent, how coarse, who our server passes it to, what we keep. */}
          {locationDisclosureLines(SURFACE).map((line, index, lines) => (
            <p className={styles.todayCardBody} key={line}>
              {line}
              {index === lines.length - 1 ? (
                <>
                  {" "}
                  <Link href={LOCATION_POLICY_LINK.href} className={styles.todayInlineLink}>
                    {LOCATION_POLICY_LINK.label}
                  </Link>
                </>
              ) : null}
            </p>
          ))}
          <button
            type="button"
            className={styles.todayButton}
            onClick={requestLocation}
            disabled={locationStatus === "requesting"}
          >
            <LocateFixed size={15} aria-hidden="true" />
            {locationStatus === "requesting"
              ? LOCATION_FINDING_LABEL
              : locationStatus === "unavailable"
                ? LOCATION_RETRY_LABEL
                : LOCATION_SHARE_LABEL[SURFACE]}
          </button>
          {/* The answer that needs no location at all. Offered from the start,
              because a reader who will not share should not have to be refused
              first to find out there is another way. The chips themselves cost
              a tap, so the card stays one primary action tall until asked. */}
          <p className={styles.todayManualPrompt}>{LOCATION_MANUAL_PROMPT}</p>
          {areaPickerOpen ? (
            <div
              className={styles.todayAreaPicker}
              role="group"
              aria-label={LOCATION_MANUAL_GROUP_LABEL}
            >
              {MANUAL_AREAS.map((patch) => (
                <button
                  key={patch.id}
                  type="button"
                  className={styles.todayAreaChip}
                  onClick={() => pickArea(patch)}
                >
                  <MapPin size={12} aria-hidden="true" />
                  {patch.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className={todayTextButtonClass(styles.todayTextButton)}
              onClick={() => setAreaPickerAsked(true)}
            >
              <MapPin size={14} aria-hidden="true" />
              {LOCATION_MANUAL_OPEN_LABEL}
            </button>
          )}
          <span className={styles.todaySrOnly} role="status" aria-live="polite">
            {locationStatus === "requesting"
              ? LOCATION_FINDING_STATUS
              : locationStatus === "unavailable"
                ? LOCATION_UNAVAILABLE_STATUS
                : ""}
          </span>
        </div>
      )}
      {/* A quiet way to the pubs from inside the getting-home card. The route's
          one primary action is Find my pint in the Screen head
          (docs/design/LAUNCH_SCREENS.md), so this stays a text link. */}
      <p className={`${styles.todayCardFootRow} todayNearEntry`}>
        <Link href="/near" className={styles.todayCardFootLink}>
          <LocateFixed size={14} aria-hidden="true" />
          Find pubs near you
        </Link>
      </p>
    </section>
  );
}
