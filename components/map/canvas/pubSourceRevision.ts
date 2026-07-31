export const PUBS_SOURCE_REVISION_PROPERTY = "__pubmax_source_revision";

type PubsSource = {
  loaded: () => boolean;
  setData: (data: GeoJSON.FeatureCollection) => Promise<void>;
};

type PubsSourceDataEvent = {
  isSourceLoaded?: boolean;
  sourceId?: string;
  sourceDataType?: string;
};

type PubsSourceErrorEvent = {
  sourceId?: string;
};

type PubsSourceRevision = {
  data: GeoJSON.FeatureCollection;
  id: number;
};

type ActivePubsSourceRevision = PubsSourceRevision & {
  awaitingRender: boolean;
  detach: () => void;
  sourceLoaded: boolean;
  workerSettled: boolean;
};

export type PubsSourceRevisionCoordinator = {
  destroy: () => void;
  flush: () => void;
  getCommittedData: () => GeoJSON.FeatureCollection | null;
  request: (data: GeoJSON.FeatureCollection) => void;
  resetForStyle: () => void;
};

type CreatePubsSourceRevisionCoordinatorOptions = {
  beginPaintRevision: (revision: number) => void;
  getSource: () => PubsSource | undefined;
  isStyleStructureReady: () => boolean;
  publish: (data: GeoJSON.FeatureCollection, revision: number) => void;
  subscribeRender: (listener: () => void) => () => void;
  subscribeSourceData: (
    listener: (event: PubsSourceDataEvent) => void,
  ) => () => void;
  subscribeSourceFailure: (
    listener: (event: PubsSourceErrorEvent) => void,
  ) => () => void;
  triggerRepaint: () => void;
};

function tagSourceRevision(
  data: GeoJSON.FeatureCollection,
  revision: number,
): GeoJSON.FeatureCollection {
  return {
    ...data,
    features: data.features.map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        [PUBS_SOURCE_REVISION_PROPERTY]: revision,
      },
    })),
  };
}

export function createPubsSourceRevisionCoordinator({
  beginPaintRevision,
  getSource,
  isStyleStructureReady,
  publish,
  subscribeRender,
  subscribeSourceData,
  subscribeSourceFailure,
  triggerRepaint,
}: CreatePubsSourceRevisionCoordinatorOptions): PubsSourceRevisionCoordinator {
  let active: ActivePubsSourceRevision | null = null;
  let committedData: GeoJSON.FeatureCollection | null = null;
  let destroyed = false;
  let latestRevisionId = 0;
  let pending: PubsSourceRevision | null = null;

  const pump = () => {
    if (
      destroyed ||
      active ||
      !pending ||
      !isStyleStructureReady()
    ) {
      return;
    }
    const source = getSource();
    if (!source) return;

    const revision = pending;
    pending = null;
    let unsubscribeRender = () => {};

    function detach() {
      unsubscribeSourceData();
      unsubscribeSourceFailure();
      unsubscribeRender();
    }

    function finish(shouldPublish: boolean) {
      if (active?.id !== revision.id) return;
      detach();
      active = null;
      if (shouldPublish) {
        committedData = revision.data;
        publish(revision.data, revision.id);
      }
      pump();
    }

    function maybeAwaitRender() {
      if (
        active?.id !== revision.id ||
        active.awaitingRender ||
        !active.sourceLoaded ||
        !active.workerSettled
      ) {
        return;
      }
      if (revision.id !== latestRevisionId) {
        finish(false);
        return;
      }
      active.awaitingRender = true;
      unsubscribeRender = subscribeRender(onRender);
      triggerRepaint();
    }

    function onSourceData(event: PubsSourceDataEvent) {
      if (event.sourceId !== "pubs" || active?.id !== revision.id) {
        return;
      }
      if (active.workerSettled && event.isSourceLoaded === true) {
        active.sourceLoaded = true;
      }
      maybeAwaitRender();
    }

    function onSourceFailure(event: PubsSourceErrorEvent) {
      if (event.sourceId === "pubs" && active?.id === revision.id) {
        finish(false);
      }
    }

    function onRender() {
      if (
        active?.id !== revision.id ||
        !active.awaitingRender
      ) {
        return;
      }
      finish(
        revision.id === latestRevisionId &&
          isStyleStructureReady() &&
          getSource() === source,
      );
    }

    const unsubscribeSourceData = subscribeSourceData(onSourceData);
    const unsubscribeSourceFailure =
      subscribeSourceFailure(onSourceFailure);
    active = {
      ...revision,
      awaitingRender: false,
      detach,
      sourceLoaded: false,
      workerSettled: false,
    };
    beginPaintRevision(revision.id);
    try {
      void source
        .setData(tagSourceRevision(revision.data, revision.id))
        .then(
          () => {
            if (active?.id !== revision.id) return;
            active.workerSettled = true;
            active.sourceLoaded = source.loaded();
            if (revision.id !== latestRevisionId) {
              finish(false);
              return;
            }
            maybeAwaitRender();
          },
          () => finish(false),
        );
    } catch {
      finish(false);
    }
  };

  const request = (data: GeoJSON.FeatureCollection) => {
    if (destroyed || active?.data === data || pending?.data === data) return;
    latestRevisionId += 1;
    pending = { data, id: latestRevisionId };
    if (active?.workerSettled) {
      active.detach();
      active = null;
    }
    pump();
  };

  return {
    destroy: () => {
      destroyed = true;
      active?.detach();
      active = null;
      pending = null;
    },
    flush: pump,
    getCommittedData: () => committedData,
    request,
    resetForStyle: () => {
      const data = pending?.data ?? active?.data ?? committedData;
      active?.detach();
      active = null;
      pending = null;
      if (data) {
        latestRevisionId += 1;
        pending = { data, id: latestRevisionId };
      }
    },
  };
}
