"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { safeSessionStorage } from "@/lib/safeStorage";

import {
  ROUND_ROTA_MAX_NAMES, ROUND_ROTA_NAME_LIMIT, cleanRotaName, clearRoundRota,
  readRoundRota, rotaNameIssue, saveRoundRota, type RoundRotaState,
} from "./RoundRotaState";
import "./RoundRota.css";

type RoundRotaProps = { ownerId: string; roundId: string; currentOwnerId: () => string | null };

export default function RoundRota(props: RoundRotaProps) {
  return <RoundRotaSession key={`${props.ownerId}:${props.roundId}`} {...props} />;
}

function RoundRotaSession({ ownerId, roundId, currentOwnerId }: RoundRotaProps) {
  const id = useId();
  const [rota, setRota] = useState<RoundRotaState>(() => currentOwnerId() === ownerId
    ? readRoundRota(ownerId, roundId, safeSessionStorage()) : { names: [], current: 0 });
  const value = useRef(rota);
  const active = useRef(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  function commit(next: RoundRotaState) {
    if (!active.current || currentOwnerId() !== ownerId) return;
    value.current = next;
    setRota(next);
    setNotice(saveRoundRota(ownerId, roundId, next, safeSessionStorage())
      ? "" : "Your browser cannot keep this order after a reload.");
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active.current || currentOwnerId() !== ownerId) return;
    const issue = rotaNameIssue(name, value.current.names);
    setError(issue);
    if (issue) return;
    commit({ ...value.current, names: [...value.current.names, cleanRotaName(name)] });
    setName("");
  }

  function remove(index: number) {
    const previous = value.current;
    const names = previous.names.filter((_, at) => at !== index);
    const current = names.length === 0 ? 0
      : index < previous.current ? previous.current - 1 : previous.current % names.length;
    commit({ names, current });
  }

  function clear() {
    if (!active.current || currentOwnerId() !== ownerId) return;
    const cleared = clearRoundRota(ownerId, roundId, safeSessionStorage());
    value.current = { names: [], current: 0 };
    setRota(value.current);
    setName("");
    setError(null);
    setNotice(cleared ? "" : "The names are cleared here. Your browser could not clear the saved copy.");
  }

  return (
    <section className="roundRota" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Your turn order</h2>
      <p className="roundRotaPrivacy">Private to this account on this device. The crew cannot see it.</p>
      {rota.names.length ? <>
        <p className="roundRotaCurrent" role="status" aria-live="polite" aria-atomic="true">
          Next turn: <strong>{rota.names[rota.current]}</strong>
        </p>
        <ol className="roundRotaNames">
          {rota.names.map((person, index) => <li key={person} aria-current={index === rota.current ? "step" : undefined}>
            <span>{person}</span>
            <Button type="button" variant="ghost" aria-label={`Remove ${person}`} onClick={() => remove(index)}>Remove</Button>
          </li>)}
        </ol>
        <div className="roundRotaActions">
          <Button type="button" variant="secondary" data-next-turn="" disabled={rota.names.length < 2}
            onClick={() => commit({ ...value.current, current: (value.current.current + 1) % value.current.names.length })}>
            Next person
          </Button>
          <Button type="button" variant="ghost" disabled={rota.current === 0}
            onClick={() => commit({ ...value.current, current: 0 })}>Start order again</Button>
          <Button type="button" variant="ghost" onClick={clear}>Clear names</Button>
        </div>
      </> : <p className="roundRotaEmpty">Add the names in turn order.</p>}
      <form className="roundRotaForm" onSubmit={add}>
        <label htmlFor={`${id}-name`}>Add a name</label>
        <div className="roundRotaAdd">
          <input id={`${id}-name`} type="text" value={name} maxLength={ROUND_ROTA_NAME_LIMIT}
            autoComplete="off" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => { setName(event.target.value); setError(null); }} />
          <Button type="submit" variant="secondary" disabled={rota.names.length >= ROUND_ROTA_MAX_NAMES}>Add</Button>
        </div>
        {error ? <p id={`${id}-error`} className="roundRotaError" role="alert">{error}</p> : null}
      </form>
      {notice ? <p className="roundRotaNotice" role="status">{notice}</p> : null}
    </section>
  );
}
