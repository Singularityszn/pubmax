// 4 to 14 seconds: the Pal at work, in one product window.
//
//   Ask it like a mate.          the ask typed into the Pal, and its answer:
//                                four picks and the map of them.
//   Every card shows its source. The Pheonix: £5.00, "Pint Prices. Source
//                                read 2 October 2026."
//   It does the admin.           "Kept for tonight", "Make it Stop 1", the
//                                route Plan built around it, "Send to the crew".
//
// Every frame of the interface is a capture from capture-pal-screens.mjs. The
// rings come from pal-screens.json, read from the page.

import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { Headline } from "../components/Headline";
import { GlideHighlight, Highlight } from "../components/Highlight";
import { ScreenCamera, type CaptureRect } from "../components/ScreenCamera";
import marks from "../pal-screens.json";
import { COLOURS, HANDOVER } from "../theme";
import { PAL_COPY, PAL_SCENES } from "./palTheme";

const WINDOW = { x: 60, y: 296, w: 960, h: 684 } as const;
const ASPECT = WINDOW.w / WINDOW.h;

const px = (rect: CaptureRect): CaptureRect => ({
  x: rect.x * marks.scale,
  y: rect.y * marks.scale,
  w: rect.w * marks.scale,
  h: rect.h * marks.scale,
});
const crop = (x: number, y: number, w: number): CaptureRect => px({ x, y, w, h: w / ASPECT });

/** Stage-local slots. The stage starts with the chat scene and ends with admin. */
export const WORK = {
  typed: { from: 0, durationInFrames: 44 },
  picks: { from: 44, durationInFrames: 70 },
  cards: { from: 114, durationInFrames: 66 },
  kept: { from: 180, durationInFrames: 44 },
  route: { from: 224, durationInFrames: 46 },
  saved: { from: 270, durationInFrames: 30 },
} as const;

const STAGE_LENGTH = PAL_SCENES.out.from - PAL_SCENES.chat.from;
/** Frames the window takes to drop away when the Pal clocks off. */
const DROP = 14;

const PUSH = Easing.bezier(0.33, 0, 0.15, 1);

/** One screen: it pushes in from the right over the handover, then holds. */
function Block({ children, pushIn = true, leaveAt }: { children: ReactNode; pushIn?: boolean; leaveAt?: number }) {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: PUSH } as const;
  const arrive = pushIn ? interpolate(frame, [0, HANDOVER], [1, 0], clamp) : 0;
  const leave = leaveAt === undefined ? 0 : interpolate(frame, [leaveAt, leaveAt + HANDOVER], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ translate: `${arrive * WINDOW.w - leave * WINDOW.w * 0.3}px 0px`, opacity: 1 - 0.7 * leave }}>
      {children}
    </AbsoluteFill>
  );
}

/** A block's sequence: it starts HANDOVER frames early so its push overlaps. */
function Slot({ slot, name, children, first = false, last = false }: {
  slot: { from: number; durationInFrames: number };
  name: string;
  children: ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  const lead = first ? 0 : HANDOVER;
  const length = slot.durationInFrames + lead + (last ? DROP : 0);
  return (
    <Sequence from={slot.from - lead} durationInFrames={length} name={name}>
      <Block pushIn={!first} leaveAt={last ? undefined : slot.durationInFrames + lead - HANDOVER}>
        {children}
      </Block>
    </Sequence>
  );
}

function Typed() {
  return (
    <ScreenCamera
      src="screens/pal-typed.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[
        { frame: 2, rect: crop(0, 66, 390) },
        { frame: 22, rect: crop(0, 528, 390) },
      ]}
      overlay={(toView) => <Highlight rect={toView(px(marks.input))} from={24} gap={8} radius={30} />}
    />
  );
}

function Picks() {
  return (
    <ScreenCamera
      src="screens/pal-picks.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[
        { frame: 10, rect: crop(0, 84, 390) },
        { frame: 40, rect: crop(0, 84, 390) },
        { frame: 58, rect: crop(0, 290, 390) },
      ]}
    />
  );
}

