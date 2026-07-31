type PubsSource = {
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

export type PubsSourceRevisionCoordinator = {
  destroy: () => void;
  flush: () => void;
  getCommittedData: () => GeoJSON.FeatureCollection | null;
  request: (data: GeoJSON.FeatureCollection) => void;
  resetForStyle: () => void;
};

type CreatePubsSourceRevisionCoordinatorOptions = {
  getSource: () => PubsSource | undefined;
  invalidatePaint: () => void;
  isStyleStructureReady: () => boolean;
  publish: (data: GeoJSON.FeatureCollection) => void;
  subscribeRender: (listener: () => void) => () => void;
  subscribeSourceData: (
    listener: (event: PubsSourceDataEvent) => void,
  ) => () => void;
  subscribeSourceFailure: (
    listener: (event: PubsSourceErrorEvent) => void,
  ) => () => void;
  triggerRepaint: () => void;
};

/**
 * Serializes `pubs` GeoJSON revisions across MapLibre's asynchronous source
 * worker. A revision becomes committed only after its content event reports
 * loaded and a later render occurs, so published key state and map paint use
 * the same data object. Failed or superseded revisions never publish.
 */
export function createPubsSourceRevisionCoordinator({
  getSource,
  invalidatePaint,
  isStyleStructureReady,
  publish,
  subscribeRender,
  subscribeSourceData,
  subscribeSourceFailure,
  triggerRepaint,
}: CreatePubsSourceRevisionCoordinatorOptions): PubsSourceRevisionCoordinator {
  let active:
    | (PubsSourceRevision & {
        awaitingRender: boolean;
        detach: () => void;
        sawContent: boolean;
      })
    | null = null;
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
    const onSourceData = (event: PubsSourceDataEvent) => {
      if (
        event.sourceId !== "pubs" ||
        active?.id !== revision.id
      ) {
        return;
      }
      if (event.sourceDataType === "content") {
        active.sawContent = true;
        if (revision.id !== latestRevisionId) {
          finish(false);
          return;
        }
      }
      if (
        !active.sawContent ||
        !event.isSourceLoaded ||
        active.awaitingRender
      ) return;
      active.awaitingRender = true;
      unsubscribeRender = subscribeRender(onRender);
      triggerRepaint();
    };
    const onSourceFailure = (event: PubsSourceErrorEvent) => {
      if (event.sourceId === "pubs" && active?.id === revision.id) {
        finish(false);
      }
    };
    const onRender = () => {
      if (
        active?.id !== revision.id ||
        !active.sawContent ||
        !active.awaitingRender
      ) return;
      finish(
        revision.id === latestRevisionId &&
          isStyleStructureReady() &&
          getSource() === source,
      );
    };
    const unsubscribeSourceData = subscribeSourceData(onSourceData);
    const unsubscribeSourceFailure =
      subscribeSourceFailure(onSourceFailure);
    const detach = () => {
      unsubscribeSourceData();
      unsubscribeSourceFailure();
      unsubscribeRender();
    };
    const finish = (shouldPublish: boolean) => {
      if (active?.id !== revision.id) return;
      detach();
      active = null;
      if (shouldPublish) {
        committedData = revision.data;
        publish(revision.data);
      }
      pump();
    };

    active = {
      ...revision,
      awaitingRender: false,
      detach,
      sawContent: false,
    };
    invalidatePaint();
    try {
      void source.setData(revision.data).catch(() => finish(false));
    } catch {
      finish(false);
    }
  };

  const request = (data: GeoJSON.FeatureCollection) => {
    if (destroyed || active?.data === data || pending?.data === data) return;
    latestRevisionId += 1;
    pending = { data, id: latestRevisionId };
    if (active?.sawContent) {
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
