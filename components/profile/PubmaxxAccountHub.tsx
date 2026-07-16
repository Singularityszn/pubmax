"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import { authedFetch } from "@/lib/authedFetch";
import { emitIdentityHandleChanged } from "@/lib/identityClient";
import NightMemoryStudio from "@/components/profile/NightMemoryStudio";
import {
  nightProfileInput,
  type NightProfile,
  type NightProfileInput,
} from "@/lib/nightProfile";
import {
  confirmedNightProfileMerge,
  nightProfileMergeState,
  readDeviceNightProfile,
  subscribeDeviceNightProfile,
  writeDeviceNightProfile,
  type NightProfileMergeChoice,
  type NightProfileMergeState,
} from "@/lib/nightProfileClient";
import type { SocialProvider, SocialProviderAvailability } from "@/lib/socialConnections";

type Connection = { provider: "x" | "instagram" | "tiktok"; username?: string; status: string };

const NO_SOCIAL_PROVIDERS: SocialProviderAvailability = {
  x: { oauth: false, manual: false },
  instagram: { oauth: false, manual: false },
  tiktok: { oauth: false, manual: false },
};

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export function SocialConnectionActions({
  providers,
  onConnect,
}: {
  providers: SocialProviderAvailability;
  onConnect: (provider: SocialProvider) => void;
}): React.JSX.Element | null {
  const available = (["x", "tiktok", "instagram"] as const).filter(
    (provider) => providers[provider].oauth,
  );
  if (available.length === 0) return null;
  return (
    <div className="accountHubActions">
      {available.map((provider) => (
        <button type="button" key={provider} onClick={() => onConnect(provider)}>
          Connect {PROVIDER_LABELS[provider]}
        </button>
      ))}
    </div>
  );
}

