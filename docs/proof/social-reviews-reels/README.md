# Social: pub reviews, photo-first cards and reels (ADR 0017)

Captured on a local `next dev` with browser auth in the keyless e2e shape and
the Social API answered by route doubles (`/api/social/access`, posts,
interactions, reviews, media and one video). The photos are the repo's own
landing imagery (`public/landing/london/ATTRIBUTION.md`); the reel is a
six-second clip cut from one of them. Viewports are 390x844 and 1440x900,
captured at 2x and scaled to half.

| File | What it shows |
| --- | --- |
| `light-phone-card.webp` | A review post: who and where, the photo at 4:5, Cheers / Comment / save / report, the score and the words. |
| `light-phone-full.webp` | Below desktop the feed comes straight after the lanes; Your pubs, ranked follows the posts. |
| `dark-desk-full.webp` | Desktop: the feed held to 560px beside the rail with Your pubs, ranked. |
| `reel-card-light.webp` | A reel in the feed, playing muted, with its length and the full-screen door. |
| `reels-viewer-light.webp` | Reels full screen above the tab bar: close, sound, handle, pub, score and caption. |
| `composer-dark.webp` | The composer once a pub is picked: Add photo or Add video, and the half-star score. |

Measured in the same run: the feed video reached `readyState` 4 and played
while in view; the viewer opened with focus on Close, played the clip in view,
and Escape closed it.
