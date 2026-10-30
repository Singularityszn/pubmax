"use client";

import { useId } from "react";

import { useMessageRecipientSearch } from "@/components/messages/useMessageRecipientSearch";
import { splitWithInput, WITH_TAG_MAX } from "@/lib/pintDropWithTags";

import "./withTagField.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** An anonymous drop takes no tags, so the search is not offered. */
  tagsAllowed: boolean;
};

const TOKEN_SPLIT = /([,\s]+)/;

/** The token the writer is typing now: the text after the last separator. */
export function currentWithToken(value: string): string {
  const parts = value.split(TOKEN_SPLIT);
  return parts.at(-1) ?? "";
}

/** Replace the token being typed with a picked handle and a separator. */
export function pickWithHandle(value: string, handle: string): string {
  const token = currentWithToken(value);
  const head = value.slice(0, value.length - token.length);
  return `${head}@${handle}, `;
}

/**
 * The "With" field. Free text for people who are not on PUBMAXX stays exactly
 * as it was. Typing `@` searches claimed handles (the same search the message
 * recipient picker uses), and a picked handle is a PROPOSAL: it is sent to
 * that person's tag inbox after the drop is saved, and until they approve it
 * the drop says "with 1 person" (lib/pintDropWithTags.ts).
 */
export default function WithTagField({ value, onChange, tagsAllowed }: Props) {
  const inputId = useId();
  const hintId = useId();
  const listId = useId();
  const search = useMessageRecipientSearch("");
  const token = currentWithToken(value);
  const searching = tagsAllowed && token.startsWith("@") && search.status !== "idle";
  const { handles } = splitWithInput(value);
  const full = handles.length >= WITH_TAG_MAX;

  return (
    <div className="spillTextField withTagField">
      <label className="spillFieldLabel" htmlFor={inputId}>
        With
      </label>
      <input
        id={inputId}
        value={value}
        aria-describedby={hintId}
        aria-controls={searching ? listId : undefined}
        autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          const nextToken = currentWithToken(next);
          search.changeQuery(tagsAllowed && nextToken.startsWith("@") ? nextToken : "");
        }}
        placeholder="Names, or @ to tag someone on PUBMAXX"
      />
      <p id={hintId} className="withTagHint">
        {tagsAllowed
          ? "Anyone you tag gets asked first. Until they say yes, the drop says “with 1 person”."
          : "Anonymous drops can't tag anyone. Names still show."}
      </p>
      {searching ? (
        <div id={listId} className="withTagMatches" role="group" aria-label="People on PUBMAXX">
          {search.status === "loading" ? <p role="status">Searching…</p> : null}
          {search.status === "error" ? <p role="status">{search.error}</p> : null}
          {search.status === "ready" && search.matches.length === 0 ? (
            <p role="status">Nobody with that handle yet.</p>
          ) : null}
          {search.matches.map((match) => (
            <button
              key={match.handle}
              type="button"
              className="withTagMatch"
              disabled={full || handles.includes(match.handle)}
              onClick={() => {
                onChange(pickWithHandle(value, match.handle));
                search.changeQuery("");
              }}
            >
              @{match.handle}
              {match.displayName ? <span> {match.displayName}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {tagsAllowed && handles.length > 0 ? (
        <p className="withTagHint" role="status">
          {`Asking ${handles.map((handle) => `@${handle}`).join(", ")} first.`}
        </p>
      ) : null}
    </div>
  );
}
