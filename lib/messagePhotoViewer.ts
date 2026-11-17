import { rubberband } from "@/lib/springAnimate";

export type PhotoView = { scale: number; x: number; y: number };
type Box = { width: number; height: number };

export function clampPhotoView(view: PhotoView, frame: Box, photo: Box): PhotoView {
  const scale = Math.max(1, Math.min(4, view.scale));
  const fit = Math.min(frame.width / photo.width, frame.height / photo.height);
  const maxX = Math.max(0, (photo.width * fit * scale - frame.width) / 2);
  const maxY = Math.max(0, (photo.height * fit * scale - frame.height) / 2);
  return { scale, x: Math.max(-maxX, Math.min(maxX, view.x)), y: Math.max(-maxY, Math.min(maxY, view.y)) };
}

export function rubberbandPhotoView(view: PhotoView, frame: Box, photo: Box): PhotoView {
  const bounded = clampPhotoView(view, frame, photo);
  return {
    ...bounded,
    x: frame.width > 0 ? bounded.x + rubberband(view.x - bounded.x, frame.width) : bounded.x,
    y: frame.height > 0 ? bounded.y + rubberband(view.y - bounded.y, frame.height) : bounded.y,
  };
}

export function rawPhotoView(displayed: PhotoView, frame: Box, photo: Box): PhotoView {
  const bounded = clampPhotoView(displayed, frame, photo);
  const raw = (offset: number, dimension: number) => {
    if (dimension <= 0) return 0;
    const magnitude = Math.min(Math.abs(offset), dimension * (1 - Number.EPSILON));
    return Math.sign(offset) * magnitude * dimension / (0.55 * (dimension - magnitude));
  };
  return {
    ...bounded,
    x: bounded.x + raw(displayed.x - bounded.x, frame.width),
    y: bounded.y + raw(displayed.y - bounded.y, frame.height),
  };
}
