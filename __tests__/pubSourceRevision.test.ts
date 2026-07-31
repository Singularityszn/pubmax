import { describe, expect, it, vi } from "vitest";

import { createPubsSourceRevisionCoordinator } from "@/components/map/canvas/pubSourceRevision";

type EventName = "sourcedata" | "sourcedataabort" | "error" | "render";
type Listener = (event: {
  isSourceLoaded?: boolean;
  sourceId?: string;
  sourceDataType?: string;
}) => void;

function data(bucket: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { bucket },
        geometry: { type: "Point", coordinates: [-0.1, 51.5] },
      },
    ],
  };
}

function setup(ready = true) {
  const listeners = new Map<EventName, Set<Listener>>();
  const source = { setData: vi.fn(() => Promise.resolve()) };
  const publish = vi.fn();
  const invalidatePaint = vi.fn();
  let structureReady = ready;
  const map = {
    getSource: vi.fn<() => typeof source | undefined>(() => source),
    triggerRepaint: vi.fn(),
  };
  const subscribe = (type: EventName, listener: Listener) => {
    const existing = listeners.get(type) ?? new Set<Listener>();
    existing.add(listener);
    listeners.set(type, existing);
    return () => {
      listeners.get(type)?.delete(listener);
    };
  };
  const emit = (
    type: EventName,
    event: {
      isSourceLoaded?: boolean;
      sourceId?: string;
      sourceDataType?: string;
    } = {},
  ) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  };
  const coordinator = createPubsSourceRevisionCoordinator({
    getSource: map.getSource,
    isStyleStructureReady: () => structureReady,
    invalidatePaint,
    publish,
    subscribeRender: (listener) => subscribe("render", listener),
    subscribeSourceData: (listener) => subscribe("sourcedata", listener),
    subscribeSourceFailure: (listener) => {
      const unsubscribeError = subscribe("error", listener);
      const unsubscribeAbort = subscribe("sourcedataabort", listener);
      return () => {
        unsubscribeError();
        unsubscribeAbort();
      };
    },
    triggerRepaint: map.triggerRepaint,
  });

  return {
    coordinator,
    emit,
    invalidatePaint,
    map,
    publish,
    setStructureReady: (next: boolean) => {
      structureReady = next;
    },
    source,
  };
}

describe("createPubsSourceRevisionCoordinator", () => {
  it("publishes only after exact pubs content reaches a later render", async () => {
    const {
      coordinator,
      emit,
      invalidatePaint,
      map,
      publish,
      source,
    } = setup();
    const revision = data(3);

    coordinator.request(revision);
    await Promise.resolve();

    expect(source.setData).toHaveBeenCalledWith(revision);
    expect(invalidatePaint).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", { sourceId: "uk-base", sourceDataType: "content" });
    emit("render");
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", { sourceId: "pubs", sourceDataType: "metadata" });
    emit("render");
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    emit("render");
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", {
      isSourceLoaded: true,
      sourceId: "pubs",
      sourceDataType: "idle",
    });
    expect(map.triggerRepaint).toHaveBeenCalledOnce();
    emit("render");
    expect(publish).toHaveBeenCalledWith(revision);
    expect(coordinator.getCommittedData()).toBe(revision);
  });

  it("uses structural readiness and source presence for queued revisions", () => {
    const { coordinator, emit, map, publish, setStructureReady, source } =
      setup();
    const initial = data(0);
    const revision = data(3);

    coordinator.request(initial);
    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("sourcedata", { isSourceLoaded: true, sourceId: "pubs" });
    emit("render");
    setStructureReady(false);
    coordinator.request(revision);
    expect(source.setData).toHaveBeenCalledTimes(1);

    setStructureReady(true);
    map.getSource.mockReturnValueOnce(undefined);
    coordinator.flush();
    expect(source.setData).toHaveBeenCalledTimes(1);

    coordinator.flush();
    expect(source.setData).toHaveBeenCalledWith(revision);
    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("sourcedata", { isSourceLoaded: true, sourceId: "pubs" });
    emit("render");
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(revision);
  });

  it("does not publish a revision whose pubs source reports an error", () => {
    const { coordinator, emit, publish } = setup();

    coordinator.request(data(1));
    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("error", { sourceId: "pubs" });
    emit("render");

    expect(publish).not.toHaveBeenCalled();
    expect(coordinator.getCommittedData()).toBeNull();
  });

  it("keeps story-band reads on committed data while a newer revision waits", () => {
    const { coordinator, emit, publish, source } = setup();
    const settled = data(0);
    const pending = data(3);

    coordinator.request(settled);
    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("sourcedata", { isSourceLoaded: true, sourceId: "pubs" });
    emit("render");
    coordinator.request(pending);

    expect(coordinator.getCommittedData()).toBe(settled);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(source.setData).toHaveBeenLastCalledWith(pending);
  });

  it("skips a superseded revision and tags the next content event to latest data", () => {
    const { coordinator, emit, publish, source } = setup();
    const stale = data(1);
    const latest = data(3);

    coordinator.request(stale);
    coordinator.request(latest);
    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });

    expect(source.setData).toHaveBeenCalledTimes(2);
    expect(source.setData).toHaveBeenLastCalledWith(latest);
    emit("render");
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", {
      isSourceLoaded: false,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("sourcedata", { isSourceLoaded: true, sourceId: "pubs" });
    emit("render");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(latest);
  });
});
