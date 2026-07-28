"use client";

import { Check, CloudSun } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { authedFetch } from "@/lib/authedFetch";
import { normalizeHandle } from "@/lib/profiles";
import {
  isWeatherRecommendationCondition,
  validateWeatherRecommendation,
  weatherRecommendationConditionLabel,
  weatherRecommendationConditionSentence,
  weatherRecommendationErrorField,
  WEATHER_RECOMMENDATION_CONDITIONS,
  WEATHER_RECOMMENDATION_REASON_MAX,
  type WeatherRecommendation,
  type WeatherRecommendationCondition,
  type WeatherRecommendationErrorField,
} from "@/lib/weatherRecommendations";

import "./venueWeatherRecommendations.css";

const HANDLE_KEY = "pubmax_handle";
const HANDLE_MAX = 30;

type RecommendationFormError = {
  message: string;
  field: WeatherRecommendationErrorField;
};

// Which field a refusal belongs to is answered by the shared validator's own
// message table, or by the route's machine code when the refusal is about who
// owns the handle. Never by reading server prose.
function recommendationError(
  message: string,
  code?: unknown,
): RecommendationFormError {
  const field: WeatherRecommendationErrorField =
    code === "FORBIDDEN" ? "handle" : weatherRecommendationErrorField(message);
  return { message, field };
}

export type WeatherRecommendationVenueLoad = {
  weatherStatus: "available" | "unavailable";
  matchingConditions: WeatherRecommendationCondition[];
  recommendations: WeatherRecommendation[];
  degraded: boolean;
  truncated: boolean;
};

export type WeatherRecommendationVenueLoadResult =
  | { status: "ready"; value: WeatherRecommendationVenueLoad }
  | { status: "invalid" };

function readRecommendation(value: unknown): WeatherRecommendation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const validation = validateWeatherRecommendation(row);
  const id = typeof row.id === "string" ? row.id : "";
  const submittedAt =
    typeof row.submittedAt === "number" && Number.isFinite(row.submittedAt)
      ? row.submittedAt
      : Number.NaN;
  if (
    !validation.ok ||
    !id ||
    !Number.isFinite(submittedAt) ||
    row.source !== "community"
  ) {
    return null;
  }
  return {
    id,
    ...validation.value,
    submittedAt,
    source: "community",
  };
}

export function readWeatherRecommendationVenueLoad(
  value: unknown,
): WeatherRecommendationVenueLoadResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid" };
  }
  const body = value as Record<string, unknown>;
  if (
    body.weatherStatus !== "available" &&
    body.weatherStatus !== "unavailable"
  ) {
    return { status: "invalid" };
  }
  if (
    !Array.isArray(body.matchingConditions) ||
    !body.matchingConditions.every(isWeatherRecommendationCondition) ||
    new Set(body.matchingConditions).size !== body.matchingConditions.length ||
    !Array.isArray(body.recommendations)
  ) {
    return { status: "invalid" };
  }
  // One unreadable row is not an unreadable venue. The store drops a bad row
  // and keeps the rest, so this half does the same and says the read was
  // partial rather than throwing away opinions the server could read.
  const parsed = body.recommendations.map(readRecommendation);
  const recommendations = parsed.filter(
    (row): row is WeatherRecommendation => row !== null,
  );
  return {
    status: "ready",
    value: {
      weatherStatus: body.weatherStatus,
      matchingConditions:
        body.matchingConditions as WeatherRecommendationCondition[],
      recommendations,
      degraded:
        body.degraded === true || recommendations.length !== parsed.length,
      truncated: body.truncated === true,
    },
  };
}

