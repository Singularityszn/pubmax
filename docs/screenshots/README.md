# PubMaxing Screenshots

Reference screenshots for the Gate-Z visual baseline. The required gate captures
**390×844** and **1440×900** in light and dark themes via:

```sh
npm run shots
```

The extended breakpoint audit adds **430×932** and **1280×800**:

```sh
npm run shots:extended
```

## Core loop (light, 390)

### Landing

![Landing light 390](./landing-light-390.png)

### Map clean

![Map clean light 390](./map-clean-light-390.png)

### Map venue sheet

![Map sheet light 390](./map-sheet-light-390.png)

### Map log intent (`/map?log=1`)

![Map log light 390](./map-log-light-390.png)

### Feed

![Feed light 390](./feed-light-390.png)

### Crawls / route packs

![Crawls light 390](./crawls-light-390.png)

### Profile

![Profile light 390](./profile-you-light-390.png)

### Activity

![Activity light 390](./activity-light-390.png)

## Also captured

Each of the surfaces above is also saved for:

- light / dark
- 390×844 / 430×932 / 1280×800 / 1440×900
- shared Planned Night and active-night lifecycle states

Filenames follow `{surface}-{theme}-{390|430|1280|1440}.png`.

## Fable remediation evidence (390×844)

The 2026-07-21 remediation records both themes for the user-triggered Plan
location success/failure states and Today title diversity:

- `plan-location-success-light-390.png`
- `plan-location-success-dark-390.png`
- `plan-location-failure-light-390.png`
- `plan-location-failure-dark-390.png`
- `today-diversity-light-390.png`
- `today-diversity-dark-390.png`

## Press arrival evidence (390×844)

`press-arrival/` holds the phone capture of the Pint Index arrival: the live
index strip (`arrival-390.png`), a dated monthly edition (`edition-390.png`),
and the map a chip lands on (`map-390.png`).
