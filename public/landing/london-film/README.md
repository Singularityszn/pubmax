# London, day to night

This silent 12-second film uses Karan Manoharan's existing, privacy-edited
photographs. The sources are the 1280px WebP files in ../london-collage/:

1. southwark-shard
2. crown-tavern
3. leadenhall-boxhall
4. canary-wharf-night

The film preserves the published privacy edits. It uses H.264, yuv420p,
720 by 960 pixels, 24 frames per second and fast-start MP4. Each photograph
has 81 frames, a centred zoom of 0.0005 per frame and a 0.5-second crossfade.
Crossfade offsets are 2.875, 5.75 and 8.625 seconds. The final duration is
12 seconds. FFmpeg encoding uses libx264, slow preset, CRF 26, no audio and
`-map_metadata -1`. Regenerate from the published WebP files, never originals.

The poster reuses southwark-shard-640.webp. places.vtt names each place.
The component mounts the video only after Play. It never loops.

Measured file size: 1,675,670 bytes. There are 288 video frames and no audio
stream. The file must remain below 2 MB. This byte budget applies to playback,
not initial page load, which requests no video.
