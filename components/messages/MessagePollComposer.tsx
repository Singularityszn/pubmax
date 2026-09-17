"use client";

// Writing a poll, without leaving the thread.
//
// The caps are `lib/messagePoll.ts`'s and are read from it rather than typed
// here, so the composer, the route and migration 0155 cannot disagree about how
// long a question may be or how many answers a ballot may hold.
//
// TWO BOXES TO START WITH, because two is the floor and a composer that opens
// with six empty rows reads as six required answers. Blank rows are dropped on
// the way out (`cleanPollOptions`), so the person who only wanted two never has
// to tidy up after it.

import { useEffect, useId, useRef, useState } from "react";

import {
  cleanPollOptions,
  cleanPollQuestion,
  POLL_ADD_OPTION_LABEL,
  POLL_ATTACH_LABEL,
  POLL_INVALID_LINE,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_LABEL,
  POLL_OPTION_MAX,
  POLL_QUESTION_LABEL,
  POLL_QUESTION_MAX,
  POLL_QUESTION_PLACEHOLDER,
  type MessagePollWrite,
} from "@/lib/messagePoll";

export default function MessagePollComposer({
  onPick,
  onCancel,
}: {
  onPick: (poll: MessagePollWrite) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(
    Array.from({ length: POLL_MIN_OPTIONS }, () => ""),
  );
  const [refused, setRefused] = useState(false);
  const questionRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  const cleanedQuestion = cleanPollQuestion(question);
  const cleanedOptions = cleanPollOptions(options);
  const ready = Boolean(cleanedQuestion && cleanedOptions);

  return (
    <div className="composerVenuePicker composerPollComposer">
      <label htmlFor={`${fieldId}-q`} className="composerVenueNote">
        {POLL_QUESTION_LABEL}
      </label>
      <input
        ref={questionRef}
        id={`${fieldId}-q`}
        type="text"
        className="composerVenueSearch"
        value={question}
        maxLength={POLL_QUESTION_MAX}
        placeholder={POLL_QUESTION_PLACEHOLDER}
        onChange={(event) => {
          setQuestion(event.target.value);
          setRefused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />

      <ul className="composerPollOptions">
        {options.map((option, index) => (
          <li key={index}>
            <label className="composerVenueNote" htmlFor={`${fieldId}-o${index}`}>
              {`${POLL_OPTION_LABEL} ${index + 1}`}
            </label>
            <input
              id={`${fieldId}-o${index}`}
              type="text"
              className="composerVenueSearch"
              value={option}
              maxLength={POLL_OPTION_MAX}
              onChange={(event) => {
                const next = event.target.value;
                setOptions((rows) => rows.map((row, i) => (i === index ? next : row)));
                setRefused(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          </li>
        ))}
      </ul>

      {options.length < POLL_MAX_OPTIONS ? (
        <button
          type="button"
          className="composerPendingRemove"
          onClick={() => setOptions((rows) => [...rows, ""])}
        >
          {POLL_ADD_OPTION_LABEL}
        </button>
      ) : null}

      {refused ? (
        <p className="composerVenueNote" role="alert">
          {POLL_INVALID_LINE}
        </p>
      ) : null}

      <div className="composerPickerActions">
        <button
          type="button"
          className="composerVenueResult"
          onClick={() => {
            if (!cleanedQuestion || !cleanedOptions) {
              setRefused(true);
              return;
            }
            onPick({ question: cleanedQuestion, options: cleanedOptions });
          }}
          aria-disabled={!ready}
        >
          {POLL_ATTACH_LABEL}
        </button>
        <button type="button" className="composerPendingRemove" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
