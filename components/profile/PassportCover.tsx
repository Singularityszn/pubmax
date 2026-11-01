"use client";

// The passport cover: the line under the profile head that says how many pubs
// this person has been to and how many they want to try, and, on the owner's
// own page, their patch from the Night Profile. A reader the account does not
// share with gets no cover at all (the read answers 403).

import { PASSPORT_COPY } from "@/lib/profilePassport";

import { usePassportRead, type PassportBeenRead } from "./PassportData";

import "./passportBook.css";

export default function PassportCover({ handle }: { handle: string }): React.JSX.Element | null {
  const been = usePassportRead<PassportBeenRead>("been", handle);
  if (!been) return null;
  const patch = been.cover?.patch ?? null;

  return (
    <dl className="passportCover" aria-label={PASSPORT_COPY.cover}>
      <div className="passportCoverItem">
        <dt>{PASSPORT_COPY.been}</dt>
        <dd>
          <a href="#passport-been" className="passportCoverFigure">
            {been.count}
          </a>
        </dd>
      </div>
      {typeof been.wantToTryCount === "number" ? (
        <div className="passportCoverItem">
          <dt>{PASSPORT_COPY.wantToTry}</dt>
          <dd className="passportCoverFigure">{been.wantToTryCount}</dd>
        </div>
      ) : null}
      {patch ? (
        <div className="passportCoverItem">
          <dt>{PASSPORT_COPY.patch}</dt>
          <dd>{patch}</dd>
        </div>
      ) : null}
    </dl>
  );
}
