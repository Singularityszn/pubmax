"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { clampPhotoView, rawPhotoView, rubberbandPhotoView, type PhotoView } from "@/lib/messagePhotoViewer";
import { releaseVelocity, springTo } from "@/lib/springAnimate";
import { projectMomentum } from "@/lib/springMotion";

type Point = { x: number; y: number };
type Props = { url: string; alt: string; width: number; height: number; onClose: () => void; onError: () => void };
const midpoint = (points: Point[]): Point => ({ x: (points[0]!.x + points.at(-1)!.x) / 2, y: (points[0]!.y + points.at(-1)!.y) / 2 });
const distance = (points: Point[]): number => points.length < 2 ? 0 : Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);

export default function MessagePhotoViewer({ url, alt, width, height, onClose, onError }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const view = useRef<PhotoView>({ scale: 1, x: 0, y: 0 });
  const displayed = useRef<PhotoView>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const start = useRef({ points: [] as Point[], view: { scale: 1, x: 0, y: 0 } });
  const sample = useRef({ view: { scale: 1, x: 0, y: 0 }, time: 0, velocity: { x: 0, y: 0 } });
  const animations = useRef<Array<() => void>>([]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const announceZoom = useCallback(() => setZoomLevel(Math.round(view.current.scale * 100)), []);

  const draw = useCallback((next: PhotoView) => {
    const frame = stage.current;
    if (!frame || !image.current) return;
    view.current = next;
    displayed.current = rubberbandPhotoView(next, frame.getBoundingClientRect(), { width, height });
    const { scale, x, y } = displayed.current;
    image.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    frame.dataset.scale = String(scale);
  }, [width, height]);

  const cancelMotion = useCallback(() => {
    animations.current.forEach(cancel => cancel());
    animations.current = [];
  }, []);
  const begin = useCallback((time: number) => {
    start.current = { points: [...pointers.current.values()], view: { ...(pointers.current.size === 2 ? displayed.current : view.current) } };
    sample.current = { view: view.current, time, velocity: { x: 0, y: 0 } };
  }, []);
  const changeView = useCallback((next: PhotoView) => {
    cancelMotion();
    const frame = stage.current;
    if (!frame) return;
    draw(clampPhotoView(next, frame.getBoundingClientRect(), { width, height }));
    begin(performance.now());
  }, [cancelMotion, draw, begin, width, height]);
  const settle = (velocity: Point) => {
    const frame = stage.current;
    if (!frame) return;
    cancelMotion();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const target = clampPhotoView({ ...view.current,
      x: projectMomentum(view.current.x, reduced ? 0 : velocity.x, 0.998),
      y: projectMomentum(view.current.y, reduced ? 0 : velocity.y, 0.998),
    }, frame.getBoundingClientRect(), { width, height });
    for (const axis of ["x", "y"] as const) {
      animations.current.push(springTo(view.current[axis], velocity[axis] * 1000, target[axis],
        { response: 0.34, dampingRatio: 1 },
        value => draw({ ...view.current, [axis]: value }), () => {}));
    }
  };

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.documentElement.style.overflow;
    try { element?.showModal(); document.documentElement.style.overflow = "hidden"; }
    catch { onError(); }
    const resize = () => changeView(view.current);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      changeView({ ...view.current, scale: view.current.scale * Math.exp(-event.deltaY * 0.01) });
      announceZoom();
    };
    window.addEventListener("resize", resize);
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => { cancelMotion(); element?.close(); document.documentElement.style.overflow = overflow; window.removeEventListener("resize", resize); element?.removeEventListener("wheel", wheel); };
  }, [changeView, cancelMotion, onError, announceZoom]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (pointers.current.size === 2) return;
    cancelMotion();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    begin(event.timeStamp);
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
    const next = { scale,
      x: after.x - rect.left - rect.width / 2 - (before.x - rect.left - rect.width / 2 - initial.view.x) * applied,
      y: after.y - rect.top - rect.height / 2 - (before.y - rect.top - rect.height / 2 - initial.view.y) * applied,
    };
    draw(current.length === 2 ? rawPhotoView(next, rect, { width, height }) : next);
    const elapsed = event.timeStamp - sample.current.time;
    if (elapsed > 0) {
      sample.current = { view: view.current, time: event.timeStamp, velocity: {
        x: (view.current.x - sample.current.view.x) / elapsed,
        y: (view.current.y - sample.current.view.y) / elapsed,
      } };
    }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (event.type === "pointerup" && previous && (previous.x !== event.clientX || previous.y !== event.clientY)) pointerMove(event);
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size > 0) begin(event.timeStamp);
    else settle({
      x: event.type === "pointerup" ? releaseVelocity(sample.current.velocity.x, sample.current.time, event.timeStamp) : 0,
      y: event.type === "pointerup" ? releaseVelocity(sample.current.velocity.y, sample.current.time, event.timeStamp) : 0,
    });
    announceZoom();
  };
  const zoom = (amount: number) => { changeView({ ...view.current, scale: view.current.scale + amount }); announceZoom(); };
  const reset = () => { changeView({ scale: 1, x: 0, y: 0 }); announceZoom(); };

  return <dialog ref={dialog} className="messagePhotoViewer" aria-label="Photo viewer" onClose={() => { if (!dialog.current?.open) onClose(); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <div className="messagePhotoViewerToolbar">
      <button type="button" onClick={() => zoom(-0.5)} aria-label="Zoom out">−</button>
      <button type="button" onClick={reset}>Reset zoom</button>
      <button type="button" onClick={() => zoom(0.5)} aria-label="Zoom in">+</button>
      <output className="messagePhotoZoomLevel" aria-label="Photo zoom" aria-live="polite">{zoomLevel}%</output>
      <button type="button" className="messagePhotoViewerClose" onClick={onClose}>Close</button>
    </div>
    <div ref={stage} className="messagePhotoViewerStage" data-scale="1" tabIndex={0} role="group" aria-label="Photo. Pinch to zoom, then drag to move."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
      onKeyDown={event => {
        event.stopPropagation();
        const key = event.key;
        if (key === "+" || key === "=") zoom(0.5);
        else if (key === "-") zoom(-0.5);
        else if (key === "Home") reset();
        else if (key.startsWith("Arrow")) changeView({ ...view.current, x: view.current.x + (key === "ArrowLeft" ? 40 : key === "ArrowRight" ? -40 : 0), y: view.current.y + (key === "ArrowUp" ? 40 : key === "ArrowDown" ? -40 : 0) });
        else return;
        event.preventDefault();
      }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- authorised local photo bytes */}
      <img ref={image} className="messagePhotoViewerImage" src={url} alt={alt} draggable={false} />
    </div>
  </dialog>;
}