export default function PubmaxxAccountHub() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  const [instagramUrl, setInstagramUrl] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<SocialProviderAvailability>(NO_SOCIAL_PROVIDERS);
  const [accountNightProfile, setAccountNightProfile] = useState<NightProfile | null>(null);
  const [nightProfileLoaded, setNightProfileLoaded] = useState(false);
  const [deviceNightProfile, setDeviceNightProfile] = useState<NightProfileInput | null>(null);
  const [mergeDeferred, setMergeDeferred] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setNightProfileLoaded(false);
        setAccountNightProfile(null);
        setMergeDeferred(false);
      }
    });
    void Promise.all([
      authedFetch("/api/social-connections", { signal: controller.signal }),
      authedFetch("/api/identity/handle/current", { signal: controller.signal }),
      authedFetch("/api/me/night-profile", { signal: controller.signal }),
    ]).then(async ([social, identity, nightProfile]) => {
      if (controller.signal.aborted) return;
      if (social.ok) {
        const body = (await social.json()) as {
          connections?: Connection[];
          providers?: SocialProviderAvailability;
        };
        setConnections(body.connections ?? []);
        setProviders(body.providers ?? NO_SOCIAL_PROVIDERS);
      }
      if (identity.ok) {
        const owned = ((await identity.json()) as { handle?: string | null }).handle ?? null;
        setCurrentHandle(owned);
        if (owned) setHandle(owned);
      }
      if (nightProfile.ok) {
        setAccountNightProfile(
          ((await nightProfile.json()) as { profile?: NightProfile | null }).profile ?? null,
        );
        setNightProfileLoaded(true);
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    const refresh = () => setDeviceNightProfile(readDeviceNightProfile());
    queueMicrotask(refresh);
    return subscribeDeviceNightProfile(refresh);
  }, [user]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const provider = query.get("socialConnection");
    if (query.get("status") === "connected" && (provider === "x" || provider === "instagram" || provider === "tiktok")) {
      trackEvent("social_account_connected", { provider, connectionType: "oauth" });
    }
  }, []);

  async function claim(event: FormEvent) {
    event.preventDefault();
    const response = await authedFetch(currentHandle ? "/api/identity/handle/rename" : "/api/identity/handle/claim", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }),
    });
    const body = await response.json().catch(() => ({})) as { handle?: string; error?: string };
    if (!response.ok || !body.handle) return setMessage(body.error ?? "That handle is unavailable.");
    try { localStorage.setItem("pubmax_handle", body.handle); } catch { /* account ownership still persists */ }
    emitIdentityHandleChanged(body.handle);
    if (!currentHandle) trackEvent("account_claimed", { source: "you" });
    router.push(`/u/${encodeURIComponent(body.handle)}`);
  }

  async function connectOAuth(provider: SocialProvider) {
    const response = await authedFetch(`/api/social-connections/${provider}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "oauth" }),
    });
    const body = await response.json().catch(() => ({})) as { authorizeUrl?: string; error?: string };
    if (response.ok && body.authorizeUrl) window.location.assign(body.authorizeUrl);
    else setMessage(body.error ?? "That connection is unavailable.");
  }

  async function confirmProfileMerge(
    state: Exclude<NightProfileMergeState, { kind: "none" }>,
    choice: NightProfileMergeChoice,
  ) {
    const confirmed = confirmedNightProfileMerge(state, choice);
    if (!confirmed.writesAccount) {
      if (state.kind === "conflict") {
        writeDeviceNightProfile(nightProfileInput(state.account));
        setDeviceNightProfile(nightProfileInput(state.account));
      } else {
        setMergeDeferred(true);
      }
      setMessage("Your account preferences were left unchanged.");
      return;
    }
    const response = await authedFetch("/api/me/night-profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: confirmed.profile,
        expectedUpdatedAt: confirmed.expectedUpdatedAt,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      profile?: NightProfile;
      error?: string;
      details?: { currentProfile?: NightProfile | null };
    };
    if (!response.ok || !body.profile) {
      if (response.status === 409 && body.details?.currentProfile !== undefined) {
        setAccountNightProfile(body.details.currentProfile);
      }
      setMessage(body.error ?? "Your Night Profile could not be merged.");
      return;
    }
    setAccountNightProfile(body.profile);
    writeDeviceNightProfile(nightProfileInput(body.profile));
    setDeviceNightProfile(nightProfileInput(body.profile));
    setMessage("Your device preferences are now on your account.");
  }

  async function connectInstagram(event: FormEvent) {
    event.preventDefault();
    const response = await authedFetch("/api/social-connections/instagram", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "manual", accountKind: "personal", profileUrl: instagramUrl }),
    });
    const body = await response.json().catch(() => ({})) as { connection?: Connection; error?: string };
    if (!response.ok || !body.connection) return setMessage(body.error ?? "Could not add that profile.");
    setConnections((current) => [...current.filter((item) => item.provider !== "instagram"), body.connection!]);
    trackEvent("social_account_connected", { provider: "instagram", connectionType: "manual" });
    setInstagramUrl("");
  }

  if (loading) return <section className="accountHub" aria-busy="true"><p>Loading your account…</p></section>;
  if (!user) return <section className="accountHub"><p className="profileSectionKicker">Your PUBMAXX</p><h2>Own your nights.</h2><p>Sign in to claim a handle, connect profiles, and keep private Night Memories.</p>{deviceNightProfile ? <p>Your Night Profile stays on this device until you explicitly bring it to an account.</p> : null}<SignInButton /></section>;

  const mergeState = mergeDeferred || !nightProfileLoaded
    ? ({ kind: "none" } as const)
    : nightProfileMergeState(deviceNightProfile, accountNightProfile);

  return (
    <section className="accountHub" aria-labelledby="account-hub-title">
      <p className="profileSectionKicker">Your PUBMAXX</p><h2 id="account-hub-title">Identity, connections and memories.</h2>
      {mergeState.kind !== "none" ? (
        <div className="accountHubMerge" role="group" aria-labelledby="night-profile-merge-title">
          <h3 id="night-profile-merge-title">Bring your Night Profile?</h3>
          <p>
            {mergeState.kind === "conflict"
              ? "This device and your account have different night preferences. Nothing changes until you choose."
              : "This device has night preferences that are not on your account yet. Nothing changes until you choose."}
          </p>
          <div className="accountHubActions">
            <button type="button" onClick={() => void confirmProfileMerge(mergeState, "bring-device")}>Bring this device</button>
            <button type="button" onClick={() => void confirmProfileMerge(mergeState, "keep-account")}>
              {mergeState.kind === "conflict" ? "Keep account preferences" : "Keep only on this device"}
            </button>
          </div>
        </div>
      ) : accountNightProfile ? (
        <p className="accountHubNightProfile">Night Profile synced · {accountNightProfile.context.budget} budget{accountNightProfile.context.zeroProof ? " · zero-proof preferred" : ""}</p>
      ) : null}
      <div className="accountHubGrid">
        <form onSubmit={claim}><h3>{currentHandle ? "Your @handle" : "Claim your @handle"}</h3><input value={handle} onChange={(event) => setHandle(event.target.value)} pattern="[A-Za-z0-9_]{3,30}" placeholder="night_owl" required /><button type="submit">{currentHandle ? "Rename handle" : "Claim handle"}</button>{currentHandle ? <small>Renames are limited to once every 30 days. Old links keep working.</small> : null}</form>
        <div><h3>Connected accounts</h3><SocialConnectionActions providers={providers} onConnect={(provider) => void connectOAuth(provider)} />{providers.instagram.manual ? <form onSubmit={connectInstagram}><input type="url" value={instagramUrl} onChange={(event) => setInstagramUrl(event.target.value)} placeholder="Personal Instagram URL" required /><button type="submit">Add personal link</button></form> : null}<small>{connections.length} connected</small></div>
      </div>
      <NightMemoryStudio key={user.id} userId={user.id} />
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
}
