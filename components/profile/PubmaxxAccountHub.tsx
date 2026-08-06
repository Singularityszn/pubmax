"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { authedFetch } from "@/lib/authedFetch";
import { emitIdentityHandleChanged } from "@/lib/identityClient";
import PrivateIdentityEditor from "@/components/identity/PrivateIdentityEditor";
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
import {
  confirmedPlanRecapClaim,
  planRecapClaimMergeState,
  type PlanRecapClaimChoice,
  type PlanRecapClaimMergeState,
} from "@/lib/planRecapClaim";
import {
  listPendingPlanRecaps,
  resolvePendingPlanRecap,
  subscribeAnyPendingPlanRecap,
  type PendingPlanRecap,
} from "@/lib/planRecap";
import {
  PLAN_HTTP_ONLY_SESSION,
  restorePlanCapability,
} from "@/lib/planSessionCapability";
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
        <label>Drinks<select disabled={disabled} value={profile.context.zeroProof ? "zero-proof" : "any"} onChange={(event) => updateContext({ zeroProof: event.target.value === "zero-proof" })}><option value="any">Any drinks</option><option value="zero-proof">Prefer alcohol-free</option></select></label>
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
        Rewards stay off while we add checks to stop people referring
        themselves.
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

function AccountHandleEditor({
  auth,
}: {
  auth: AccountAuthSnapshot;
}): React.JSX.Element {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [currentHandle, setCurrentHandle] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void accountBoundFetch(
      auth,
      "/api/identity/handle/current",
      { signal: controller.signal },
    ).then(async (response) => {
      const body = await response.json().catch(() => null) as
        | { handle?: string | null; error?: string }
        | null;
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setMessage(body?.error ?? "Your handle could not be loaded.");
        return;
      }
      const owned = body?.handle ?? null;
      setCurrentHandle(owned);
      setHandle(owned ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) {
        setMessage("Your handle could not be loaded.");
      }
    });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [auth]);

  async function claim(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await accountBoundFetch(
        auth,
        currentHandle
          ? "/api/identity/handle/rename"
          : "/api/identity/handle/claim",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle }),
        },
      );
      const body = await response.json().catch(() => ({})) as {
        handle?: string;
        error?: string;
      };
      if (!active.current) return;
      if (!response.ok || !body.handle) {
        setMessage(body.error ?? "That handle is unavailable.");
        return;
      }
      try {
        localStorage.setItem("pubmax_handle", body.handle);
      } catch {}
      emitIdentityHandleChanged({ ownerId: auth.userId, handle: body.handle });
      if (!currentHandle) {
        trackEvent("account_claimed", { source: "you" });
      }
      router.push(`/u/${encodeURIComponent(body.handle)}`);
    } catch {
      if (active.current) setMessage("That handle could not be saved.");
    }
  }

  return (
    <form onSubmit={claim}>
      <h3>{currentHandle ? "Your @handle" : "Claim your @handle"}</h3>
      <input
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        pattern="[A-Za-z0-9_]{3,30}"
        placeholder="night_owl"
        required
      />
      <button type="submit">
        {currentHandle ? "Rename handle" : "Claim handle"}
      </button>
      {currentHandle ? (
        <small>Renames are limited to once every 30 days. Old links keep working.</small>
      ) : null}
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

export default function PubmaxxAccountHub() {
  const { user, loading, session } = useAuth();
  const accountAuth = useMemo(
    () => captureAccountAuth(user?.id ?? null, session),
    [session, user?.id],
  );
  const [instagramUrl, setInstagramUrl] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<SocialProviderAvailability>(NO_SOCIAL_PROVIDERS);
  const [accountNightProfile, setAccountNightProfile] = useState<NightProfile | null>(null);
  const [nightProfileLoaded, setNightProfileLoaded] = useState(false);
  const [deviceNightProfile, setDeviceNightProfile] = useState<NightProfileInput | null>(null);
  const [nightProfileDraft, setNightProfileDraft] = useState<NightProfileInput | null>(null);
  const [mergeDeferred, setMergeDeferred] = useState(false);
  const [devicePlanRecaps, setDevicePlanRecaps] = useState<PendingPlanRecap[]>([]);
  const [memoryCompletionIds, setMemoryCompletionIds] = useState<string[]>([]);
  const [planRecapMergeLoaded, setPlanRecapMergeLoaded] = useState(false);
  const [planRecapMergeDeferred, setPlanRecapMergeDeferred] = useState(false);
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
      ? "Usage analytics enabled. A persistent device ID and standard browser details are sent, but no handles, messages, voice, or precise location."
      : "Usage analytics disabled and the persistent browser analytics ID was removed.");
  }

  const analyticsControls = (
    <div id="analytics-settings">
      <h3>Optional usage analytics</h3>
      <p>Help improve journeys with a persistent device ID, standard browser details and allow-listed product events. This is optional and can be withdrawn here.</p>
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
        setPlanRecapMergeLoaded(false);
        setPlanRecapMergeDeferred(false);
        setMemoryCompletionIds([]);
      }
    });
    void Promise.allSettled([
      authedFetch("/api/social-connections", { signal: controller.signal }),
      authedFetch("/api/me/night-profile", { signal: controller.signal }),
      authedFetch("/api/referrals/status", { signal: controller.signal }),
      authedFetch("/api/me/pending-plan-recaps", { signal: controller.signal }),
    ]).then(async ([socialResult, nightProfileResult, referralsResult, pendingRecapResult]) => {
      if (controller.signal.aborted) return;
      const social = socialResult.status === "fulfilled" ? socialResult.value : null;
      const nightProfile = nightProfileResult.status === "fulfilled"
        ? nightProfileResult.value
        : null;
      const referrals = referralsResult.status === "fulfilled"
        ? referralsResult.value
        : null;
      const pendingRecaps = pendingRecapResult.status === "fulfilled"
        ? pendingRecapResult.value
        : null;
      if (social?.ok) {
        const body = await social.json().catch(() => null) as {
          connections?: Connection[];
          providers?: SocialProviderAvailability;
        } | null;
        setConnections(body?.connections ?? []);
        setProviders(body?.providers ?? NO_SOCIAL_PROVIDERS);
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
      if (pendingRecaps?.ok) {
        const body = await pendingRecaps.json().catch(() => null) as {
          memoryCompletionIds?: string[];
        } | null;
        setMemoryCompletionIds(body?.memoryCompletionIds ?? []);
      }
      if (!controller.signal.aborted) {
        setNightProfileLoaded(true);
        setPlanRecapMergeLoaded(true);
      }
    });
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    const refresh = () => setDeviceNightProfile(readDeviceNightProfile());
    queueMicrotask(refresh);
    return subscribeDeviceNightProfile(refresh);
  }, [user]);

  useEffect(() => {
    const refresh = () => setDevicePlanRecaps(listPendingPlanRecaps());
    queueMicrotask(refresh);
    return subscribeAnyPendingPlanRecap(refresh);
  }, [user]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const provider = query.get("socialConnection");
    if (query.get("status") === "connected" && (provider === "x" || provider === "instagram" || provider === "tiktok")) {
      trackEvent("social_account_connected", { provider, connectionType: "oauth" });
    }
  }, []);

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

  async function confirmPlanRecapClaim(
    state: Exclude<PlanRecapClaimMergeState, { kind: "none" }>,
    choice: PlanRecapClaimChoice,
  ) {
    const confirmed = confirmedPlanRecapClaim(state, choice);
    if (!confirmed.writesAccount) {
      setPlanRecapMergeDeferred(true);
      setMessage("Your private Memories were left unchanged. The recap stays on this device.");
      return;
    }
    const items: Array<{ recap: PendingPlanRecap; memberToken: string }> = [];
    for (const recap of confirmed.recaps) {
      let memberToken = "";
      try {
        const capability = await restorePlanCapability(recap.planId);
        if (capability?.token) memberToken = capability.token;
      } catch {
        memberToken = "";
      }
      if (!memberToken) {
        setMessage(
          "Open the Plan in this browser before bringing the recap. Your local draft is safe.",
        );
        return;
      }
      items.push({
        recap,
        memberToken: memberToken === PLAN_HTTP_ONLY_SESSION ? PLAN_HTTP_ONLY_SESSION : memberToken,
      });
    }
    const response = await authedFetch("/api/me/pending-plan-recaps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim", choice: "bring-device", items }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      memories?: Array<{ memory?: { id: string; planCompletionId?: string | null } }>;
      error?: string;
    };
    if (!response.ok) {
      setMessage(body.error ?? "Your private recap could not be brought onto your account.");
      return;
    }
    const nextIds = new Set(memoryCompletionIds);
    for (const entry of body.memories ?? []) {
      const completionId = entry.memory?.planCompletionId;
      if (completionId) nextIds.add(completionId);
    }
    for (const recap of confirmed.recaps) {
      resolvePendingPlanRecap(recap, "saved");
    }
    setMemoryCompletionIds([...nextIds]);
    setDevicePlanRecaps(listPendingPlanRecaps());
    setMessage(
      (body.memories?.length ?? 0) > 1
        ? "Your device recaps are now private Memories. Nothing was published."
        : "Your device recap is now a private Memory. Nothing was published.",
    );
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
            text: "Listed pub prices name and link their publisher when recorded and say when none is recorded.",
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

  const planRecapMergeState = planRecapMergeDeferred || !planRecapMergeLoaded
    ? ({ kind: "none" } as const)
    : planRecapClaimMergeState(devicePlanRecaps, memoryCompletionIds);

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
      {planRecapMergeState.kind !== "none" ? (
        <div className="accountHubMerge" role="group" aria-labelledby="plan-recap-merge-title">
          <h3 id="plan-recap-merge-title">Bring tonight&rsquo;s private recap?</h3>
          <p>
            {planRecapMergeState.recaps.length === 1
              ? "This device has a finished-night recap that is not on your account yet. Bringing it saves one private Memory. Nothing is published."
              : `This device has ${planRecapMergeState.recaps.length} finished-night recaps that are not on your account yet. Bringing them saves private Memories. Nothing is published.`}
          </p>
          <div className="accountHubActions">
            <button type="button" onClick={() => void confirmPlanRecapClaim(planRecapMergeState, "bring-device")}>
              Bring this device
            </button>
            <button type="button" onClick={() => void confirmPlanRecapClaim(planRecapMergeState, "keep-device")}>
              Keep only on this device
            </button>
          </div>
        </div>
      ) : null}
      <NightProfileControls
        profile={nightProfileDraft ?? DEFAULT_NIGHT_PROFILE_INPUT}
        disabled={!nightProfileLoaded}
        saveLabel={nightProfileLoaded ? "Save Night Profile" : "Loading Night Profile…"}
        onChange={setNightProfileDraft}
        onSave={() => void saveAccountNightProfile()}
      />
      <div className="accountHubGrid">
        {accountAuth ? (
          <AccountHandleEditor key={accountAuth.userId} auth={accountAuth} />
        ) : (
          <div>
            <h3>Your @handle</h3>
            <p>Sign in again to change your handle.</p>
            <SignInButton />
          </div>
        )}
        <PrivateIdentityEditor />
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
