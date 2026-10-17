# Tab bar pressed rail

Phone tab bar redesign, 17 October 2026. Shots were taken on a keyless `next dev` build in Chromium at a device scale of 2, cropped to the bar.

The dock is a raised rail with one hairline and one soft drop. The page you are on is a well pressed into it: `--state-selected-surface` with an inset shadow in light, and a darker recess in dark. Glyphs went from 15px to 20px. Idle labels are 600 and the current page 750. The rail is 54px tall inside the 64px `--tabbar-h` lane, so no reserved clearance moved.

Before and after come from the same `next dev` server on the same commit of `main`, with the stylesheet switched between the two branches, so only the tab bar differs.

| Route | Theme | Width | Before | After |
| --- | --- | --- | --- | --- |
| /tonight | light | 390 | [before](before-tonight-light-390.png) | [after](after-tonight-light-390.png) |
| /tonight | dark | 390 | [before](before-tonight-dark-390.png) | [after](after-tonight-dark-390.png) |
| /map | light | 320 | [before](before-map-light-320.png) | [after](after-map-light-320.png) |
| /map | dark | 320 | [before](before-map-dark-320.png) | [after](after-map-dark-320.png) |
