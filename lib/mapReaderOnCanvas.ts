// Whether the reader's dot is on the map canvas the reader can see.
//
// The map's geographic bounds are the rectangle that encloses the view. At a
// pitch or a bearing, and London rests on both, that rectangle's corners lie
// off the canvas. A surface that says "the map shows your position" needs the
// canvas's own answer, so the canvas publishes it here and the surface reads
// it without the map shell in between. Null means no map has answered.

let onCanvas: boolean | null = null;
const listeners = new Set<() => void>();

export function publishMapReaderOnCanvas(next: boolean | null): void {
  if (onCanvas === next) return;
  onCanvas = next;
  for (const listener of listeners) listener();
}

export function mapReaderOnCanvas(): boolean | null {
  return onCanvas;
}

export function subscribeMapReaderOnCanvas(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
