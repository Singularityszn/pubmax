export type PhotoView = { scale: number; x: number; y: number };
type Box = { width: number; height: number };

export function clampPhotoView(view: PhotoView, frame: Box, photo: Box): PhotoView {
  const scale = Math.max(1, Math.min(4, view.scale));
  const fit = Math.min(frame.width / photo.width, frame.height / photo.height);
  const maxX = Math.max(0, (photo.width * fit * scale - frame.width) / 2);
  const maxY = Math.max(0, (photo.height * fit * scale - frame.height) / 2);
  return { scale, x: Math.max(-maxX, Math.min(maxX, view.x)), y: Math.max(-maxY, Math.min(maxY, view.y)) };
}
