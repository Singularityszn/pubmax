"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROUND_CODE_LENGTH, isValidRoundCode, normalizeRoundCode } from "@/lib/rounds";

import "./roundStarter.css";

export const ROUND_CODE_HINT = `A Round code is ${ROUND_CODE_LENGTH} letters and numbers.`;

/**
 * Join a Round by its code. A mate read the code out, or it came in a text
 * without the link: /rounds used to ask them to type it onto the end of a URL.
 * The code is normalised the way the store reads it (lib/rounds.ts), so
 * "jxkq-7m " still opens JXKQ7M, and the Round page itself does the joining.
 */
export default function RoundCodeJoin(): React.JSX.Element {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function open(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidRoundCode(code)) {
      setError(ROUND_CODE_HINT);
      return;
    }
    setError(null);
    router.push(`/rounds/${normalizeRoundCode(code)}`);
  }

  return (
    <details className="roundCodeJoin">
      <summary className="roundCodeJoinSummary">Open a round code</summary>
      <form className="roundCodeJoinForm" onSubmit={open}>
        <label className="roundStarterLabel" htmlFor="round-code-join-input">
          Round code
        </label>
        <p className="roundStarterBlurb" id="round-code-join-hint">
          The {ROUND_CODE_LENGTH} letters and numbers whoever started it shared.
        </p>
        <div className="roundStarterRow">
          <input
            id="round-code-join-input"
            type="text"
            className="roundCodeJoinInput"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            aria-describedby={error ? "round-code-join-hint round-code-join-error" : "round-code-join-hint"}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={ROUND_CODE_LENGTH + 4}
          />
          <button type="submit" className="roundCodeJoinBtn">
            Open
          </button>
        </div>
        {error ? (
          <p id="round-code-join-error" className="roundCodeJoinError" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
