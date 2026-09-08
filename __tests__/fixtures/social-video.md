# Social video fixtures

These original clips contain moving rectangles and silent AAC audio. No external footage or personal data is included.

`social-video.mp4` and `social-video-faststart.mp4` contain 48 H.264 frames at 24 frames per second, 320 by 240 pixels.
Both have stereo AAC-LC audio at 48000 Hz. Their duration is 2.026667 seconds, including audio priming.
The first stores `moov` after the sample data. The second uses faststart.
Both carry a test title and a synthetic London location. Preparation removes this metadata without changing sample offsets.

`social-video-portrait.mp4` contains 24 H.264 frames at 24 frames per second, 1080 by 1920 pixels, without audio.

Generated locally with PyAV and its bundled libav encoder. This is fixture tooling, not a production dependency.
All clips were fully decoded with libav. The first two also played and sought in Chromium.
`social-video-playback.json` records that browser check. Repeat it from the repository root:

```
node __tests__/fixtures/social-video-playback.mjs
```

The production parser checks container bounds, tracks, sample sizes, offsets, timing and codec framing.
It does not decode or transcode video. MP4 exports outside the supported subset receive an explicit refusal.
