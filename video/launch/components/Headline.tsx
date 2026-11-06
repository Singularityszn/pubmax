// A scene headline: Space Grotesk, set large, in warm paper on the night
// ground. The words rise in on a restrained spring and leave the same way.
// A closing full stop is painted coral; the text itself is never changed.

import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { COLOURS, FONTS } from "../theme";

type HeadlineProps = {
  text: string;
  /** Frame (inside the parent sequence) the words start to arrive. */
  enter: number;
  /** Frame the words start to leave; omit to hold. */
  exit?: number;
  size?: number;
  top: number;
  left: number;
  /** Wrap onto more lines at this width; omit to keep one line. */
  maxWidth?: number;
};

export function Headline({ text, enter, exit, size = 84, top, left, maxWidth }: HeadlineProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  const leave =
    exit === undefined
      ? 0
      : interpolate(frame, [exit, exit + 9], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.in(Easing.cubic),
        });
  return (
    <h1
      style={{
        position: "absolute",
        top,
        left,
        margin: 0,
        fontFamily: FONTS.headline,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: "-0.035em",
        color: COLOURS.paper,
        whiteSpace: maxWidth === undefined ? "nowrap" : "normal",
        width: maxWidth,
        opacity: 1 - leave,
        translate: `0px ${-28 * leave}px`,
      }}
    >
      {words.map((word, index) => {
        const arrive = spring({ frame: frame - enter - index * 3, fps, config: { damping: 20, stiffness: 160 } });
        const stop = word.endsWith(".") ? word.slice(0, -1) : null;
        return (
          <span
            key={`${word}-${index}`}
            style={{
              display: "inline-block",
              marginRight: index < words.length - 1 ? "0.24em" : 0,
              opacity: arrive,
              translate: `0px ${interpolate(arrive, [0, 1], [34, 0])}px`,
            }}
          >
            {stop === null ? word : (
              <>
                {stop}
                <span style={{ color: COLOURS.coral }}>.</span>
              </>
            )}
          </span>
        );
      })}
    </h1>
  );
}
