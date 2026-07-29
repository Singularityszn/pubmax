"use client";

import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import {
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";
import { loadPrivateIdentity } from "@/lib/privateIdentityClient";

const SEX_LABELS: Record<PrivateIdentitySex, string> = {
  female: "Female",
  male: "Male",
  intersex: "Intersex",
  prefer_not_to_say: "Prefer not to say",
};

type PrivateIdentityEditorFormProps = {
  fullName: string;
  sex: "" | PrivateIdentitySex;
  saving: boolean;
  saveEnabled: boolean;
  message: string;
  onRetryLoad: (() => void) | null;
  onFullNameChange: (value: string) => void;
  onSexChange: (value: "" | PrivateIdentitySex) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function PrivateIdentityEditorForm({
  fullName,
  sex,
  saving,
  saveEnabled,
  message,
  onRetryLoad,
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
          <option value="">Not added</option>
          {PRIVATE_IDENTITY_SEX_VALUES.map((value) => (
            <option value={value} key={value}>
              {SEX_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <small>
        Only your handle is public. These optional details stay private.
      </small>
      <button type="submit" disabled={!saveEnabled || saving}>
        {saving ? "Saving…" : "Save private details"}
      </button>
      {onRetryLoad ? (
        <button type="button" onClick={onRetryLoad}>
          Try again
        </button>
      ) : null}
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

function PrivateIdentityEditorForAccount({
  auth,
}: {
  auth: AccountAuthSnapshot;
}): React.JSX.Element {
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<"" | PrivateIdentitySex>("");
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [loadRequest, setLoadRequest] = useState(() => ({
    auth,
    attempt: 0,
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadPrivateIdentity(
      loadRequest.auth,
      fetch,
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status === "unavailable") {
        setLoadStatus("unavailable");
        setMessage(result.error);
        return;
      }
      setFullName(result.fullName);
      setSex(result.sex);
      setMessage("");
      setLoadStatus("ready");
    });
    return () => controller.abort();
  }, [loadRequest]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadStatus !== "ready" || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await accountBoundFetch(
        auth,
        "/api/identity/onboarding",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fullName, sex }),
        },
      );
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
      setSaving(false);
    }
  }

  return (
    <PrivateIdentityEditorForm
      fullName={fullName}
      sex={sex}
      saving={saving}
      saveEnabled={loadStatus === "ready"}
      message={message}
      onRetryLoad={
        loadStatus === "unavailable"
          ? () => {
              setLoadStatus("loading");
              setMessage("");
              setLoadRequest((current) => ({
                auth,
                attempt: current.attempt + 1,
              }));
            }
          : null
      }
      onFullNameChange={setFullName}
      onSexChange={setSex}
      onSubmit={(event) => void save(event)}
    />
  );
}

export default function PrivateIdentityEditor(): React.JSX.Element {
  const { user, session } = useAuth();
  const auth = captureAccountAuth(user?.id ?? null, session);
  if (!auth) {
    return (
      <PrivateIdentityEditorForm
        fullName=""
        sex=""
        saving={false}
        saveEnabled={false}
        message="Private details are unavailable. Sign in again."
        onRetryLoad={null}
        onFullNameChange={() => {}}
        onSexChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
      />
    );
  }
  return <PrivateIdentityEditorForAccount key={auth.userId} auth={auth} />;
}
