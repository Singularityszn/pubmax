"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  analyticsConsentDecision,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
  trackEvent,
} from "@/lib/analytics";
import type { AnalyticsConsentDecision } from "@/lib/analyticsIdentity";
import { authedFetch } from "@/lib/authedFetch";
import { emitIdentityHandleChanged } from "@/lib/identityClient";
import NightMemoryStudio from "@/components/profile/NightMemoryStudio";
import type { ReferralPrivateStatus } from "@/lib/referralStore";
import {
  cleanNightProfileInput,
  DEFAULT_NIGHT_PROFILE_INPUT,
  nightProfileInput,
  type NightProfile,
  type NightProfileInput,
} from "@/lib/nightProfile";
import {
  confirmedNightProfileMerge,
  nightProfileMergeState,
  readDeviceNightProfile,
  subscribeDeviceNightProfile,
  mirrorAccountNightProfileToDevice,
  writeDeviceNightProfile,
  type NightProfileMergeChoice,
  type NightProfileMergeState,
} from "@/lib/nightProfileClient";
import type { SocialProvider, SocialProviderAvailability } from "@/lib/socialConnections";
import { listEnabledCities, type CityId } from "@/lib/cities";
import { getNightAreasForCity } from "@/lib/nightAreas";

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

export function NightProfileControls({
  profile,
  disabled = false,
  saveLabel,
  onChange,
  onSave,
}: {
  profile: NightProfileInput;
  disabled?: boolean;
  saveLabel: string;
  onChange: (profile: NightProfileInput) => void;
  onSave?: () => void;
}): React.JSX.Element {
  const areas = getNightAreasForCity(profile.cityId);
  const update = (next: NightProfileInput) => {
    const clean = cleanNightProfileInput(next);
    if (clean) onChange(clean);
  };
  const updateContext = (patch: Partial<NightProfileInput["context"]>) => {
    update({ ...profile, context: { ...profile.context, ...patch } });
  };

  return (
    <section className="accountHubNightProfileEditor" aria-labelledby="night-profile-title">
      <div>
        <p className="profileSectionKicker">Night Profile</p>
        <h3 id="night-profile-title">How you like to go out.</h3>
        <p>Used to shape editable plans. Precise location and voice transcripts are never saved here.</p>
      </div>
      <div className="accountHubNightProfileGrid">
        <label>City<select disabled={disabled} value={profile.cityId} onChange={(event) => {
          const cityId = event.target.value as CityId;
          const firstArea = getNightAreasForCity(cityId)[0]?.slug ?? null;
          update({ ...profile, cityId, context: { ...profile.context, nightArea: firstArea } });
        }}>{listEnabledCities().map((city) => <option key={city.id} value={city.id}>{city.displayName}</option>)}</select></label>
        <label>Your patch<select disabled={disabled || areas.length === 0} value={profile.context.nightArea ?? ""} onChange={(event) => updateContext({ nightArea: event.target.value ? event.target.value as NightProfileInput["context"]["nightArea"] : null })}><option value="">No preference</option>{areas.map((area) => <option key={area.slug} value={area.slug}>{area.name}</option>)}</select></label>
        <label>Time<select disabled={disabled} value={profile.context.daypart} onChange={(event) => updateContext({ daypart: event.target.value as NightProfileInput["context"]["daypart"] })}><option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option><option value="get_home">Get home</option></select></label>
        <label>Group<select disabled={disabled} value={profile.context.partyType} onChange={(event) => updateContext({ partyType: event.target.value as NightProfileInput["context"]["partyType"] })}><option value="solo">Solo</option><option value="friends">Friends</option><option value="work">Work</option></select></label>
        <label>People<input disabled={disabled} type="number" min="1" max="30" value={profile.context.groupSize ?? ""} placeholder="Any" onChange={(event) => updateContext({ groupSize: event.target.value ? Math.max(1, Math.min(30, Number(event.target.value))) : null })} /></label>
        <label>Budget<select disabled={disabled} value={profile.context.budget} onChange={(event) => updateContext({ budget: event.target.value as NightProfileInput["context"]["budget"] })}><option value="value">Value</option><option value="standard">Standard</option><option value="treat">Treat</option></select></label>
        <label>Max per person<select disabled={disabled} value={profile.context.budgetLimitPence ?? ""} onChange={(event) => updateContext({ budgetLimitPence: event.target.value ? Number(event.target.value) : null })}><option value="">No cap</option><option value="2000">£20</option><option value="3000">£30</option><option value="5000">£50</option><option value="10000">£100</option></select></label>
        <label>Drinks<select disabled={disabled} value={profile.context.zeroProof ? "zero-proof" : "any"} onChange={(event) => updateContext({ zeroProof: event.target.value === "zero-proof" })}><option value="any">Any drinks</option><option value="zero-proof">Prefer 0.0 options</option></select></label>
        <label>Voice<select disabled={disabled} value={profile.voicePreference} onChange={(event) => update({ ...profile, voicePreference: event.target.value as NightProfileInput["voicePreference"] })}><option value="off">Off</option><option value="tts">Read replies aloud</option><option value="ptt">Push to talk</option></select></label>
        <label>Briefings<select disabled={disabled} value={profile.briefingPreferences.muteAll ? "muted" : "on"} onChange={(event) => update({ ...profile, briefingPreferences: { ...profile.briefingPreferences, muteAll: event.target.value === "muted" } })}><option value="on">On</option><option value="muted">Muted</option></select></label>
      </div>
      {onSave ? <button className="accountHubNightProfileSave" type="button" disabled={disabled} onClick={onSave}>{saveLabel}</button> : <p className="accountHubNightProfileSaved" role="status">{saveLabel}</p>}
    </section>
  );
}

