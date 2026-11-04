// 2 to 12 seconds: the product, in one window that stays put while its
// content changes, so the eye never has to find the app again.
//
//   2-6 s   Find your next pub.   London map, zoom to Clapham's real price
//                                 pins, then Feeley's real pub card.
//   6-10 s  Build the plan.       The route Plan built around Feeley's after
//                                 "Make it Stop 1", then the route map it drew.
//   10-12 s Send it to the group. The saved plan and its "Send to the crew".
//
// Every frame of the interface is a capture from capture-screens.mjs, cropped
// by the camera. The only things drawn here are the headline, the coral rings
// and the window itself. Ring positions come from screens.json, which the
// capture script read from the page.

import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { BrandLockup } from "../components/Brand";
import { Headline } from "../components/Headline";
import { GlideHighlight, Highlight } from "../components/Highlight";
import { ScreenCamera, type CaptureRect } from "../components/ScreenCamera";
import marks from "../screens.json";
import { COLOURS, COPY, HANDOVER } from "../theme";

/** The product window, in video pixels. Its aspect matches every crop below. */
const WINDOW = { x: 60, y: 266, w: 960, h: 740 } as const;
const ASPECT = WINDOW.w / WINDOW.h;

/** Converts a rect in CSS pixels of the 390-wide phone into capture pixels. */
const px = (rect: CaptureRect): CaptureRect => ({
  x: rect.x * marks.scale,
  y: rect.y * marks.scale,
  w: rect.w * marks.scale,
  h: rect.h * marks.scale,
});

/** A crop of the window's aspect, given its left, top and width in CSS pixels. */
const crop = (x: number, y: number, w: number): CaptureRect => px({ x, y, w, h: w / ASPECT });

/** Stage-local frames: each block's start, and its length before the next fades in. */
export const BLOCKS = {
  find: { from: 0, durationInFrames: 120 },
  plan: { from: 120, durationInFrames: 120 },
  share: { from: 240, durationInFrames: 60 },
} as const;

const PUSH = Easing.bezier(0.33, 0, 0.15, 1);

/**
 * One screen of the stage. A new screen pushes in from the right over the
 * handover while the one before slides left and dims, the way one app screen
 * follows another. Two busy screens never sit on top of each other.
 *
 * A block's sequence starts HANDOVER frames before its slot, so frame 0 inside
 * a block is the start of its push and every key below counts from there.
 */
