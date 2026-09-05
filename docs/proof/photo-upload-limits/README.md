# A photo fits the wire, the picker is a picker, and a refused photo keeps its Memory

Proof for four defects from the contribution battle test (5 September 2026):
D02 (every phone photo over 4.5 MB answered Vercel's 413), D03 (the Moment
picker set `capture` and an accept list without HEIC), D05 (a text file named
`.jpg` was admitted and each refused save minted a Memory) and M01 (two
removals in one tick kept one). Every shot is `/moment` signed out, on
`next dev` of each commit, light theme, reduced motion, the composer scrolled
to its picker. `before` is origin/main at `7abdbb6a9`; `after` is this branch.
Phone shots are 390x844, tablet 768x1024, desktop 1440x900, all at device
scale 2.

## The picker at three widths

| width | before | after |
| --- | --- | --- |
| 390 | `before-390-picker.png` | `after-390-picker.png` |
| 768 | `before-768-picker.png` | `after-768-picker.png` |
| 1440 | `before-1440-picker.png` | `after-1440-picker.png` |

Before, the phone picker read "Take a photo. Camera or library" over an input
carrying `capture="environment"` and `accept="image/jpeg,image/png,image/webp"`,
and the desk read "JPEG, PNG, or WebP · drag and drop or browse" over a 10 MB
client gate. After, the input carries no `capture`, takes the shared accept
list naming HEIC and HEIF, and the hint is one sentence per line: the phone
says "Camera or library." then "Photos over 4 MB are resized."; the desk names
the four types, the resize and the other way in.

## What the composer does with three files, at 390 and 1440

| file handed to the picker | shot | status line |
| --- | --- | --- |
| a text file named `night.jpg`, typed `image/jpeg` | `after-390-text.png`, `after-1440-text.png` | That file is not a photo. Choose a JPEG, PNG, WebP or HEIC. |
| an `ftyp heic` container this browser cannot decode | `after-390-heic.png`, `after-1440-heic.png` | This browser cannot open that moment photo. Open it in Photos, share it as a JPEG, then choose it again. |
| a 4032x3024 JPEG of 7,309,203 bytes | `after-390-8mb.png`, `after-1440-8mb.png` | Photo added. It's still private. |

The draft was read back out of the composer's own IndexedDB store after each
run. After the third file the draft holds `mid.jpg`, `image/jpeg`, 1,772,375
bytes, under the 4,194,304 byte wire cap. Before (`before-1440-8mb.png`) the
same file is held at 7,309,203 bytes with the same status line, which is the
body the function refuses.

## What no shot can show

The `capture` attribute's effect is the operating system's own sheet, and no
browser reproduces it; the fence is `__tests__/profilePhotoPicker.test.ts`,
which now sweeps `components/moment`. The Memory kept across a refused write
and the two removals in one tick are pinned by
`__tests__/momentCaptureIntake.test.tsx`, which renders the composer against a
network double in the route's own envelope.
