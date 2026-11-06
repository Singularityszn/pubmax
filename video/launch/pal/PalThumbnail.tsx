// The Pal cut's thumbnail: the job advert, stamped HIRED, with the real 3D
// Pal beside it and the address underneath.

import { AbsoluteFill } from "remotion";

import { BrandLockup } from "../components/Brand";
import { PalModel3D } from "../components/PalModel3D";
import { loadBrandFonts } from "../fonts";
import { Backdrop } from "../scenes/Backdrop";
import { COLOURS, FONTS } from "../theme";
import { JobAd } from "./JobAd";
import { PAL_COPY } from "./palTheme";

loadBrandFonts();

const facing = () => ({ yaw: 16, pitch: 2, roll: 1, lift: 0, scale: 1 });

export function PalThumbnail() {
  return (
    <AbsoluteFill>
      <Backdrop />
      <BrandLockup size={40} style={{ position: "absolute", top: 62, left: 80 }} />
      <JobAd still />
      <div
        style={{
          position: "absolute",
          left: 800 - 290,
          top: 590 - 290,
          width: 580,
          height: 580,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255, 90, 95, 0.3), rgba(255, 90, 95, 0) 65%)",
        }}
      />
      <div style={{ position: "absolute", left: 800 - 280, top: 590 - 280, width: 560, height: 560 }}>
        <PalModel3D size={560} pose={facing} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 52,
          textAlign: "center",
          fontFamily: FONTS.body,
          fontWeight: 700,
          fontSize: 44,
          letterSpacing: "-0.02em",
          color: COLOURS.paper,
        }}
      >
        {PAL_COPY.url}
      </div>
    </AbsoluteFill>
  );
}
