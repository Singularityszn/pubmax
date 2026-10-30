"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  nearMeLocationFailure,
  type NearMeLocationFailure,
} from "@/lib/nearMeLocation";
import { headingFromOrientation, smoothHeading, type CompassPoint } from "@/lib/pintCompass";

// The two sensors behind /compass, started from ONE tap and stopped when the
// page goes. Both answers stay in this tab: the position and the heading are
// handed to the pure leaf (lib/pintCompass.ts) and to nothing else, so no
// request, event or report is ever built from them.
//
// iOS asks for the motion sensor only through
// `DeviceOrientationEvent.requestPermission()`, and only from inside a user
// gesture, so `start` must be called straight from the button's handler. Its
// first act is that ask, before anything awaits.

/** How the heading sensor is doing. */
export type HeadingSensor =
  /** Nothing asked yet. */
  | "off"
  /** Waiting for the iOS permission answer or the first reading. */
  | "asking"
  /** Readings are arriving and point at north. */
  | "live"
  /** Refused, missing, or never measured from north: the page falls back to words. */
  | "none";

export type LocationState =
  | { kind: "off" }
  | { kind: "locating" }
  | { kind: "fixed"; point: CompassPoint; accuracyM: number | null }
  | { kind: "failed"; failure: NearMeLocationFailure };

/** Watch options. High accuracy, because a bearing from a 1 km guess is a guess. */
const COMPASS_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 10_000,
};

/** With no reading by then, the phone has no usable compass. */
const HEADING_FIRST_READING_MS = 2_500;

type OrientationCtor = {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

type CompassOrientationEvent = Event & {
  alpha?: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number | null;
};

function screenAngle(): number {
  if (typeof window === "undefined") return 0;
  const angle = window.screen?.orientation?.angle;
  return typeof angle === "number" && Number.isFinite(angle) ? angle : 0;
}

export function useCompassSensors(): {
  location: LocationState;
  heading: number | null;
  sensor: HeadingSensor;
  start: () => void;
} {
  const [location, setLocation] = useState<LocationState>({ kind: "off" });
  const [heading, setHeading] = useState<number | null>(null);
  const [sensor, setSensor] = useState<HeadingSensor>("off");
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const start = useCallback(() => {
    stopRef.current?.();
    if (typeof window === "undefined") return;
    const stops: Array<() => void> = [];
    stopRef.current = () => {
      for (const stop of stops.splice(0)) stop();
    };

    // 1. The heading. The iOS ask comes first, inside the gesture.
    const Ctor = (window as unknown as { DeviceOrientationEvent?: OrientationCtor })
      .DeviceOrientationEvent;
    let smoothed: number | null = null;
    let pending: number | null = null;
    let frame = 0;
    let gotReading = false;
    const flush = () => {
      frame = 0;
      if (pending === null) return;
      smoothed = smoothHeading(smoothed, pending);
      pending = null;
      setHeading(smoothed);
    };
    const onOrientation = (event: Event) => {
      const reading = headingFromOrientation(event as CompassOrientationEvent, screenAngle());
      if (reading === null) return;
      if (!gotReading) {
        gotReading = true;
        setSensor("live");
      }
      pending = reading;
      if (!frame) frame = window.requestAnimationFrame(flush);
    };
    const listen = () => {
      window.addEventListener("deviceorientationabsolute", onOrientation);
      window.addEventListener("deviceorientation", onOrientation);
      const timer = window.setTimeout(() => {
        if (!gotReading) setSensor("none");
      }, HEADING_FIRST_READING_MS);
      stops.push(() => {
        window.removeEventListener("deviceorientationabsolute", onOrientation);
        window.removeEventListener("deviceorientation", onOrientation);
        window.clearTimeout(timer);
        if (frame) window.cancelAnimationFrame(frame);
      });
    };
    if (!Ctor) {
      setSensor("none");
    } else if (typeof Ctor.requestPermission === "function") {
      setSensor("asking");
      let ask: Promise<string>;
      try {
        ask = Ctor.requestPermission();
      } catch {
        ask = Promise.resolve("denied");
      }
      void ask
        .then((answer) => {
          if (answer === "granted") listen();
          else setSensor("none");
        })
        .catch(() => setSensor("none"));
    } else {
      setSensor("asking");
      listen();
    }

    // 2. Where the reader stands, as a running watch while the page is open.
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo || typeof geo.watchPosition !== "function") {
      setLocation({ kind: "failed", failure: "unsupported" });
      return;
    }
    setLocation({ kind: "locating" });
    const watchId = geo.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        setLocation({
          kind: "fixed",
          point: { lat: latitude, lng: longitude },
          accuracyM: Number.isFinite(accuracy) ? accuracy : null,
        });
      },
      (error) => {
        // A fix we already hold outlives a later timeout: keep pointing.
        setLocation((current) =>
          current.kind === "fixed" && error.code !== 1
            ? current
            : { kind: "failed", failure: nearMeLocationFailure(error) },
        );
      },
      COMPASS_WATCH_OPTIONS,
    );
    stops.push(() => geo.clearWatch(watchId));
  }, []);

  return { location, heading, sensor, start };
}
