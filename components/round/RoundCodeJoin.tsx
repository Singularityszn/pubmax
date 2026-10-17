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
    <form className="roundCodeJoin" onSubmit={open}>
      <div className="roundStarterRow">
        <input
          type="text"
          className="roundCodeJoinInput"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Round code"
          aria-label="Round code"
          aria-describedby={error ? "round-code-join-error" : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={ROUND_CODE_LENGTH + 4}
        />
        <button type="submit" className="roundCodeJoinBtn">
          Open the Round
        </button>
      </div>
      {error ? (
        <p id="round-code-join-error" className="roundCodeJoinError" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
