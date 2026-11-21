// Whether the reader's dot is on the map canvas the reader can see.
//
// The map's geographic bounds are the rectangle that encloses the view. At a
// pitch or a bearing, and London rests on both, that rectangle's corners lie
// off the canvas. A surface that says "the map shows your position" needs the
// canvas's own answer, so the canvas publishes how to judge a point here and
// the surface asks it about the fix it renders with, without the map shell in
// between. Null means no map has answered.

export type MapReaderOnCanvas = (lat: number, lng: number) => boolean;

let onCanvas: MapReaderOnCanvas | null = null;
const listeners = new Set<() => void>();

export function publishMapReaderOnCanvas(next: MapReaderOnCanvas | null): void {
  if (onCanvas === next) return;
  onCanvas = next;
  for (const listener of listeners) listener();
}

export function mapReaderOnCanvas(): MapReaderOnCanvas | null {
  return onCanvas;
}

export function subscribeMapReaderOnCanvas(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