export function ReferralInviteCard({
  status,
  busy,
  link,
  onInvite,
}: {
  status: ReferralPrivateStatus | null;
  busy: boolean;
  link: string | null;
  onInvite: () => void;
}): React.JSX.Element {
  const qualified = status?.qualifiedCount ?? 0;
  const referralLabel = qualified === 1 ? "qualified referral" : "qualified referrals";
  return (
    <div className="accountHubReferral">
      <h3>Invite a mate</h3>
      <p>
        A referral counts after your mate signs up and logs their first accepted
        contribution.
      </p>
      {status ? (
        <p className="accountHubReferralProgress">
          {qualified} {referralLabel}.{" "}
          {status.nextMilestone
            ? `Next milestone: ${status.nextMilestone}.`
            : "All three milestones recorded."}
        </p>
      ) : null}
      <small>
        Rewards stay off until signed-in contributions and person-level account
        checks can stop self-referrals.
      </small>
      <button type="button" disabled={busy} onClick={onInvite}>
        {busy ? "Getting your link…" : "Invite a mate"}
      </button>
      {link ? (
        <label className="accountHubReferralLink">
          Your invite link
          <input type="url" readOnly value={link} />
        </label>
      ) : null}
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
  const [nightProfileDraft, setNightProfileDraft] = useState<NightProfileInput | null>(null);
  const [mergeDeferred, setMergeDeferred] = useState(false);
  const [message, setMessage] = useState("");
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsentDecision | null>(null);
  const [referralStatus, setReferralStatus] = useState<ReferralPrivateStatus | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralBusy, setReferralBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const decision = analyticsConsentDecision();
    void Promise.resolve().then(() => {
      if (!cancelled) setAnalyticsConsentState(decision);
    });
    const unsubscribe = subscribeAnalyticsConsent(() => {
      if (!cancelled) setAnalyticsConsentState(analyticsConsentDecision());
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function updateAnalyticsConsent(granted: boolean) {
    setAnalyticsConsent(granted);
    setAnalyticsConsentState(granted ? "granted" : "denied");
    setMessage(granted
      ? "Anonymous usage analytics enabled. No handles, messages, voice, or precise location are sent."
      : "Anonymous usage analytics disabled and the browser analytics ID was removed.");
  }

  const analyticsControls = (
    <div>
      <h3>Anonymous usage analytics</h3>
      <p>Help improve journeys with allow-listed product events. This is optional and can be withdrawn here.</p>
      <div className="accountHubActions">
        <button type="button" aria-pressed={analyticsConsent === "granted"} onClick={() => updateAnalyticsConsent(true)}>Allow</button>
        <button type="button" aria-pressed={analyticsConsent === "denied"} onClick={() => updateAnalyticsConsent(false)}>No thanks</button>
      </div>
    </div>
  );

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
    void Promise.allSettled([
      authedFetch("/api/social-connections", { signal: controller.signal }),
      authedFetch("/api/identity/handle/current", { signal: controller.signal }),
      authedFetch("/api/me/night-profile", { signal: controller.signal }),
      authedFetch("/api/referrals/status", { signal: controller.signal }),
    ]).then(async ([socialResult, identityResult, nightProfileResult, referralsResult]) => {
      if (controller.signal.aborted) return;
      const social = socialResult.status === "fulfilled" ? socialResult.value : null;
      const identity = identityResult.status === "fulfilled" ? identityResult.value : null;
      const nightProfile = nightProfileResult.status === "fulfilled"
        ? nightProfileResult.value
        : null;
      const referrals = referralsResult.status === "fulfilled"
        ? referralsResult.value
        : null;
      if (social?.ok) {
        const body = await social.json().catch(() => null) as {
          connections?: Connection[];
          providers?: SocialProviderAvailability;
        } | null;
        setConnections(body?.connections ?? []);
        setProviders(body?.providers ?? NO_SOCIAL_PROVIDERS);
      }
      if (identity?.ok) {
        const body = await identity.json().catch(() => null) as
          | { handle?: string | null }
          | null;
        const owned = body?.handle ?? null;
        setCurrentHandle(owned);
        if (owned) setHandle(owned);
      }
      if (nightProfile?.ok) {
        const body = await nightProfile.json().catch(() => null) as
          | { profile?: NightProfile | null }
          | null;
        const profile = body?.profile ?? null;
        setAccountNightProfile(profile);
        setNightProfileDraft(profile ? nightProfileInput(profile) : DEFAULT_NIGHT_PROFILE_INPUT);
        const mirrored = mirrorAccountNightProfileToDevice(profile);
        if (mirrored) setDeviceNightProfile(mirrored);
      } else {
        setMessage("Your account Night Profile could not be loaded.");
      }
      if (referrals?.ok) {
        const status = await referrals.json().catch(() => null) as
          | ReferralPrivateStatus
          | null;
        if (status) setReferralStatus(status);
      }
      if (!controller.signal.aborted) setNightProfileLoaded(true);
    });
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
    if (!currentHandle) {
      trackEvent("account_claimed", { source: "you" });
    }
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
        setNightProfileDraft(nightProfileInput(state.account));
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
    setNightProfileDraft(nightProfileInput(body.profile));
    writeDeviceNightProfile(nightProfileInput(body.profile));
    setDeviceNightProfile(nightProfileInput(body.profile));
    setMessage("Your device preferences are now on your account.");
  }

  function editDeviceNightProfile(profile: NightProfileInput) {
    if (!writeDeviceNightProfile(profile)) {
      setMessage("This browser could not save your Night Profile.");
      return;
    }
    setDeviceNightProfile(profile);
    setMessage("Night Profile saved on this device.");
  }

  async function saveAccountNightProfile() {
    if (!nightProfileDraft || !nightProfileLoaded) return;
    const response = await authedFetch("/api/me/night-profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: nightProfileDraft,
        expectedUpdatedAt: accountNightProfile?.updatedAt ?? null,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      profile?: NightProfile;
      error?: string;
      details?: { currentProfile?: NightProfile | null };
    };
    if (!response.ok || !body.profile) {
      if (response.status === 409 && body.details?.currentProfile) {
        setAccountNightProfile(body.details.currentProfile);
        setNightProfileDraft(nightProfileInput(body.details.currentProfile));
      }
      setMessage(body.error ?? "Your Night Profile could not be saved.");
      return;
    }
    const input = nightProfileInput(body.profile);
    setAccountNightProfile(body.profile);
    setNightProfileDraft(input);
    writeDeviceNightProfile(input);
    setDeviceNightProfile(input);
    setMessage("Night Profile saved to your account.");
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

  async function inviteMate() {
    if (referralBusy) return;
    setReferralBusy(true);
    try {
      const response = await authedFetch("/api/referrals/invite-link", {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !body.url) {
        setMessage(body.error ?? "Your invite link could not be made.");
        return;
      }
      setReferralLink(body.url);
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: "PUBMAXX",
            text: "Real pub prices from real people.",
            url: body.url,
          });
          setMessage("Invite link ready to share.");
          return;
        } catch {
          setMessage("Your invite link is below.");
          return;
        }
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body.url);
        setMessage("Invite link copied.");
      } else {
        setMessage("Your invite link is below.");
      }
    } catch {
      setMessage("Your invite link could not be made.");
    } finally {
      setReferralBusy(false);
    }
  }

  if (loading) return <section className="accountHub" aria-busy="true"><p>Loading your account…</p></section>;
  if (!user) return <section className="accountHub"><p className="profileSectionKicker">Your PUBMAXX</p><h2>Sign in to save your nights</h2><NightProfileControls profile={deviceNightProfile ?? DEFAULT_NIGHT_PROFILE_INPUT} saveLabel="Saved on this device" onChange={editDeviceNightProfile} /><div className="accountHubSignIn"><p>Sign in to claim a handle, connect profiles, and keep private Night Memories. Your device profile is only brought to an account after you review it.</p><SignInButton /></div><div className="accountHubGrid">{analyticsControls}</div>{message ? <p role="status" className="accountHubMessage">{message}</p> : null}</section>;

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
      <NightProfileControls
        profile={nightProfileDraft ?? DEFAULT_NIGHT_PROFILE_INPUT}
        disabled={!nightProfileLoaded}
        saveLabel={nightProfileLoaded ? "Save Night Profile" : "Loading Night Profile…"}
        onChange={setNightProfileDraft}
        onSave={() => void saveAccountNightProfile()}
      />
      <div className="accountHubGrid">
        <form onSubmit={claim}><h3>{currentHandle ? "Your @handle" : "Claim your @handle"}</h3><input value={handle} onChange={(event) => setHandle(event.target.value)} pattern="[A-Za-z0-9_]{3,30}" placeholder="night_owl" required /><button type="submit">{currentHandle ? "Rename handle" : "Claim handle"}</button>{currentHandle ? <small>Renames are limited to once every 30 days. Old links keep working.</small> : null}</form>
        <div><h3>Connected accounts</h3><SocialConnectionActions providers={providers} onConnect={(provider) => void connectOAuth(provider)} />{providers.instagram.manual ? <form onSubmit={connectInstagram}><input type="url" value={instagramUrl} onChange={(event) => setInstagramUrl(event.target.value)} placeholder="Personal Instagram URL" required /><button type="submit">Add personal link</button></form> : null}<small>{connections.length} connected</small></div>
        <ReferralInviteCard
          status={referralStatus}
          busy={referralBusy}
          link={referralLink}
          onInvite={() => void inviteMate()}
        />
        {analyticsControls}
      </div>
      <NightMemoryStudio key={user.id} userId={user.id} />
      {message ? <p role="status" className="accountHubMessage">{message}</p> : null}
    </section>
  );
}
