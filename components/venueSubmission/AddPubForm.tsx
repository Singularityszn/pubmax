"use client";

// Add a pub: the form a signed-in drinker fills in for a pub the map does not
// have. The pub's name and street are all it needs; a menu, the prices they saw
// and the pub's links help the check. Nothing here goes on the map: a person
// checks every submission first, and the page says so.
//
// The send is behind the shared contribution gate, so a signed-out reader is
// asked to sign in or make an account and the draft waits for them. When the
// name looks like a pub we already have, the reader sees those pubs first and
// says it is a different one before anything is stored.

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";
import { Button } from "@/components/ui/button";
import { sameAccountAuth, accountComposerAuth, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { categoryLabel } from "@/lib/drinks";
import { DEFAULT_DRINK_MEASURE, DRINK_MEASURES, DRINK_MEASURE_LABEL } from "@/lib/drinkMeasure";
import { UPLOAD_PHOTO_MAX_LABEL } from "@/lib/uploadBodyLimit";
import {
  validateVenueSubmission,
  venueSubmissionStatusLabel,
  VENUE_SUBMISSION_ADDRESS_MAX,
  VENUE_SUBMISSION_DRINK_CATEGORIES,
  VENUE_SUBMISSION_DRINK_NAME_MAX,
  VENUE_SUBMISSION_FILE_ACCEPT,
  VENUE_SUBMISSION_FILE_MAX_BYTES,
  VENUE_SUBMISSION_FILE_TYPES,
  VENUE_SUBMISSION_MAX_FILES,
  VENUE_SUBMISSION_HOURS_MAX,
  VENUE_SUBMISSION_MAX_PRICES,
  VENUE_SUBMISSION_NAME_MAX,
  VENUE_SUBMISSION_NOTE_MAX,
  type ExistingVenueMatch,
  type VenueSubmissionOwnerDTO,
} from "@/lib/venueSubmissions";

import {
  listMyAddedPubs,
  postAddPub,
  uploadMenuFile,
  type AddPubDraft,
} from "./addPubClient";

import "./addPub.css";

type PriceRow = AddPubDraft["prices"][number];

type Sent = {
  submission: VenueSubmissionOwnerDTO;
  fileErrors: string[];
  added: VenueSubmissionOwnerDTO[];
};

// The measure starts at the vocabulary's own default, and the row's chooser asks for it.
const EMPTY_PRICE: PriceRow = { drinkCategory: "beer", drinkName: "", priceGbp: "", measure: DEFAULT_DRINK_MEASURE };

function emptyDraft(name: string): AddPubDraft {
  return { name, address: "", postcode: "", website: "", menuUrl: "", openingHours: "", note: "", prices: [] };
}

export default function AddPubForm({
  initialName = "",
  primaryAction = false,
}: {
  initialName?: string;
  primaryAction?: boolean;
}) {
  const { user, session, rejectedContributionAuth } = useAuth();
  const { requestContribution, contributionGateDialog } = useContributionGate();
  const [draft, setDraft] = useState<AddPubDraft>(() => emptyDraft(initialName));
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<ExistingVenueMatch[] | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const composerAuth = accountComposerAuth(user?.id ?? null, session, rejectedContributionAuth);

  function update<K extends keyof AddPubDraft>(key: K, value: AddPubDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (matches) setMatches(null);
  }

  function updatePrice(index: number, patch: Partial<PriceRow>) {
    setDraft((current) => ({
      ...current,
      prices: current.prices.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function chooseFiles(chosen: FileList | null) {
    if (!chosen) return;
    const next = [...files];
    for (const file of Array.from(chosen)) {
      if (next.length >= VENUE_SUBMISSION_MAX_FILES) {
        setError(`Add up to ${VENUE_SUBMISSION_MAX_FILES} menu photos.`);
        break;
      }
      if (!VENUE_SUBMISSION_FILE_TYPES.has(file.type)) {
        setError(`${file.name} isn't a photo. We take JPEG, PNG or WebP, not a PDF.`);
        continue;
      }
      if (file.size > VENUE_SUBMISSION_FILE_MAX_BYTES) {
        setError(`${file.name} is over ${UPLOAD_PHOTO_MAX_LABEL}.`);
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  }

  async function send(auth: AccountAuthSnapshot, confirmNew: boolean) {
    setSending(true);
    try {
      const result = await postAddPub(draft, auth, confirmNew);
      if (!result.ok) {
        if (result.kind === "matches") {
          setMatches(result.matches);
          return;
        }
        if (result.kind === "gate") return { status: result.status, error: result.error };
        setError(result.error);
        return;
      }
      const fileErrors: string[] = [];
      // One file per request: the platform caps a request body near one photo.
      for (const file of files) {
        const uploaded = await uploadMenuFile(result.submission.id, file, auth);
        if (!uploaded.ok) fileErrors.push(uploaded.error);
      }
      const added = await listMyAddedPubs(auth);
      setSent({ submission: result.submission, fileErrors, added });
      setDraft(emptyDraft(""));
      setFiles([]);
      setMatches(null);
    } finally {
      setSending(false);
    }
  }

  async function submit(confirmNew: boolean) {
    setError(null);
    // The same validator the route runs, for an answer before the network.
    const checked = validateVenueSubmission(composerAuth?.userId ?? "", draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    await requestContribution(async (auth) => {
      if (composerAuth && !sameAccountAuth(auth, composerAuth)) return { status: "sign_in_required" };
      return send(auth, confirmNew);
    });
  }

  if (sent) {
    return (
      <section className="addPubDone" role="status" aria-live="polite" data-testid="add-pub-done">
        <h2 className="addPubDoneTitle">Thanks. {sent.submission.name} is waiting for a check.</h2>
        <p className="addPubHint">
          A person reads every pub before it goes on the map, so it will not show straight away.
        </p>
        {sent.fileErrors.length > 0 ? (
          <ul className="addPubErrors" role="alert">
            {sent.fileErrors.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        {sent.added.length > 0 ? (
          <div className="addPubAdded">
            <h3 className="addPubSectionTitle">Pubs you&apos;ve added</h3>
            <ul className="addPubAddedList">
              {sent.added.map((row) => (
                <li key={row.id} className="addPubAddedRow">
                  <span className="addPubAddedName">{row.name}</span>
                  <span className="addPubAddedStatus">{venueSubmissionStatusLabel(row.status)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="addPubRow">
          <Button type="button" variant="secondary" onClick={() => setSent(null)}>
            Add another pub
          </Button>
          <Link href="/map" prefetch={false} className="addPubLink">Back to the map</Link>
        </div>
      </section>
    );
  }

  return (
    <form
      className="addPubForm"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void submit(false);
      }}
      noValidate
      data-testid="add-pub-form"
    >
      <fieldset className="addPubFieldset" disabled={sending}>
        <legend className="addPubSectionTitle">Where is it?</legend>
        <label className="addPubField">
          <span>Pub name</span>
          <input
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            autoComplete="off"
            maxLength={VENUE_SUBMISSION_NAME_MAX}
            required
          />
        </label>
        <label className="addPubField">
          <span>Street address</span>
          <input
            value={draft.address}
            onChange={(event) => update("address", event.target.value)}
            autoComplete="street-address"
            maxLength={VENUE_SUBMISSION_ADDRESS_MAX}
            required
          />
        </label>
        <label className="addPubField addPubField--short">
          <span>Postcode</span>
          <input
            value={draft.postcode}
            onChange={(event) => update("postcode", event.target.value)}
            autoComplete="postal-code"
            maxLength={10}
          />
        </label>
      </fieldset>

      <fieldset className="addPubFieldset" disabled={sending}>
        <legend className="addPubSectionTitle">The menu</legend>
        <label className="addPubField">
          <span>Menu photos</span>
          <input
            type="file"
            accept={VENUE_SUBMISSION_FILE_ACCEPT}
            multiple
            onChange={(event) => {
              chooseFiles(event.target.files);
              event.target.value = "";
            }}
            disabled={files.length >= VENUE_SUBMISSION_MAX_FILES}
          />
        </label>
        <p className="addPubHint">
          Up to {VENUE_SUBMISSION_MAX_FILES} photos, {UPLOAD_PHOTO_MAX_LABEL} each. A clear photo of the drinks board works.
        </p>
        {files.length > 0 ? (
          <ul className="addPubFiles">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="addPubFileRow">
                <span>{file.name}</span>
                <button
                  type="button"
                  className="addPubRemove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="addPubField">
          <span>Website</span>
          <input
            value={draft.website}
            onChange={(event) => update("website", event.target.value)}
            inputMode="url"
            autoComplete="url"
            placeholder="thecrown.co.uk"
          />
        </label>
        <label className="addPubField">
          <span>Link to the menu</span>
          <input
            value={draft.menuUrl}
            onChange={(event) => update("menuUrl", event.target.value)}
            inputMode="url"
            placeholder="thecrown.co.uk/drinks"
          />
        </label>
        <p className="addPubHint">We don&apos;t open links automatically. A person looks at them during the check.</p>
      </fieldset>

      <fieldset className="addPubFieldset" disabled={sending}>
        <legend className="addPubSectionTitle">Prices you saw</legend>
        <p className="addPubHint">Only figures you saw yourself. We check each one before it shows anywhere.</p>
        {draft.prices.map((row, index) => (
          <div key={index} className="addPubPriceRow" data-testid="add-pub-price-row">
            <label className="addPubField">
              <span>Drink</span>
              <select value={row.drinkCategory} onChange={(event) => updatePrice(index, { drinkCategory: event.target.value })}>
                {VENUE_SUBMISSION_DRINK_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{categoryLabel(category)}</option>
                ))}
              </select>
            </label>
            <label className="addPubField">
              <span>Name on the menu</span>
              <input
                value={row.drinkName}
                onChange={(event) => updatePrice(index, { drinkName: event.target.value })}
                maxLength={VENUE_SUBMISSION_DRINK_NAME_MAX}
                placeholder="Camden Hells"
              />
            </label>
            <label className="addPubField addPubField--short">
              <span>Price (£)</span>
              <input
                value={row.priceGbp}
                onChange={(event) => updatePrice(index, { priceGbp: event.target.value })}
                inputMode="decimal"
                placeholder="5.20"
              />
            </label>
            <label className="addPubField addPubField--short">
              <span>Measure</span>
              <select value={row.measure} onChange={(event) => updatePrice(index, { measure: event.target.value })}>
                {DRINK_MEASURES.map((measure) => (
                  <option key={measure} value={measure}>{DRINK_MEASURE_LABEL[measure]}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="addPubRemove"
              aria-label={`Remove price ${index + 1}`}
              onClick={() => update("prices", draft.prices.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        {draft.prices.length < VENUE_SUBMISSION_MAX_PRICES ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => update("prices", [...draft.prices, { ...EMPTY_PRICE }])}
          >
            Add a price
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="addPubFieldset" disabled={sending}>
        <legend className="addPubSectionTitle">Anything else</legend>
        <label className="addPubField">
          <span>Opening hours</span>
          <input
            value={draft.openingHours}
            onChange={(event) => update("openingHours", event.target.value)}
            maxLength={VENUE_SUBMISSION_HOURS_MAX}
            placeholder="Mon to Sat 12 to 11, Sun 12 to 10.30"
          />
        </label>
        <label className="addPubField">
          <span>Anything we should know?</span>
          <textarea
            value={draft.note}
            onChange={(event) => update("note", event.target.value)}
            maxLength={VENUE_SUBMISSION_NOTE_MAX}
            rows={3}
          />
        </label>
      </fieldset>

      {matches && matches.length > 0 ? (
        <section className="addPubMatches" aria-labelledby="add-pub-matches" data-testid="add-pub-matches">
          <h2 id="add-pub-matches" className="addPubSectionTitle">Is it one of these?</h2>
          <ul className="addPubAddedList">
            {matches.map((match) => (
              <li key={match.venueId} className="addPubAddedRow">
                <Link href={`/venue/${encodeURIComponent(match.venueId)}`} prefetch={false} className="addPubLink">
                  {match.venueName}
                </Link>
                {match.address ? <span className="addPubAddedStatus">{match.address}</span> : null}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            disabled={sending}
            onClick={() => void submit(true)}
          >
            It&apos;s a different pub. Send it
          </Button>
        </section>
      ) : null}

      {error ? <p className="addPubError" role="alert">{error}</p> : null}

      <div className="addPubRow">
        <Button
          type="submit"
          disabled={sending}
          data-primary-action={primaryAction ? "" : undefined}
          data-testid="add-pub-send"
        >
          {/* Never "Sign in": the form is the value, and the gate asks for an
              account at the send (docs/design/LAUNCH_SCREENS.md). */}
          {sending ? "Sending" : "Send it for a check"}
        </Button>
      </div>
      {contributionGateDialog}
    </form>
  );
}