function recommendationDay(submittedAt: number): string {
  return new Date(submittedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WeatherRecommendationList({
  venueName,
  recommendations,
  weatherStatus,
  matchingConditions,
  degraded,
  truncated,
}: {
  venueName: string;
  recommendations: WeatherRecommendation[];
  weatherStatus: WeatherRecommendationVenueLoad["weatherStatus"];
  matchingConditions: WeatherRecommendationCondition[];
  degraded: boolean;
  truncated: boolean;
}) {
  const empty = recommendations.length === 0;
  // Weather we could read, but that is none of the five conditions anyone can
  // author for. Nothing here is a fact about contributors, so nothing here
  // invites one: the reader cannot complete an invitation the form cannot take.
  const outsideVocabulary =
    weatherStatus === "available" && matchingConditions.length === 0;

  return (
    <section
      className="weatherRecRead"
      aria-label={`Recommendations for ${venueName}`}
    >
      {weatherStatus === "unavailable" ? (
        <p className="weatherRecAvailability" role="note">
          We couldn&rsquo;t check the weather here just now.
          {empty ? null : (
            <>
              {" "}
              These are Pubmaxxers&rsquo; recommendations, shown without a
              weather match.
            </>
          )}
        </p>
      ) : null}
      {degraded ? (
        <p className="weatherRecAvailability" role="note">
          We couldn&rsquo;t read every recommendation here just now.
        </p>
      ) : null}
      {empty && !degraded ? (
        <p className="weatherRecEmpty">
          {weatherStatus === "unavailable"
            ? "Nobody has recommended this pub yet. Be the first."
            : outsideVocabulary
              ? "We don’t have recommendations for today’s conditions."
              : "Nobody has recommended this pub for tonight’s weather yet. Be the first."}
        </p>
      ) : null}
      {recommendations.length > 0 ? (
        <>
          <h4 className="weatherRecListTitle">
            {weatherStatus === "available"
              ? "Fits tonight"
              : "Pubmaxxers recommend"}
          </h4>
          <div className="weatherRecList">
            {recommendations.map((recommendation) => (
              <article className="weatherRecOpinion" key={recommendation.id}>
                <p className="weatherRecAttribution">
                  <Link
                    href={`/u/${encodeURIComponent(
                      recommendation.contributorHandle,
                    )}`}
                  >
                    @{recommendation.contributorHandle}
                  </Link>{" "}
                  recommends this when{" "}
                  {weatherRecommendationConditionSentence(
                    recommendation.condition,
                  )}
                  .
                </p>
                <blockquote>
                  <p>{recommendation.reason}</p>
                </blockquote>
                <p className="weatherRecDate">
                  Recommended {recommendationDay(recommendation.submittedAt)}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {truncated ? (
        <p className="weatherRecAvailability" role="note">
          More recommendations stay on record.
        </p>
      ) : null}
    </section>
  );
}

function readStoredHandle(): string {
  try {
    return normalizeHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
  } catch {
    return "";
  }
}

export default function VenueWeatherRecommendations({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const [condition, setCondition] =
    useState<WeatherRecommendationCondition>("warm");
  const [reason, setReason] = useState("");
  const [contributorHandle, setContributorHandle] = useState("");
  const [load, setLoad] = useState<WeatherRecommendationVenueLoad | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<RecommendationFormError | null>(null);
  const [saved, setSaved] = useState<WeatherRecommendation | null>(null);

  const loadRecommendations = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/weather-recommendations?venueId=${encodeURIComponent(venueId)}`,
          { signal },
        );
        if (!response.ok) throw new Error("recommendation read failed");
        const parsed = readWeatherRecommendationVenueLoad(await response.json());
        if (parsed.status !== "ready") {
          throw new Error("invalid recommendation payload");
        }
        setLoad(parsed.value);
        setLoadFailed(false);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setLoadFailed(true);
      }
    },
    [venueId],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function begin() {
      const stored = readStoredHandle();
      if (stored) setContributorHandle(stored);
      await loadRecommendations(controller.signal);
    }
    void begin();
    return () => controller.abort();
  }, [loadRecommendations]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSaved(null);

    const validation = validateWeatherRecommendation({
      venueId,
      condition,
      reason,
      contributorHandle,
    });
    if (!validation.ok) {
      setError(recommendationError(validation.error));
      return;
    }

    setSubmitting(true);
    try {
      const response = await authedFetch("/api/weather-recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validation.value),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setError(
          recommendationError(
            typeof body.error === "string"
              ? body.error
              : "Could not save that recommendation right now.",
            body.code,
          ),
        );
        return;
      }
      const recommendation = readRecommendation(body.recommendation);
      if (!recommendation) {
        setError(
          recommendationError("Could not read that saved recommendation."),
        );
        return;
      }
      try {
        window.localStorage.setItem(
          HANDLE_KEY,
          recommendation.contributorHandle,
        );
      } catch {
        // The Recommendation still landed. Only handle recall is unavailable.
      }
      setContributorHandle(recommendation.contributorHandle);
      setReason("");
      setSaved(recommendation);
      await loadRecommendations();
    } catch {
      setError(
        recommendationError("Could not save that recommendation right now."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="venueWeatherRecommendations"
      aria-labelledby={`weatherRecTitle-${venueId}`}
    >
      <div className="weatherRecHead">
        <CloudSun size={17} aria-hidden="true" />
        <h3 id={`weatherRecTitle-${venueId}`}>
          Recommend it for the weather
        </h3>
      </div>

      {load ? (
        <WeatherRecommendationList
          venueName={venueName}
          recommendations={load.recommendations}
          weatherStatus={load.weatherStatus}
          matchingConditions={load.matchingConditions}
          degraded={load.degraded}
          truncated={load.truncated}
        />
      ) : loadFailed ? null : (
        <p className="weatherRecLoading" aria-live="polite">
          Checking Pubmaxxers&rsquo; recommendations for tonight.
        </p>
      )}

      {loadFailed ? (
        <p className="weatherRecAvailability" role="note">
          {load
            ? "We couldn’t refresh recommendations here just now, so these may be out of date."
            : "We couldn’t read recommendations here just now."}
        </p>
      ) : null}

      <form className="weatherRecForm" onSubmit={submit}>
        <p className="weatherRecPrompt">
          Pick the weather, then say why you&rsquo;d choose this place.
        </p>
        <div
          className="weatherRecConditions"
          role="radiogroup"
          aria-label={`When does ${venueName} suit?`}
        >
          {WEATHER_RECOMMENDATION_CONDITIONS.map((option) => (
            <label
              key={option}
              className={
                condition === option
                  ? "weatherRecCondition weatherRecConditionOn"
                  : "weatherRecCondition"
              }
            >
              <input
                type="radio"
                name="condition"
                value={option}
                checked={condition === option}
                onChange={() => {
                  setCondition(option);
                  setError(null);
                  setSaved(null);
                }}
              />
              <span>{weatherRecommendationConditionLabel(option)}</span>
            </label>
          ))}
        </div>

        <label className="weatherRecField">
          <span>Your Pubmaxx handle</span>
          <input
            type="text"
            name="contributorHandle"
            value={contributorHandle}
            onChange={(event) => {
              setContributorHandle(event.target.value);
              setError(null);
            }}
            aria-label="Your Pubmaxx handle"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={HANDLE_MAX}
            placeholder="your_handle"
            aria-invalid={error?.field === "handle"}
            aria-describedby={
              error?.field === "handle"
                ? `weatherRecError-${venueId}`
                : undefined
            }
          />
        </label>

        <label className="weatherRecField">
          <span>Why it suits {weatherRecommendationConditionLabel(condition).toLowerCase()}</span>
          <textarea
            name="reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
              setSaved(null);
            }}
            aria-label={`Why ${venueName} suits this weather`}
            aria-invalid={error?.field === "reason"}
            aria-describedby={
              error?.field === "reason"
                ? `weatherRecError-${venueId}`
                : undefined
            }
            maxLength={WEATHER_RECOMMENDATION_REASON_MAX}
            rows={3}
            placeholder="The garden keeps the evening light."
          />
        </label>

        <button
          type="submit"
          className="weatherRecSubmit"
          disabled={
            submitting ||
            contributorHandle.trim() === "" ||
            reason.trim() === ""
          }
        >
          {submitting ? "Saving…" : "Recommend it"}
        </button>

        {error ? (
          <p
            className="weatherRecError"
            id={`weatherRecError-${venueId}`}
            role="alert"
          >
            {error.message}
          </p>
        ) : null}

        {saved ? (
          <p className="weatherRecSaved" role="status">
            <Check size={15} aria-hidden="true" />
            Saved under @{saved.contributorHandle} for{" "}
            {weatherRecommendationConditionLabel(
              saved.condition,
            ).toLowerCase()}{" "}
            weather.
          </p>
        ) : null}

        <p className="weatherRecHonesty">
          This is your opinion, shown under your handle. Weather only decides
          when it appears as a match.
        </p>
      </form>
    </section>
  );
}
