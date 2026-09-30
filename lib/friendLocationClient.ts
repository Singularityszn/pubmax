import { coarsenViewerPoint, coarsenedViewerAccuracy } from "@/lib/geo";
import { FRIEND_LOCATION_FRESH_MS, FRIEND_LOCATION_POLL_MS, type FriendLocationRead, type FriendLocationSession, type SharedFriendLocation } from "@/lib/friendLocation";

export type FriendLocationClientState = {
  status: "loading" | "ready" | "starting" | "start-unconfirmed" | "sharing" | "paused" | "revoking" | "revoke-error" | "error";
  message: string;
  own: FriendLocationSession | null;
  mutuals: FriendLocationRead["mutuals"];
  friends: SharedFriendLocation[];
  generation: number;
};
export type FriendLocationRequest = (method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, signal?: AbortSignal) => Promise<FriendLocationRead>;
const initial: FriendLocationClientState = { status: "loading", message: "Loading mates…", own: null, mutuals: [], friends: [], generation: 0 };
export class FriendLocationClient {
  private state = initial;
  private listeners = new Set<() => void>();
  private watch: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private epoch = 0;
  private readSequence = 0;
  private stopSequence = 0;
  private updateAbort: AbortController | null = null;
  private visible = false;
  private disposed = false;
  private resumeAuthorized = false;
  private startAwaitingAuthority = false;
  private pendingStartGeneration: number | null = null;
  private pendingRevokeGeneration: number | null = null;
  private updatePending = false;
  private lastUpdate = 0;
  constructor(private request: FriendLocationRequest, private geo: Geolocation | undefined, private permission: () => Promise<PermissionState> = async () => "granted") {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<FriendLocationClientState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    if (patch.friends !== undefined) this.schedulePointExpiry();
    this.listeners.forEach((listener) => listener());
  }
  private schedulePointExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.state.friends.length) return;
    const deadline = Math.min(...this.state.friends.map((friend) => Math.min(Date.parse(friend.expiresAt), Date.parse(friend.updatedAt) + FRIEND_LOCATION_FRESH_MS)));
    this.expiryTimer = setTimeout(() => {
      const now = Date.now();
      this.publish({ friends: this.state.friends.filter((friend) => Date.parse(friend.expiresAt) > now && Date.parse(friend.updatedAt) + FRIEND_LOCATION_FRESH_MS > now) });
    }, Math.max(0, deadline - Date.now()));
  }
  private stopWatch() {
    if (this.watch !== null) this.geo?.clearWatch(this.watch);
    this.watch = null;
  }
  private cancel() {
    this.epoch++;
    this.readSequence++;
    this.updateAbort?.abort();
    this.abort?.abort();
    this.abort = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.stopWatch();
  }
  setVisible(visible: boolean) {
    this.disposed = false;
    this.visible = visible;
    this.cancel();
    if (this.startAwaitingAuthority) this.publish({ status: "start-unconfirmed", message: "Sharing start is unconfirmed. Updates are stopped here. Check locations again." });
    if (!visible) {
      const pending = ["revoking", "revoke-error", "start-unconfirmed"].includes(this.state.status);
      this.publish({ friends: [], status: pending ? this.state.status : "paused", message: pending ? this.state.message : "Updates paused while this page is hidden." });
      return;
    }
    void this.refresh();
  }
  dispose() { this.stopSequence++; this.resumeAuthorized = false; this.startAwaitingAuthority = false; this.pendingStartGeneration = null; this.pendingRevokeGeneration = null; this.cancel(); this.disposed = true; this.state = initial; this.listeners.clear(); }
  private mergeOwnRevision(own: FriendLocationSession | null): FriendLocationSession | null {
    const prior = this.state.own;
    return own && prior?.sessionId === own.sessionId && prior.revision > own.revision ? prior : own;
  }
  private currentRead(epoch: number, sequence: number) {
    return epoch === this.epoch && sequence === this.readSequence && this.visible && !this.disposed;
  }
  async refresh() {
    if (!this.visible || this.disposed) return;
    const epoch = this.epoch;
    const readSequence = ++this.readSequence;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    const controller = new AbortController();
    this.abort = controller;
    try {
      const data = this.startAwaitingAuthority || this.pendingRevokeGeneration !== null
        ? await this.request("POST", { action: "reconcile", expectedGeneration: this.pendingRevokeGeneration ?? this.pendingStartGeneration }, controller.signal)
        : await this.request("GET", undefined, controller.signal);
      if (!this.currentRead(epoch, readSequence)) return;
      if (data.generation < this.state.generation) {
        this.timer = setTimeout(() => void this.refresh(), FRIEND_LOCATION_POLL_MS);
        return;
      }
      this.startAwaitingAuthority = false;
      this.pendingStartGeneration = null;
      this.pendingRevokeGeneration = null;
      const now = Date.now();
      const friends = data.friends.filter((friend) => Date.parse(friend.expiresAt) > now && Date.parse(friend.updatedAt) + FRIEND_LOCATION_FRESH_MS > now);
      const prior = this.state.own;
      const own = this.mergeOwnRevision(data.own);
      const stopping = Boolean(own) && ["revoking", "revoke-error"].includes(this.state.status);
      const replaced = Boolean(prior && own && prior.sessionId !== own.sessionId);
      if (!own || replaced) { this.resumeAuthorized = false; this.updateAbort?.abort(); this.stopWatch(); }
      this.publish({ generation: data.generation, own, mutuals: data.mutuals, friends, ...(stopping ? {} : {
        status: own ? this.resumeAuthorized ? "sharing" : "paused" : "ready",
        message: replaced ? "Sharing changed on another device. Updates are paused here." : own ? this.resumeAuthorized ? "Sharing with selected mates." : "Share is active. Updates are paused on this page." : "Choose who can see you.",
      }) });
      if (own && this.resumeAuthorized && !stopping) {
        const permission = await this.permission();
        if (!this.currentRead(epoch, readSequence)) return;
        if (permission === "granted") {
          this.startWatch();
          this.geo?.getCurrentPosition((position) => { if (epoch === this.epoch) void this.update(position); }, () => {
            if (epoch !== this.epoch) return;
            this.stopWatch(); this.resumeAuthorized = false;
            this.publish({ status: "error", message: "Location updates stopped. Stop sharing, then start again." });
          }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
        } else {
          this.stopWatch(); this.resumeAuthorized = false;
          this.publish({ status: "paused", message: "Location permission changed. Stop sharing, then start again." });
        }
      }
      this.timer = setTimeout(() => void this.refresh(), FRIEND_LOCATION_POLL_MS);
    } catch {
      if (!this.currentRead(epoch, readSequence)) return;
      this.stopWatch();
      this.publish({ friends: [], ...(["revoke-error", "start-unconfirmed"].includes(this.state.status) ? {} : { status: "error", message: "Locations could not be checked. Try again." }) });
      this.timer = setTimeout(() => void this.refresh(), FRIEND_LOCATION_POLL_MS * 2);
    }
  }
  async start(recipients: string[]) {
    if (!this.visible || this.disposed || this.startAwaitingAuthority || ["starting", "start-unconfirmed", "revoking", "revoke-error"].includes(this.state.status)) return;
    if (!this.geo) { this.publish({ status: "error", message: "Location is unavailable in this browser." }); return; }
    this.cancel();
    this.resumeAuthorized = false;
    const epoch = this.epoch;
    let submitted = false;
    this.publish({ status: "starting", message: "Waiting for location permission…" });
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => this.geo!.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }));
      if (epoch !== this.epoch || !this.visible || this.disposed) return;
      this.abort = new AbortController();
      submitted = true;
      this.startAwaitingAuthority = true;
      this.pendingStartGeneration = this.state.generation;
      const data = await this.request("POST", { recipients, ...this.point(position), expectedGeneration: this.pendingStartGeneration }, this.abort.signal);
      if (epoch !== this.epoch || !this.visible || this.disposed) return;
      if (data.generation < this.state.generation) return;
      this.startAwaitingAuthority = false;
      this.pendingStartGeneration = null;
      this.resumeAuthorized = true;
      this.publish({ generation: data.generation, own: data.own, status: "sharing", message: "Sharing with selected mates." });
      this.startWatch();
      void this.refresh();
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      if (submitted) {
        this.abort = null;
        this.publish({ status: "start-unconfirmed", message: "Sharing start is unconfirmed. Updates are stopped here. Check locations again." });
        void this.refresh();
        return;
      }
      const denied = typeof error === "object" && error !== null && "code" in error && error.code === 1;
      this.publish({ status: "error", message: denied ? "Location permission denied. No location was shared." : "Sharing could not start. Try again." });
    }
  }
  private point(position: GeolocationPosition) {
    const point = coarsenViewerPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
    return { latitude: point.lat, longitude: point.lng, accuracy: coarsenedViewerAccuracy({ lat: position.coords.latitude, lng: position.coords.longitude }, point, position.coords.accuracy) };
  }
  private startWatch() {
    if (this.watch !== null || !this.geo || !this.visible || !this.state.own || !this.resumeAuthorized) return;
    const epoch = this.epoch;
    this.watch = this.geo.watchPosition((position) => { if (epoch === this.epoch) void this.update(position); }, () => {
      if (epoch !== this.epoch) return;
      this.stopWatch();
      this.resumeAuthorized = false;
      this.publish({ status: "error", message: "Location updates stopped. Stop sharing, then start again." });
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  }
  private async update(position: GeolocationPosition) {
    const own = this.state.own;
    if (!own || !this.visible || this.disposed || this.updatePending || !this.resumeAuthorized || Date.now() - this.lastUpdate < FRIEND_LOCATION_POLL_MS) return;
    if (Date.parse(own.expiresAt) <= Date.now()) { this.stopWatch(); this.publish({ own: null, status: "ready", message: "Sharing ended." }); return; }
    this.updatePending = true;
    this.lastUpdate = Date.now();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.updateAbort = controller;
    try {
      const result = await this.request("PATCH", { sessionId: own.sessionId, revision: own.revision, ...this.point(position) }, controller.signal);
      if (epoch === this.epoch && !this.disposed && this.state.own?.sessionId === own.sessionId && result.generation >= this.state.generation) this.publish({ generation: result.generation, own: this.mergeOwnRevision(result.own) });
    } catch {
      if (epoch === this.epoch && !this.disposed) {
        this.stopWatch(); this.resumeAuthorized = false;
        this.publish({ friends: [], status: "error", message: "Location updates stopped. Stop sharing, then start again." });
      }
    } finally { this.updatePending = false; if (this.updateAbort === controller) this.updateAbort = null; }
  }
  async stop() {
    const own = this.state.own;
    if (!own || this.disposed) return;
    this.resumeAuthorized = false;
    this.cancel();
    const stopSequence = ++this.stopSequence;
    this.pendingRevokeGeneration = this.state.generation;
    this.publish({ status: "revoking", message: "Stopping sharing. Waiting for confirmation…", friends: [] });
    try {
      let current = own;
      let generation = this.state.generation;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await this.request("DELETE", { sessionId: current.sessionId, revision: current.revision });
          generation = result.generation;
          break;
        }
        catch (error) {
          if (!(error instanceof Error) || error.message !== "conflict" || attempt === 2) throw error;
          let read = await this.request("GET");
          if (stopSequence !== this.stopSequence || this.disposed) return;
          if (read.generation < this.state.generation) continue;
          if (!read.own) read = await this.request("POST", { action: "reconcile", expectedGeneration: read.generation });
          if (stopSequence !== this.stopSequence || this.disposed) return;
          if (read.generation < this.state.generation) continue;
          generation = read.generation;
          if (!read.own) break;
          if (read.own.sessionId !== own.sessionId) {
            if (stopSequence === this.stopSequence && !this.disposed) {
              this.pendingRevokeGeneration = null;
              this.publish({ generation, own: read.own, status: "error", message: "Sharing changed on another device. Stop the current share if you want sharing to end." });
            }
            return;
          }
          current = read.own;
        }
      }
      if (stopSequence !== this.stopSequence || this.disposed) return;
      if (generation < this.state.generation) { void this.refresh(); return; }
      this.pendingRevokeGeneration = null;
      this.publish({ generation, own: null, status: "ready", message: "Sharing stopped." });
      void this.refresh();
    } catch {
      if (stopSequence !== this.stopSequence || this.disposed || !this.state.own) return;
      this.publish({ status: "revoke-error", message: "Updates stopped here. Server revoke is unconfirmed. Retry Stop sharing." });
    }
  }
}