function Block({ children, pushIn = true, leaveAt }: { children: ReactNode; pushIn?: boolean; leaveAt?: number }) {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: PUSH } as const;
  const arrive = pushIn ? interpolate(frame, [0, HANDOVER], [1, 0], clamp) : 0;
  const leave = leaveAt === undefined ? 0 : interpolate(frame, [leaveAt, leaveAt + HANDOVER], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{
        translate: `${arrive * WINDOW.w - leave * WINDOW.w * 0.3}px 0px`,
        opacity: 1 - 0.7 * leave,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

// THE FEELEY'S PIN, as the pill the map painted (CSS pixels, map-clapham).
const PIN: CaptureRect = { x: marks.pin.x - 27, y: marks.pin.y - 11, w: 54, h: 21 };
// The price badge and its evidence line, "£4.70 / Listed · collected 2 Oct".
// It stops short of "Near me" beside it, so the ring frames the price alone.
const PRICE: CaptureRect = { x: marks.pubPrice.x - 3, y: marks.pubPrice.y - 25, w: 122, h: 46 };

/**
 * Find-block moments, in stage frames: the ring lands on the pin, the pub card
 * slides up, and the camera settles on the price, which then holds for a full
 * second before Plan pushes in at frame 110.
 */
export const FIND = { pin: 32, sheet: 50, price: 80 } as const;

function FindBlock() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The pub card slides up over the map, as the sheet does in the app.
  const sheet = spring({ frame: frame - FIND.sheet, fps, config: { damping: 22, stiffness: 140 } });
  const london = interpolate(frame, [18, 28], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <ScreenCamera
        src="screens/map-clapham.png"
        width={WINDOW.w}
        height={WINDOW.h}
        keys={[
          { frame: 20, rect: crop(0, 66, 390) },
          { frame: 46, rect: crop(118, 112, 250) },
        ]}
        overlay={(toView) => <Highlight rect={toView(px(PIN))} from={FIND.pin} until={FIND.sheet + 12} gap={12} radius={20} />}
      />
      <AbsoluteFill style={{ opacity: london }}>
        <ScreenCamera
          src="screens/map-london.png"
          width={WINDOW.w}
          height={WINDOW.h}
          keys={[
            { frame: 0, rect: crop(0, 150, 390) },
            { frame: 28, rect: crop(70, 330, 250) },
          ]}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ translate: `0px ${interpolate(sheet, [0, 1], [WINDOW.h, 0])}px` }}>
        <ScreenCamera
          src="screens/map-pub.png"
          width={WINDOW.w}
          height={WINDOW.h}
          keys={[
            { frame: FIND.sheet + 16, rect: crop(0, 309, 390) },
            { frame: FIND.price, rect: crop(0, 543, 390) },
          ]}
          overlay={(toView) => <Highlight rect={toView(px(PRICE))} from={FIND.price - 2} gap={8} radius={18} />}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function PlanBlock() {
  const frame = useCurrentFrame();
  const stops = marks.stops.map((stop) => px(stop));
  // The route map sits below the stops on the real page, so the view scrolls
  // down to it rather than laying one screen over the other.
  const scroll = interpolate(frame, [94, 108], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: PUSH,
  });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ translate: `0px ${-scroll * WINDOW.h}px` }}>
      <ScreenCamera
        src="screens/plan-route.png"
        width={WINDOW.w}
        height={WINDOW.h}
        keys={[
          { frame: 10, rect: crop(-8, 84, 406) },
          { frame: 22, rect: crop(-8, 84, 406) },
          { frame: 40, rect: crop(-20, 238, 430) },
        ]}
        overlay={(toView) => {
          const [one, two, three] = stops.map((stop) => toView(stop));
          if (!one || !two || !three) return null;
          return <GlideHighlight rects={[one, one, two, two, three]} at={[44, 54, 63, 73, 82]} gap={8} radius={26} />;
        }}
      />
      </AbsoluteFill>
      <AbsoluteFill style={{ translate: `0px ${(1 - scroll) * WINDOW.h}px`, backgroundColor: COLOURS.night }}>
        <ScreenCamera
          src="screens/plan-map.png"
          width={WINDOW.w}
          height={WINDOW.h}
          keys={[
            { frame: 100, rect: crop(22, marks.routeCaption.y - 16, 346) },
            { frame: 135, rect: crop(40, marks.routeCaption.y + 4, 310) },
          ]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function ShareBlock() {
  return (
    <ScreenCamera
      src="screens/plan-saved.png"
      width={WINDOW.w}
      height={WINDOW.h}
      keys={[
        { frame: 10, rect: crop(14, 214, 362) },
        { frame: 50, rect: crop(28, 250, 334) },
      ]}
      overlay={(toView) => <Highlight rect={toView(px(marks.sendToCrew))} from={28} gap={12} radius={20} />}
    />
  );
}

export function ProductStage() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 22, stiffness: 120 } });
  const headlineTop = 128;
  return (
    <AbsoluteFill>
      <BrandLockup
        size={36}
        style={{ position: "absolute", top: 62, left: 80 }}
      />
      <Headline text={COPY.find} enter={6} exit={BLOCKS.plan.from - 6} top={headlineTop} left={80} />
      <Headline text={COPY.plan} enter={BLOCKS.plan.from + 2} exit={BLOCKS.share.from - 6} top={headlineTop} left={80} />
      <Headline text={COPY.share} enter={BLOCKS.share.from + 2} top={headlineTop} left={80} />
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
          opacity: interpolate(rise, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }),
          translate: `0px ${interpolate(rise, [0, 1], [140, 0])}px`,
          scale: String(interpolate(rise, [0, 1], [0.94, 1])),
        }}
      >
        <Sequence from={BLOCKS.find.from} durationInFrames={BLOCKS.find.durationInFrames} name="Find">
          <Block pushIn={false} leaveAt={BLOCKS.find.durationInFrames - HANDOVER}>
            <FindBlock />
          </Block>
        </Sequence>
        <Sequence from={BLOCKS.plan.from - HANDOVER} durationInFrames={BLOCKS.plan.durationInFrames + HANDOVER} name="Plan">
          <Block leaveAt={BLOCKS.plan.durationInFrames}>
            <PlanBlock />
          </Block>
        </Sequence>
        <Sequence from={BLOCKS.share.from - HANDOVER} durationInFrames={BLOCKS.share.durationInFrames + HANDOVER} name="Share">
          <Block>
            <ShareBlock />
          </Block>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
}
