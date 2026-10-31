#!/bin/sh
# Turn the PNG frames fox_loop.py rendered into the shipped loop renditions:
# a VP9 WebM, an H.264 MP4 for Safari, and a WebP poster of the first frame.
#
#   scripts/pubpal/blender/encode_loop.sh FRAMES_DIR [SLUG] [OUT_DIR]
#
# The distribution Blender build has no denoiser, so a light temporal-spatial
# filter (hqdn3d) takes the render grain off before encoding. Writes into
# OUT_DIR, by default public/pal/ beside the stills, under <slug>-loop.*.
set -eu

FRAMES_DIR="$1"
SLUG="${2:-circuit-fox}"
OUT_DIR="${3:-$(cd "$(dirname "$0")/../../.." && pwd)/public/pal}"
FILTER="hqdn3d=3:2:4:3,format=yuv420p"

ffmpeg -y -loglevel error -framerate 24 -i "$FRAMES_DIR/frame_%04d.png" \
  -vf "$FILTER" -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -an \
  "$OUT_DIR/$SLUG-loop.webm"

ffmpeg -y -loglevel error -framerate 24 -i "$FRAMES_DIR/frame_%04d.png" \
  -vf "$FILTER" -c:v libx264 -preset slow -crf 27 -profile:v main \
  -movflags +faststart -an \
  "$OUT_DIR/$SLUG-loop.mp4"

ffmpeg -y -loglevel error -i "$FRAMES_DIR/frame_0001.png" \
  -vf "hqdn3d=3:2:4:3" -c:v libwebp -quality 80 \
  "$OUT_DIR/$SLUG-loop-poster.webp"

ls -l "$OUT_DIR/$SLUG-loop.webm" "$OUT_DIR/$SLUG-loop.mp4" "$OUT_DIR/$SLUG-loop-poster.webp"
