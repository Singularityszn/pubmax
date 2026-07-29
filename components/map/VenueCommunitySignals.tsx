"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ChevronDown, MessagesSquare } from "lucide-react";

import type { ContributionActionResult } from "@/components/identity/ContributionGateDialog";
import type { CommunityVenueSignalSubmitResult } from "@/components/map/useCommunityPrices";
import type { AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";
import {
  COMMUNITY_VENUE_SIGNAL_LABELS,
  COMMUNITY_VENUE_SIGNAL_OPTIONS,
  communityVenueSignalText,
  type CommunityVenueSignal,
  type CommunityVenueSignalKey,
  type CommunityVenueSignalValue,
} from "@/lib/communityVenueSignals";

type AuthorQuestion =
  | "character"
  | "access"
  | "door-policy"
  | "people-eating";

const AUTHOR_QUESTIONS: readonly {
  value: AuthorQuestion;
  label: string;
}[] = [
  { value: "character", label: "Character" },
  { value: "access", label: "Access" },
  { value: "door-policy", label: "Door" },
  { value: "people-eating", label: "Eating" },
];

const READER_KEYS: readonly CommunityVenueSignalKey[] = [
  "character",
  "step-free-venue",
  "step-free-toilets",
  "door-policy",
  "people-eating",
];

type VenueCommunitySignalsProps = {
  venueId: string;
  venueName: string;
  signals: readonly CommunityVenueSignal[];
  readStatus: VenuePriceReadStatus;
  submitting: boolean;
  onSubmit: (input: {
    venueId: string;
    signalKey: CommunityVenueSignalKey;
    signalValue: CommunityVenueSignalValue;
  }, auth: AccountAuthSnapshot) => Promise<CommunityVenueSignalSubmitResult>;
  requestContribution: (
    action: (
      auth: AccountAuthSnapshot,
    ) => ContributionActionResult | Promise<ContributionActionResult>,
  ) => Promise<void>;
  /** Fixed test clock. The app leaves it undefined. */
  now?: number;
};

function rowFor(
  signals: readonly CommunityVenueSignal[],
  signalKey: CommunityVenueSignalKey,
): CommunityVenueSignal | undefined {
  return signals.find((row) => row.signalKey === signalKey);
}

function accessSummary(
  readStatus: VenuePriceReadStatus,
  signals: readonly CommunityVenueSignal[],
  now: number,
): string {
  if (readStatus === "degraded") return "Access unread";
  if (readStatus !== "ready") return "Checking access";
  const entrance = communityVenueSignalText(
    "step-free-venue",
    rowFor(signals, "step-free-venue"),
    now,
  );
  const toilets = communityVenueSignalText(
    "step-free-toilets",
    rowFor(signals, "step-free-toilets"),
    now,
  );
  // Read the trust state, never the sentence: an access question that is only
  // one person's report stays unknown here however that report is worded.
  const entranceUnknown = entrance.trust === "unknown";
  const toiletsUnknown = toilets.trust === "unknown";
  if (entranceUnknown && toiletsUnknown) return "Access unknown";
  if (entranceUnknown) return "Entrance unknown";
  if (toiletsUnknown) return "Toilets unknown";
  return "Access reported";
}

export default function VenueCommunitySignals({
  venueId,
  venueName,
  signals,
  readStatus,
  submitting,
  onSubmit,
  requestContribution,
  now,
}: VenueCommunitySignalsProps) {
  const [mountedAt] = useState(() => Date.now());
  const observationNow = now ?? mountedAt;
  const [question, setQuestion] = useState<AuthorQuestion>("character");
  const [accessKey, setAccessKey] =
    useState<CommunityVenueSignalKey>("step-free-venue");
  const [selectedValue, setSelectedValue] =
    useState<CommunityVenueSignalValue>("rough");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const signalKey: CommunityVenueSignalKey =
    question === "access" ? accessKey : question;
  const options = COMMUNITY_VENUE_SIGNAL_OPTIONS[signalKey];
  const selectedIsValid = options.some(
    (option) => option.value === selectedValue,
  );
  const signalValue = selectedIsValid
    ? selectedValue
    : options[0].value;

  const readerRows = useMemo(
    () =>
      READER_KEYS.map((key) => ({
        key,
        text: communityVenueSignalText(
          key,
          rowFor(signals, key),
          observationNow,
        ),
      })),
    [observationNow, signals],
  );

  function chooseQuestion(next: AuthorQuestion) {
    setQuestion(next);
    const nextKey = next === "access" ? accessKey : next;
    setSelectedValue(COMMUNITY_VENUE_SIGNAL_OPTIONS[nextKey][0].value);
    setError(null);
    setSaved(false);
  }

  function chooseAccess(next: CommunityVenueSignalKey) {
    setAccessKey(next);
    setSelectedValue(COMMUNITY_VENUE_SIGNAL_OPTIONS[next][0].value);
    setError(null);
    setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSaved(false);
    await requestContribution(async (auth) => {
      const result = await onSubmit({
        venueId,
        signalKey,
        signalValue,
      }, auth);
      if (!result.ok) {
        if (result.status === "sign_in_required") {
          return {
            status: "sign_in_required" as const,
            error: result.error,
          };
        }
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <details className="venueCommunitySignals">
      <summary className="vpsigSummary">
        <span className="vpsigSummaryTitle">
          <MessagesSquare size={15} aria-hidden="true" />
          What drinkers noticed
        </span>
        <span className="vpsigAccessSummary">
          {accessSummary(readStatus, signals, observationNow)}
        </span>
        <ChevronDown
          className="vpsigSummaryChevron"
          size={16}
          aria-hidden="true"
        />
      </summary>

      <div className="vpsigBody">
        <p className="vpsigIntro">
          These are what drinkers said they saw, not venue facts.
        </p>
        <dl className="vpsigReadout">
          {readerRows.map(({ key, text }) => (
            <div className="vpsigReadoutRow" key={key}>
              <dt>{COMMUNITY_VENUE_SIGNAL_LABELS[key]}</dt>
              <dd>
                <span>{text.primary}</span>
                {text.detail ? <small>{text.detail}</small> : null}
              </dd>
            </div>
          ))}
        </dl>

        <form className="vpsigForm" onSubmit={(event) => void submit(event)}>
          <p className="vpsigFormTitle">Add what you noticed</p>
          <fieldset
            className="vpsigQuestions"
            aria-label="What did you notice?"
          >
            {AUTHOR_QUESTIONS.map((item) => (
              <label className="vpsigQuestion" key={item.value}>
                <input
                  type="radio"
                  name={`signal-question-${venueId}`}
                  value={item.value}
                  checked={question === item.value}
                  onChange={() => chooseQuestion(item.value)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>

          <fieldset
            className="vpsigAccessTargets"
            aria-label="Which access did you check?"
            hidden={question !== "access"}
          >
            {(["step-free-venue", "step-free-toilets"] as const).map(
              (key) => (
                <label className="vpsigQuestion" key={key}>
                  <input
                    type="radio"
                    name={`signal-access-${venueId}`}
                    value={key}
                    checked={accessKey === key}
                    onChange={() => chooseAccess(key)}
                  />
                  <span>
                    {key === "step-free-venue" ? "Entrance" : "Toilets"}
                  </span>
                </label>
              ),
            )}
          </fieldset>

          <fieldset
            className="vpsigOptions"
            aria-label={`What did you notice about ${COMMUNITY_VENUE_SIGNAL_LABELS[signalKey].toLowerCase()} at ${venueName}?`}
          >
            {options.map((option) => (
              <label className="vpsigOption" key={option.value}>
                <input
                  type="radio"
                  name={`signal-value-${venueId}`}
                  value={option.value}
                  checked={signalValue === option.value}
                  onChange={() => {
                    setSelectedValue(option.value);
                    setError(null);
                    setSaved(false);
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>

          {question === "character" ? (
            <p className="vpsigCharacterNote">
              Neither character answer is a score. It is your judgement.
            </p>
          ) : null}

          <button className="vpsigSubmit" type="submit" disabled={submitting}>
            {submitting ? "Logging…" : "Log what you saw"}
          </button>
          {error ? (
            <p className="vpsigError" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="vpsigSaved" role="status">
              Logged as your report. A second drinker can confirm it.
            </p>
          ) : null}
        </form>
      </div>
    </details>
  );
}
