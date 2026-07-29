"use client";

import { useEffect, useState, type FormEvent } from "react";

import { authedFetch } from "@/lib/authedFetch";
import {
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";

const SEX_LABELS: Record<PrivateIdentitySex, string> = {
  female: "Female",
  male: "Male",
  intersex: "Intersex",
  prefer_not_to_say: "Prefer not to say",
};

type PrivateIdentityEditorFormProps = {
  fullName: string;
  sex: "" | PrivateIdentitySex;
  busy: boolean;
  message: string;
  onFullNameChange: (value: string) => void;
  onSexChange: (value: "" | PrivateIdentitySex) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function PrivateIdentityEditorForm({
  fullName,
  sex,
  busy,
  message,
  onFullNameChange,
  onSexChange,
  onSubmit,
}: PrivateIdentityEditorFormProps): React.JSX.Element {
  return (
    <form onSubmit={onSubmit}>
      <h3>Private account details</h3>
      <label>
        Full name <small>Optional</small>
        <input
          value={fullName}
          maxLength={100}
          autoComplete="name"
          onChange={(event) => onFullNameChange(event.target.value)}
        />
      </label>
      <label>
        Sex <small>Optional</small>
        <select
          value={sex}
          onChange={(event) =>
            onSexChange(event.target.value as "" | PrivateIdentitySex)
          }
        >
          <option value="">Not provided</option>
          {PRIVATE_IDENTITY_SEX_VALUES.map((value) => (
            <option value={value} key={value}>
              {SEX_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <small>Only your handle is public. These details stay private.</small>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save private details"}
      </button>
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

export default function PrivateIdentityEditor(): React.JSX.Element {
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<"" | PrivateIdentitySex>("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void authedFetch("/api/identity/onboarding", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          fullName?: unknown;
          sex?: unknown;
          error?: unknown;
        };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setMessage(
            typeof body.error === "string"
              ? body.error
              : "Private details could not be loaded.",
          );
          return;
        }
        setFullName(typeof body.fullName === "string" ? body.fullName : "");
        setSex(
          typeof body.sex === "string" &&
            PRIVATE_IDENTITY_SEX_VALUES.includes(
              body.sex as PrivateIdentitySex,
            )
            ? (body.sex as PrivateIdentitySex)
            : "",
        );
      })
      .catch((error: unknown) => {
        if ((error as { name?: unknown })?.name !== "AbortError") {
          setMessage("Private details could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await authedFetch("/api/identity/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, sex }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };
      setMessage(
        response.ok
          ? "Private details saved."
          : typeof body.error === "string"
            ? body.error
            : "Private details could not be saved.",
      );
    } catch {
      setMessage("Private details could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PrivateIdentityEditorForm
      fullName={fullName}
      sex={sex}
      busy={busy}
      message={message}
      onFullNameChange={setFullName}
      onSexChange={setSex}
      onSubmit={(event) => void save(event)}
    />
  );
}
