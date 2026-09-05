# Messaging UI at 390x844, 768x1024 and 1440x900

Rendered proof for the captain's report of 5 September 2026, from his phone:
"the messaging is slow and ui is broken". This lane owns the UI; the data path
is a sibling lane. Shot against a local production build, device scale 2,
light and dark, with analytics consent already answered. The messages API is
answered in the browser with one fixed conversation, because a keyless server
cannot verify a bearer; every measurement below is `getBoundingClientRect` in
CSS pixels on the shipped markup and stylesheet.

`before/` and `after/` carry the same file names. A `-keyboard` shot is a
390x480 viewport with the field focused, the keyboard-sized cut a phone
browser makes of the screen. `-320` shots are 320x568.

## Which surfaces

- `inbox-*`: `/messages`.
- `thread-*`, `thread-sent-*`, `thread-empty-*`, `thread-error-*`: `/messages/<id>`.
- `pal-*`, `pal-asked-*`: `/pal/chat`, before and after one ask.
- There is no plan crew chat: `/plan/<id>` carries an RSVP and a proposal
  form, not a message thread, so nothing is shot for it.

## The composer is pinned, above the tab bar and above the keyboard

Before, the composer was the last thing on a scrolling page: below the fold
on every thread of any length, under the floating compose control, and on
`/pal/chat` off screen after the first answer (`before/pal-asked-390x844-light.png`).

| viewport | dock top | dock bottom | tab pill top | newest bubble bottom | compose control |
| --- | --- | --- | --- | --- | --- |
| 390x844 | 719 | 780 | 788 | 709 | hidden |
| 390x480, keyboard | 355 | 416 | 424 | 345 | hidden |
| 320x568 | 443 | 504 | 514 | 433 | hidden |
| 768x1024 | 905 | 966 | none | 622 | hidden |
| 1440x900 | 782 | 851 | none | 662 | hidden |

The newest message sits above the dock on every viewport, and the dock sits
above the tab bar's pill on every phone one. Nothing is painted over the
field: the top-most element at its centre is the field itself.

## Send is a 44px circle with the arrow dead centre

| viewport | width | height | arrow offset x | arrow offset y |
| --- | --- | --- | --- | --- |
| every viewport above | 44 | 44 | 0.00 | 0.00 |

## What else changed, by shot

- `thread-*`: the head names the other person with a face, sticky on the
  phone. Bubbles are a coral fill (mine) and a panel fill (theirs) with no
  edge; consecutive bubbles from one person sit tight and share a straight
  shoulder. A day line sits between days. The time and the Report control fold
  under each bubble until it is tapped, hovered or reached by keyboard; before,
  every received bubble carried an underlined Report. Seen or Sent prints under
  the viewer's own newest message.
- `thread-sent-*`: the sent bubble lands before the server answers, marked
  Sending, and the field clears at once.
- `inbox-*`: rows are a hairline-divided list with a face, the handle, one line
  of preview, the time on the right and a coral count on an unread row. Before,
  each row was a bordered card with no face and no time. The courtesy line
  about needing an account shows only to a reader who is not signed in.
- `thread-empty-*`: an empty thread shows the person and one line, where
  before it showed nothing above the composer.
- `*-dark`: the same layout on the night tokens; the received bubble takes the
  raised panel so it reads off the ink paper.
- `pal-*`: the composer is pinned over the foot of the page on solid paper;
  a proposal's Open and Dismiss stay on one row.

## Fences

`e2e/messages-thread.spec.ts` and `e2e/pal-chat-composer.spec.ts` measure the
same boxes on a production build; `__tests__/messageTimeline.test.ts` and
`__tests__/keyboardInset.test.ts` hold the two pure leaves.