function Cards() {
  const card = marks.cards[marks.pick];
  if (!card) return null;
  return (
    <ScreenCamera
      src="screens/pal-cards.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[
        { frame: 10, rect: crop(0, card.card.y - 26, 390) },
        { frame: 40, rect: crop(0, card.card.y - 26, 390) },
        { frame: 58, rect: crop(14, card.card.y + 34, 330) },
      ]}
      overlay={(toView) => (
        <GlideHighlight
          rects={[toView(px(card.price)), toView(px(card.price)), toView(px(card.source))]}
          at={[16, 30, 40]}
          gap={8}
          radius={14}
        />
      )}
    />
  );
}

function Kept() {
  return (
    <ScreenCamera
      src="screens/pal-kept.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[
        { frame: 10, rect: crop(-20, marks.kept.y - 76, 430) },
        { frame: 26, rect: crop(-20, marks.kept.y - 76, 430) },
        { frame: 38, rect: crop(-20, marks.keptStop.y - 190, 430) },
      ]}
      overlay={(toView) => (
        <GlideHighlight
          rects={[toView(px(marks.kept)), toView(px(marks.kept)), toView(px(marks.keptStop))]}
          at={[12, 26, 38]}
          gap={8}
          radius={16}
        />
      )}
    />
  );
}

function Route() {
  return (
    <ScreenCamera
      src="screens/pal-route.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[{ frame: 0, rect: crop(-40, 232, 470) }]}
      overlay={(toView) => {
        const [one, two, three] = marks.stops.map((stop) => toView(px(stop)));
        if (!one || !two || !three) return null;
        return <GlideHighlight rects={[one, one, two, two, three]} at={[14, 22, 28, 36, 42]} gap={8} radius={26} />;
      }}
    />
  );
}

function Saved() {
  return (
    <ScreenCamera
      src="screens/pal-saved.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[
        { frame: 10, rect: crop(14, 214, 362) },
        { frame: 40, rect: crop(30, 240, 330) },
      ]}
      overlay={(toView) => <Highlight rect={toView(px(marks.sendToCrew))} from={18} gap={12} radius={20} />}
    />
  );
}

export function PalWork() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 22, stiffness: 120 } });
  // The Pal clocks off: the window drops away under the out-of-office card.
  const drop = interpolate(frame, [STAGE_LENGTH, STAGE_LENGTH + DROP], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  // Each headline keeps clear of the Pal by the top-right corner, and the
  // two-line one breaks where it reads best.
  const headline = { top: 112, left: 80, size: 74 } as const;
  return (
    <AbsoluteFill>
      <div style={{ opacity: 1 - drop }}>
        <Headline text={PAL_COPY.ask} enter={4} exit={WORK.cards.from - 8} maxWidth={740} {...headline} />
        <Headline text={PAL_COPY.receipts} enter={WORK.cards.from + 2} exit={WORK.kept.from - 8} maxWidth={620} {...headline} />
        <Headline text={PAL_COPY.admin} enter={WORK.kept.from + 2} maxWidth={740} {...headline} />
      </div>
      <div
        style={{
          position: "absolute",
          left: WINDOW.x,
          top: WINDOW.y,
          width: WINDOW.w,
          height: WINDOW.h,
          borderRadius: 40,
          overflow: "hidden",
          backgroundColor: COLOURS.night,
          boxShadow: "0 0 0 2px rgba(248, 242, 236, 0.10), 0 30px 80px rgba(0, 0, 0, 0.55)",
          opacity: interpolate(rise, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }) * (1 - drop),
          translate: `0px ${interpolate(rise, [0, 1], [140, 0]) + drop * 700}px`,
          rotate: `${drop * 6}deg`,
          scale: String(interpolate(rise, [0, 1], [0.94, 1])),
        }}
      >
        <Slot slot={WORK.typed} name="Ask" first>
          <Typed />
        </Slot>
        <Slot slot={WORK.picks} name="Picks">
          <Picks />
        </Slot>
        <Slot slot={WORK.cards} name="Source">
          <Cards />
        </Slot>
        <Slot slot={WORK.kept} name="Kept for tonight">
          <Kept />
        </Slot>
        <Slot slot={WORK.route} name="Route">
          <Route />
        </Slot>
        <Slot slot={WORK.saved} name="Send to the crew" last>
          <Saved />
        </Slot>
      </div>
    </AbsoluteFill>
  );
}
