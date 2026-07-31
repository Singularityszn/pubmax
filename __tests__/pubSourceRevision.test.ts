import { describe, expect, it, vi } from "vitest";

import {
  createPubsSourceRevisionCoordinator,
  PUBS_SOURCE_REVISION_PROPERTY,
} from "@/components/map/canvas/pubSourceRevision";

type EventName = "sourcedata" | "sourcedataabort" | "error" | "render";
type SourceEvent = {
  isSourceLoaded?: boolean;
  sourceId?: string;
  sourceDataType?: string;
};
type Listener = (event: SourceEvent) => void;

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
  const source = {
    loaded: vi.fn(() => false),
    setData: vi.fn(() => Promise.resolve()),
  };
  const beginPaintRevision = vi.fn();
  const publish = vi.fn();
  let structureReady = ready;
  const map = {
    getSource: vi.fn(() => source),
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
  const emit = (type: EventName, event: SourceEvent = {}) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  };
  const coordinator = createPubsSourceRevisionCoordinator({
    beginPaintRevision,
    getSource: map.getSource,
    isStyleStructureReady: () => structureReady,
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
    beginPaintRevision,
    coordinator,
    emit,
    map,
    publish,
    setStructureReady: (next: boolean) => {
      structureReady = next;
    },
    source,
  };
}

async function settlePubsSource(
  emit: ReturnType<typeof setup>["emit"],
): Promise<void> {
  await Promise.resolve();
  emit("sourcedata", {
    isSourceLoaded: false,
    sourceId: "pubs",
    sourceDataType: "content",
  });
  emit("sourcedata", {
    isSourceLoaded: true,
    sourceId: "pubs",
    sourceDataType: "idle",
  });
}

describe("createPubsSourceRevisionCoordinator", () => {
  it("publishes exact tagged source data only after settlement and a later render", async () => {
    const {
      beginPaintRevision,
      coordinator,
      emit,
      map,
      publish,
      source,
    } = setup();
    const revision = data(3);

    coordinator.request(revision);
    await Promise.resolve();

    expect(beginPaintRevision).toHaveBeenCalledWith(1);
    expect(source.setData).toHaveBeenCalledWith({
      type: "FeatureCollection",
      features: [
        expect.objectContaining({
          properties: {
            bucket: 3,
            [PUBS_SOURCE_REVISION_PROPERTY]: 1,
          },
        }),
      ],
    });
    expect(revision.features[0].properties).toEqual({ bucket: 3 });
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
    emit("render");
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", {
      isSourceLoaded: true,
      sourceId: "pubs",
      sourceDataType: "idle",
    });
    expect(map.triggerRepaint).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();

    emit("render");
    expect(publish).toHaveBeenCalledWith(revision, 1);
    expect(coordinator.getCommittedData()).toBe(revision);
  });

  it("uses structural readiness and source presence for queued revisions", async () => {
    const { coordinator, emit, map, publish, setStructureReady, source } =
      setup();
    const initial = data(0);
    const revision = data(3);

    coordinator.request(initial);
    await settlePubsSource(emit);
    emit("render");
    setStructureReady(false);
    coordinator.request(revision);
    expect(source.setData).toHaveBeenCalledTimes(1);

    setStructureReady(true);
    map.getSource.mockReturnValueOnce(undefined);
    coordinator.flush();
    expect(source.setData).toHaveBeenCalledTimes(1);

    coordinator.flush();
    expect(source.setData).toHaveBeenCalledTimes(2);
    await settlePubsSource(emit);
    emit("render");
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(revision, 2);
  });

  it("does not publish a revision whose pubs source reports an error", async () => {
    const { coordinator, emit, publish } = setup();

    coordinator.request(data(1));
    await Promise.resolve();
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

  it("does not mistake pre-settlement source events for tagged content", async () => {
    const { coordinator, emit, publish, source } = setup();
    let settleTaggedData: (() => void) | undefined;
    source.setData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleTaggedData = resolve;
        }),
    );

    coordinator.request(data(1));
    emit("sourcedata", {
      isSourceLoaded: true,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("render");
    expect(publish).not.toHaveBeenCalled();

    settleTaggedData?.();
    await Promise.resolve();
    emit("render");
    expect(publish).not.toHaveBeenCalled();

    emit("sourcedata", {
      isSourceLoaded: true,
      sourceId: "pubs",
      sourceDataType: "content",
    });
    emit("render");
    expect(publish).toHaveBeenCalledOnce();
  });

  it("keeps story-band reads on committed data while a newer revision waits", async () => {
    const { coordinator, emit, publish, source } = setup();
    const settled = data(0);
    const pending = data(3);

    coordinator.request(settled);
    await settlePubsSource(emit);
    emit("render");
    coordinator.request(pending);

    expect(coordinator.getCommittedData()).toBe(settled);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(source.setData).toHaveBeenCalledTimes(2);
  });

  it("serialises a superseded worker revision before starting latest data", async () => {
    const { coordinator, emit, publish, source } = setup();
    let settleStale: (() => void) | undefined;
    source.setData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleStale = resolve;
        }),
    );
    const stale = data(1);
    const latest = data(3);

    coordinator.request(stale);
    coordinator.request(latest);

    expect(source.setData).toHaveBeenCalledTimes(1);
    settleStale?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(source.setData).toHaveBeenCalledTimes(2);
    expect(
      source.setData.mock.calls[1][0].features[0].properties,
    ).toEqual({
      bucket: 3,
      [PUBS_SOURCE_REVISION_PROPERTY]: 2,
    });

    await settlePubsSource(emit);
    emit("render");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(latest, 2);
  });
});
