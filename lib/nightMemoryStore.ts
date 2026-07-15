import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  canEditNightStory,
  cleanNightMomentDraft,
  hasPublicationConsent,
  type MomentConsent,
  type MomentConsentStatus,
  type NightMemory,
  type NightMoment,
  type NightStory,
  type NightStoryPublicationProposal,
  type PublicNightStory,
  type StoryContributor,
  type StoryContributorRole,
} from "@/lib/nightMemory";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { profileStore } from "@/lib/profileStore";
import { cleanText } from "@/lib/textClean";

type PublishVisibility = "public" | "unlisted";
type ProposalWithToken = {
  proposal: NightStoryPublicationProposal;
  confirmationToken: string;
};

const memories = new Map<string, NightMemory>();
const moments = new Map<string, NightMoment>();
const stories = new Map<string, NightStory>();
const contributors = new Map<string, StoryContributor[]>();
const consents = new Map<string, MomentConsent[]>();
const proposals = new Map<string, NightStoryPublicationProposal & { tokenHash: string }>();

export function __resetNightMemoryStore(): void {
  memories.clear();
  moments.clear();
  stories.clear();
  contributors.clear();
  consents.clear();
  proposals.clear();
}

function now(): string {
  return new Date().toISOString();
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function memoryFromRow(row: Record<string, unknown>): NightMemory {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    planCompletionId: typeof row.plan_completion_id === "string" ? row.plan_completion_id : null,
    visibility: "private",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function momentFromRow(row: Record<string, unknown>): NightMoment {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    ownerId: String(row.owner_id),
    kind: row.kind as NightMoment["kind"],
    caption: String(row.caption ?? ""),
    pintDropId: typeof row.pint_drop_id === "string" ? row.pint_drop_id : null,
    venueId: typeof row.venue_id === "string" ? row.venue_id : null,
    mediaObjectKey: typeof row.media_object_key === "string" ? row.media_object_key : null,
    occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : null,
    visibility: "private",
    createdAt: String(row.created_at),
  };
}

function storyFromRow(row: Record<string, unknown>, publishedMomentIds: string[] = []): NightStory {
  return {
    id: String(row.id),
    memoryId: String(row.memory_id),
    hostEditorId: String(row.host_editor_id),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    status: row.status as NightStory["status"],
    visibility: row.visibility as NightStory["visibility"],
    legacyCrawlStoryId: typeof row.legacy_crawl_story_id === "string" ? row.legacy_crawl_story_id : null,
    publishedMomentIds,
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function contributorFromRow(row: Record<string, unknown>): StoryContributor {
  return {
    storyId: String(row.story_id),
    profileId: String(row.profile_id),
    role: row.role as StoryContributor["role"],
    status: row.status as StoryContributor["status"],
    joinedAt: typeof row.joined_at === "string" ? row.joined_at : null,
  };
}

function consentFromRow(row: Record<string, unknown>): MomentConsent {
  return {
    storyId: String(row.story_id),
    momentId: String(row.moment_id),
    ownerId: String(row.owner_id),
    status: row.status as MomentConsentStatus,
    decidedAt: typeof row.decided_at === "string" ? row.decided_at : null,
  };
}

export async function createNightMemory(
  ownerId: string,
  raw: unknown,
): Promise<NightMemory | null> {
  if (!ownerId || !raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const title = cleanText(input.title, 120);
  const planCompletionId = cleanText(input.planCompletionId, 80) || null;
  if (!title) return null;
  const timestamp = now();
  const memory: NightMemory = {
    id: randomUUID(),
    ownerId,
    title,
    planCompletionId,
    visibility: "private",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!isSupabaseConfigured()) {
    memories.set(memory.id, memory);
    return memory;
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_memories")
    .insert({
      id: memory.id,
      owner_id: ownerId,
      title,
      plan_completion_id: planCompletionId,
      visibility: "private",
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select("*")
    .single();
  return error || !data ? null : memoryFromRow(data as Record<string, unknown>);
}

export async function listNightMemories(ownerId: string): Promise<NightMemory[]> {
  if (!isSupabaseConfigured()) {
    return [...memories.values()]
      .filter((memory) => memory.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_memories")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  return error ? [] : (data ?? []).map((row) => memoryFromRow(row as Record<string, unknown>));
}

async function getMemory(memoryId: string): Promise<NightMemory | null> {
  if (!isSupabaseConfigured()) return memories.get(memoryId) ?? null;
  const { data, error } = await requireSupabaseAdmin()
    .from("night_memories")
    .select("*")
    .eq("id", memoryId)
    .maybeSingle();
  return error || !data ? null : memoryFromRow(data as Record<string, unknown>);
}

export async function addNightMoment(
  ownerId: string,
  memoryId: string,
  raw: unknown,
  options: { allowContributor?: boolean } = {},
): Promise<NightMoment | null> {
  const memory = await getMemory(memoryId);
  const draft = cleanNightMomentDraft(raw);
  if (!memory || !draft || (!options.allowContributor && memory.ownerId !== ownerId)) return null;
  const moment: NightMoment = {
    id: randomUUID(),
    memoryId,
    ownerId,
    ...draft,
    createdAt: now(),
  };
  if (!isSupabaseConfigured()) {
    moments.set(moment.id, moment);
    return moment;
  }
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moments")
    .insert({
      id: moment.id,
      memory_id: memoryId,
      owner_id: ownerId,
      kind: moment.kind,
      caption: moment.caption,
      pint_drop_id: moment.pintDropId,
      venue_id: moment.venueId,
      media_object_key: moment.mediaObjectKey,
      occurred_at: moment.occurredAt,
      visibility: "private",
      created_at: moment.createdAt,
    })
    .select("*")
    .single();
  return error || !data ? null : momentFromRow(data as Record<string, unknown>);
}

async function getMoment(momentId: string): Promise<NightMoment | null> {
  if (!isSupabaseConfigured()) return moments.get(momentId) ?? null;
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moments")
    .select("*")
    .eq("id", momentId)
    .maybeSingle();
  return error || !data ? null : momentFromRow(data as Record<string, unknown>);
}

export async function createNightStory(ownerId: string, raw: unknown): Promise<NightStory | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const memoryId = cleanText(input.memoryId, 80);
  const memory = await getMemory(memoryId);
  const title = cleanText(input.title, 120);
  if (!memory || memory.ownerId !== ownerId || !title) return null;
  const timestamp = now();
  const story: NightStory = {
    id: randomUUID(),
    memoryId,
    hostEditorId: ownerId,
    title,
    summary: cleanText(input.summary, 500),
    status: "draft",
    visibility: "private",
    legacyCrawlStoryId: cleanText(input.legacyCrawlStoryId, 80) || null,
    publishedMomentIds: [],
    publishedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const host: StoryContributor = {
    storyId: story.id,
    profileId: ownerId,
    role: "host",
    status: "accepted",
    joinedAt: timestamp,
  };
  if (!isSupabaseConfigured()) {
    stories.set(story.id, story);
    contributors.set(story.id, [host]);
    return story;
  }
  const admin = requireSupabaseAdmin();
  const { error } = await admin.from("night_stories").insert({
    id: story.id,
    memory_id: memoryId,
    host_editor_id: ownerId,
    title: story.title,
    summary: story.summary,
    status: "draft",
    visibility: "private",
    legacy_crawl_story_id: story.legacyCrawlStoryId,
    created_at: timestamp,
    updated_at: timestamp,
  });
  if (error) return null;
  const { error: hostError } = await admin.from("night_story_contributors").insert({
    story_id: story.id,
    profile_id: ownerId,
    role: "host",
    status: "accepted",
    joined_at: timestamp,
  });
  if (hostError) {
    await admin.from("night_stories").delete().eq("id", story.id);
    return null;
  }
  return story;
}

async function getContributors(storyId: string): Promise<StoryContributor[]> {
  if (!isSupabaseConfigured()) return contributors.get(storyId) ?? [];
  const { data, error } = await requireSupabaseAdmin()
    .from("night_story_contributors")
    .select("*")
    .eq("story_id", storyId);
  return error ? [] : (data ?? []).map((row) => contributorFromRow(row as Record<string, unknown>));
}

async function getConsents(storyId: string): Promise<MomentConsent[]> {
  if (!isSupabaseConfigured()) return consents.get(storyId) ?? [];
  const { data, error } = await requireSupabaseAdmin()
    .from("night_moment_consents")
    .select("*")
    .eq("story_id", storyId);
  return error ? [] : (data ?? []).map((row) => consentFromRow(row as Record<string, unknown>));
}

async function getStoryRaw(storyId: string): Promise<NightStory | null> {
  if (!isSupabaseConfigured()) return stories.get(storyId) ?? null;
  const admin = requireSupabaseAdmin();
  const [{ data, error }, { data: links }] = await Promise.all([
    admin.from("night_stories").select("*").eq("id", storyId).maybeSingle(),
    admin.from("night_story_moments").select("moment_id").eq("story_id", storyId),
  ]);
  if (error || !data) return null;
  return storyFromRow(
    data as Record<string, unknown>,
    (links ?? []).map((row) => String(row.moment_id)),
  );
}

export async function getNightStory(
  storyId: string,
  actorId: string | null,
): Promise<NightStory | PublicNightStory | null> {
  const story = await getStoryRaw(storyId);
  if (!story) return null;
  if (story.status === "published" && story.visibility !== "private") {
    const membership = actorId
      ? (await getContributors(storyId)).some(
          (item) => item.profileId === actorId && item.status === "accepted",
        )
      : false;
    if (membership) return story;
    const publicStory: PublicNightStory = {
      id: story.id,
      title: story.title,
      summary: story.summary,
      status: story.status,
      visibility: story.visibility,
      legacyCrawlStoryId: story.legacyCrawlStoryId,
      publishedMomentIds: story.publishedMomentIds,
      publishedAt: story.publishedAt,
      createdAt: story.createdAt,
      updatedAt: story.updatedAt,
    };
    return publicStory;
  }
  if (!actorId) return null;
  const membership = (await getContributors(storyId)).some(
    (item) => item.profileId === actorId && item.status === "accepted",
  );
  return membership ? story : null;
}

export async function upsertStoryContributor(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<StoryContributor | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const handle = cleanText(input.handle, 30).toLocaleLowerCase();
  const invitedProfile = handle ? await profileStore().getByHandle(handle) : null;
  const profileId = invitedProfile?.userId ?? "";
  const allowedRoles: StoryContributorRole[] = ["editor", "contributor"];
  const role = allowedRoles.includes(input.role as StoryContributorRole)
    ? (input.role as StoryContributorRole)
    : "contributor";
  const current = await getContributors(storyId);
  if (!profileId || !canEditNightStory(actorId, current)) return null;
  const contributor: StoryContributor = {
    storyId,
    profileId,
    role,
    status: "invited",
    joinedAt: null,
  };
  if (!isSupabaseConfigured()) {
    contributors.set(storyId, [...current.filter((item) => item.profileId !== profileId), contributor]);
    return contributor;
  }
  const { error } = await requireSupabaseAdmin().from("night_story_contributors").upsert({
    story_id: storyId,
    profile_id: profileId,
    role,
    status: "invited",
    joined_at: null,
  }, { onConflict: "story_id,profile_id" });
  return error ? null : contributor;
}

export async function acceptStoryContribution(actorId: string, storyId: string): Promise<StoryContributor | null> {
  const current = await getContributors(storyId);
  const invitation = current.find((item) => item.profileId === actorId && item.status === "invited");
  if (!invitation) return null;
  const accepted: StoryContributor = { ...invitation, status: "accepted", joinedAt: now() };
  if (!isSupabaseConfigured()) {
    contributors.set(storyId, current.map((item) => item.profileId === actorId ? accepted : item));
    return accepted;
  }
  const { error } = await requireSupabaseAdmin().from("night_story_contributors")
    .update({ status: "accepted", joined_at: accepted.joinedAt })
    .eq("story_id", storyId)
    .eq("profile_id", actorId)
    .eq("status", "invited");
  return error ? null : accepted;
}

/** Add a private Moment through an accepted Story collaboration. */
export async function addStoryMoment(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<NightMoment | null> {
  const [story, members] = await Promise.all([getStoryRaw(storyId), getContributors(storyId)]);
  const accepted = members.some(
    (member) => member.profileId === actorId && member.status === "accepted",
  );
  if (!story || !accepted) return null;
  return addNightMoment(actorId, story.memoryId, raw, { allowContributor: true });
}

export async function setMomentPublicationConsent(
  actorId: string,
  storyId: string,
  momentId: string,
  status: MomentConsentStatus,
): Promise<MomentConsent | null> {
  if (!(["approved", "withdrawn"] as MomentConsentStatus[]).includes(status)) return null;
  const [story, moment] = await Promise.all([getStoryRaw(storyId), getMoment(momentId)]);
  if (!story || !moment || moment.memoryId !== story.memoryId || moment.ownerId !== actorId) return null;
  const consent: MomentConsent = { storyId, momentId, ownerId: actorId, status, decidedAt: now() };
  if (!isSupabaseConfigured()) {
    const current = consents.get(storyId) ?? [];
    consents.set(storyId, [...current.filter((item) => item.momentId !== momentId), consent]);
    if (status === "withdrawn") {
      stories.set(storyId, { ...story, publishedMomentIds: story.publishedMomentIds.filter((id) => id !== momentId), updatedAt: now() });
    }
    return consent;
  }
  const admin = requireSupabaseAdmin();
  const { error } = await admin.from("night_moment_consents").upsert({
    story_id: storyId,
    moment_id: momentId,
    owner_id: actorId,
    status,
    decided_at: consent.decidedAt,
  }, { onConflict: "story_id,moment_id" });
  if (error) return null;
  if (status === "withdrawn") {
    await admin.from("night_story_moments").delete().eq("story_id", storyId).eq("moment_id", momentId);
  }
  return consent;
}

export async function proposeNightStoryPublication(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<ProposalWithToken | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const visibility: PublishVisibility | null = input.visibility === "public" || input.visibility === "unlisted"
    ? input.visibility
    : null;
  const momentIds = Array.isArray(input.momentIds)
    ? [...new Set(input.momentIds.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(0, 100)
    : [];
  const [story, members, storyConsents] = await Promise.all([
    getStoryRaw(storyId),
    getContributors(storyId),
    getConsents(storyId),
  ]);
  if (!story || !visibility || momentIds.length === 0 || !canEditNightStory(actorId, members)) return null;
  const selected = await Promise.all(momentIds.map(getMoment));
  if (selected.some((moment) => !moment || moment.memoryId !== story.memoryId)) return null;
  const canPublishAll = selected.every((moment) =>
    moment && (moment.ownerId === actorId || hasPublicationConsent(moment.ownerId, moment.id, storyConsents)),
  );
  if (!canPublishAll) return null;
  const confirmationToken = randomBytes(32).toString("hex");
  const proposal: NightStoryPublicationProposal = {
    id: randomUUID(),
    storyId,
    requestedBy: actorId,
    momentIds,
    visibility,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    confirmedAt: null,
  };
  const tokenHash = hashToken(confirmationToken);
  if (!isSupabaseConfigured()) {
    proposals.set(proposal.id, { ...proposal, tokenHash });
    return { proposal, confirmationToken };
  }
  const { error } = await requireSupabaseAdmin().from("night_story_publish_proposals").insert({
    id: proposal.id,
    story_id: storyId,
    requested_by: actorId,
    moment_ids: momentIds,
    visibility,
    token_hash: tokenHash,
    expires_at: proposal.expiresAt,
  });
  return error ? null : { proposal, confirmationToken };
}

export async function confirmNightStoryPublication(
  actorId: string,
  storyId: string,
  raw: unknown,
): Promise<NightStory | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const proposalId = cleanText(input.proposalId, 80);
  const confirmationToken = cleanText(input.confirmationToken, 128);
  if (!proposalId || !confirmationToken) return null;
  let proposal: (NightStoryPublicationProposal & { tokenHash: string }) | null = null;
  if (!isSupabaseConfigured()) {
    proposal = proposals.get(proposalId) ?? null;
  } else {
    const { data, error } = await requireSupabaseAdmin().from("night_story_publish_proposals")
      .select("*").eq("id", proposalId).maybeSingle();
    if (!error && data) {
      proposal = {
        id: String(data.id),
        storyId: String(data.story_id),
        requestedBy: String(data.requested_by),
        momentIds: Array.isArray(data.moment_ids) ? data.moment_ids.map(String) : [],
        visibility: data.visibility as PublishVisibility,
        expiresAt: String(data.expires_at),
        confirmedAt: typeof data.confirmed_at === "string" ? data.confirmed_at : null,
        tokenHash: String(data.token_hash),
      };
    }
  }
  if (
    !proposal || proposal.storyId !== storyId || proposal.requestedBy !== actorId ||
    proposal.confirmedAt || Date.parse(proposal.expiresAt) <= Date.now() ||
    !tokenMatches(confirmationToken, proposal.tokenHash)
  ) return null;

  // Re-evaluate consent at confirmation time so a withdrawal after proposal wins.
  const refreshed = await proposeEligibility(actorId, storyId, proposal.momentIds);
  if (!refreshed) return null;
  const publishedAt = now();
  if (!isSupabaseConfigured()) {
    const story = stories.get(storyId);
    if (!story) return null;
    const published: NightStory = {
      ...story,
      status: "published",
      visibility: proposal.visibility,
      publishedMomentIds: proposal.momentIds,
      publishedAt,
      updatedAt: publishedAt,
    };
    stories.set(storyId, published);
    proposals.set(proposal.id, { ...proposal, confirmedAt: publishedAt });
    return published;
  }
  const { data, error } = await requireSupabaseAdmin().rpc("confirm_night_story_publication", {
    p_proposal_id: proposal.id,
    p_story_id: storyId,
    p_requested_by: actorId,
    p_token_hash: proposal.tokenHash,
  });
  if (error || data !== true) return null;
  return getStoryRaw(storyId);
}

async function proposeEligibility(actorId: string, storyId: string, momentIds: string[]): Promise<boolean> {
  const [story, members, storyConsents] = await Promise.all([
    getStoryRaw(storyId),
    getContributors(storyId),
    getConsents(storyId),
  ]);
  if (!story || !canEditNightStory(actorId, members)) return false;
  const selected = await Promise.all(momentIds.map(getMoment));
  return selected.every((moment) =>
    Boolean(moment && moment.memoryId === story.memoryId &&
      (moment.ownerId === actorId || hasPublicationConsent(moment.ownerId, moment.id, storyConsents))),
  );
}
