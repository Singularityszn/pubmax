"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { clampPhotoView, type PhotoView } from "@/lib/messagePhotoViewer";

type Point = { x: number; y: number };
type Props = { url: string; alt: string; width: number; height: number; onClose: () => void; onError: () => void };
const midpoint = (points: Point[]): Point => ({ x: (points[0]!.x + points.at(-1)!.x) / 2, y: (points[0]!.y + points.at(-1)!.y) / 2 });
const distance = (points: Point[]): number => points.length < 2 ? 0 : Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);

export default function MessagePhotoViewer({ url, alt, width, height, onClose, onError }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const view = useRef<PhotoView>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const start = useRef({ points: [] as Point[], view: { scale: 1, x: 0, y: 0 } });

  const draw = useCallback((next: PhotoView) => {
    const frame = stage.current;
    if (!frame || !image.current) return;
    view.current = clampPhotoView(next, frame.getBoundingClientRect(), { width, height });
    const { scale, x, y } = view.current;
    image.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    frame.dataset.scale = String(scale);
  }, [width, height]);

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.documentElement.style.overflow;
    try { element?.showModal(); document.documentElement.style.overflow = "hidden"; }
    catch { onError(); }
    const resize = () => draw(view.current);
    window.addEventListener("resize", resize);
    return () => { element?.close(); document.documentElement.style.overflow = overflow; window.removeEventListener("resize", resize); };
  }, [draw, onError]);

  const begin = () => { start.current = { points: [...pointers.current.values()], view: { ...view.current } }; };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (pointers.current.size === 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    begin();
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = [...pointers.current.values()];
    const initial = start.current;
    const before = midpoint(initial.points);
    const after = midpoint(current);
    const ratio = current.length === 2 ? distance(current) / Math.max(1, distance(initial.points)) : 1;
    const scale = Math.max(1, Math.min(4, initial.view.scale * ratio));
    const applied = scale / initial.view.scale;
    const rect = event.currentTarget.getBoundingClientRect();
    draw({ scale,
      x: after.x - rect.left - rect.width / 2 - (before.x - rect.left - rect.width / 2 - initial.view.x) * applied,
      y: after.y - rect.top - rect.height / 2 - (before.y - rect.top - rect.height / 2 - initial.view.y) * applied,
    });
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    begin();
  };
  const zoom = (amount: number) => draw({ ...view.current, scale: view.current.scale + amount });

  return <dialog ref={dialog} className="messagePhotoViewer" aria-label="Photo viewer" onClose={() => { if (!dialog.current?.open) onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="messagePhotoViewerToolbar">
      <button type="button" onClick={() => zoom(-0.5)} aria-label="Zoom out">−</button>
      <button type="button" onClick={() => draw({ scale: 1, x: 0, y: 0 })}>Reset zoom</button>
      <button type="button" onClick={() => zoom(0.5)} aria-label="Zoom in">+</button>
      <button type="button" className="messagePhotoViewerClose" onClick={onClose}>Close</button>
    </div>
    <div ref={stage} className="messagePhotoViewerStage" data-scale="1" tabIndex={0} aria-label="Photo. Pinch to zoom, then drag to move."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
      onKeyDown={event => {
        const key = event.key;
        if (key === "+" || key === "=") zoom(0.5);
        else if (key === "-") zoom(-0.5);
        else if (key === "Home") draw({ scale: 1, x: 0, y: 0 });
        else if (key.startsWith("Arrow")) draw({ ...view.current, x: view.current.x + (key === "ArrowLeft" ? 40 : key === "ArrowRight" ? -40 : 0), y: view.current.y + (key === "ArrowUp" ? 40 : key === "ArrowDown" ? -40 : 0) });
        else return;
        event.preventDefault();
      }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- authorised local photo bytes */}
      <img ref={image} className="messagePhotoViewerImage" src={url} alt={alt} draggable={false} />
    </div>
  </dialog>;
}
