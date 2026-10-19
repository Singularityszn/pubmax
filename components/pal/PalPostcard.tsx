"use client";

import { useEffect, useRef, useState } from "react";

import { palCheerLine } from "@/components/pal/PalCheer";
import PalPrint from "@/components/pal/PalPrint";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import {
  palPostcardDate,
  palPostcardPath,
  palPostcardPoints,
  palPostcardStops,
  type PalPostcardPoint,
} from "@/components/pal/palPostcardLayout";
import { readLocalPal } from "@/lib/localPal";
import { PAL_PRINT_SIZE, palGenomeFor, palGenomeStyle, type PalGenome } from "@/lib/palGenome";
import type { PubPal } from "@/lib/pubPal";
import { pubPalMascotSlugFor, pubPalMascotSrc } from "@/lib/pubPalMascot";
import "./palPostcard.css";

// The Pal postcard: after a finished night, the person's own Pal stands at the
// last stop of the route it walked with them. It is drawn here from what the
// recap already shows (the stops, in order), and it stays on this device until
// the person saves or shares it themselves: nothing is uploaded, stored or
// published. It carries no drink count, price or total. A hidden Pal, no Pal,
// or a night of fewer than two stops makes no postcard.

const VIEW_W = 600;
const VIEW_H = 300;
const VIEW_INSET = 56;
// The room above the last stop, where the Pal stands.
const VIEW_TOP = 130;
const IMAGE_W = 1200;
const IMAGE_H = 900;

type SaveState = "idle" | "working" | "saved" | "failed";

export default function PalPostcard({
  stops,
  title,
  completedAt,
}: {
  /** The stop names, in walking order. */
  stops: readonly string[];
  title: string;
  completedAt: string | null;
}) {
  const [pal, setPal] = useState<PubPal | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const stored = readLocalPal();
    queueMicrotask(() => setPal(stored));
  }, []);

  const names = palPostcardStops(stops);
  if (!pal || pal.hidden || names.length < 2) return null;
  const slug = pubPalMascotSlugFor(pal.appearance.species);
  if (!slug) return null;
  const genome = palGenomeFor(pal.id, pal.personality);
  const points = palPostcardPoints(names.length, VIEW_W, VIEW_H, VIEW_INSET, VIEW_TOP);
  const last = points[points.length - 1]!;
  const line = palCheerLine(pal.name, "crawl-finished", stops.length);
  const date = palPostcardDate(completedAt);

  const onSave = async () => {
    const card = cardRef.current;
    if (!card || save === "working") return;
    setSave("working");
    try {
      const blob = await drawPostcard(card, {
        pal,
        slug,
        genome,
        names,
        line,
        title,
        date,
      });
      const file = new File([blob], "pal-postcard.png", { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `A postcard from ${pal.name}` });
        } catch (cause) {
          // Closing the share sheet is a choice, not a failure.
          if (cause instanceof DOMException && cause.name === "AbortError") {
            setSave("idle");
            return;
          }
          throw cause;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setSave("saved");
    } catch {
      setSave("failed");
    }
  };

  return (
    <section className="palPostcardSection" aria-labelledby="pal-postcard-title">
      <h2 id="pal-postcard-title" className="type-card-title palPostcardHeading">
        A postcard from {pal.name}
      </h2>
      <figure className="palPostcard" ref={cardRef} data-testid="pal-postcard">
        <span className="palPostcardStamp" aria-hidden="true">
          <PalPrint print={genome.print} />
        </span>
        <div className="palPostcardMap">
          <svg
            className="palPostcardRoute"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label={`The route: ${names.join(", then ")}.`}
          >
            <path className="palPostcardWalk" d={palPostcardPath(points)} />
            {points.map((point, index) => (
              <g key={index} className="palPostcardStop">
                <circle className="palPostcardDot" cx={point.x} cy={point.y} r={20} />
                <text
                  className="palPostcardNumber"
                  x={point.x}
                  y={point.y}
                  fontSize={20}
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  {index + 1}
                </text>
              </g>
            ))}
          </svg>
          <span
            className="palPostcardPal"
            aria-hidden="true"
            style={{
              left: `${(last.x / VIEW_W) * 100}%`,
              top: `${(last.y / VIEW_H) * 100}%`,
              ...(palGenomeStyle(genome) as React.CSSProperties),
            }}
          >
            <PubPalMascot species={pal.appearance.species} size={64} circular decorative className="palPostcardFace" />
          </span>
        </div>
        <figcaption className="palPostcardCaption">
          <p className="palPostcardLine">{line}</p>
          <p className="palPostcardTitle">{title}</p>
          {date ? <p className="palPostcardDate type-meta">{date}</p> : null}
        </figcaption>
      </figure>
      <div className="palPostcardActions">
        <button type="button" className="palPostcardSave" onClick={() => void onSave()} disabled={save === "working"}>
          {save === "working" ? "Making the postcard" : "Save postcard"}
        </button>
        <p className="palPostcardNote type-meta" role="status">
          {save === "saved"
            ? "Postcard ready."
            : save === "failed"
              ? "That did not work. Try again."
              : "Only you see this until you share it."}
        </p>
      </div>
    </section>
  );
}

type PostcardContent = {
  pal: PubPal;
  slug: NonNullable<ReturnType<typeof pubPalMascotSlugFor>>;
  genome: PalGenome;
  names: string[];
  line: string;
  title: string;
  date: string | null;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The Pal photograph did not load."));
    image.src = src;
  });
}

/** Fits `text` to `maxWidth`, ending in an ellipsis if it must be cut. */
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * The same card as an image. Its colours and type are read from the card on
 * the page, so the image follows the theme the person sees and keeps no second
 * copy of the design tokens.
 */
async function drawPostcard(card: HTMLElement, content: PostcardContent): Promise<Blob> {
  const style = getComputedStyle(card);
  const dot = card.querySelector<SVGElement>(".palPostcardDot");
  const walk = card.querySelector<SVGElement>(".palPostcardWalk");
  const paper = style.backgroundColor;
  const ink = style.color;
  const accent = dot ? getComputedStyle(dot).fill : ink;
  const trail = walk ? getComputedStyle(walk).stroke : ink;
  const font = style.fontFamily;

  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_W;
  canvas.height = IMAGE_H;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the postcard.");

  context.fillStyle = paper;
  context.fillRect(0, 0, IMAGE_W, IMAGE_H);
  context.strokeStyle = trail;
  context.lineWidth = 3;
  context.strokeRect(28, 28, IMAGE_W - 56, IMAGE_H - 56);

  // The route, in the top part of the card.
  const routeX = 80;
  const routeY = 60;
  const routeW = IMAGE_W - 160;
  const routeH = 480;
  const points: PalPostcardPoint[] = palPostcardPoints(content.names.length, routeW, routeH, 80, 220).map((point) => ({
    x: routeX + point.x,
    y: routeY + point.y,
  }));
  context.save();
  context.setLineDash([4, 14]);
  context.lineCap = "round";
  context.lineWidth = 6;
  context.strokeStyle = trail;
  context.stroke(new Path2D(palPostcardPath(points)));
  context.restore();
  points.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, 26, 0, Math.PI * 2);
    context.fillStyle = accent;
    context.fill();
    context.fillStyle = paper;
    context.font = `700 26px ${font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index + 1), point.x, point.y + 1);
  });

  // The Pal, standing at the last stop, held by its genome.
  const last = points[points.length - 1]!;
  const image = await loadImage(pubPalMascotSrc(content.slug, "avatar", 128, "png"));
  const radius = 66;
  const centreX = last.x;
  const centreY = last.y - radius - 36;
  context.save();
  context.beginPath();
  context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  context.fillStyle = paper;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = accent;
  context.stroke();
  context.clip();
  context.translate(centreX + (content.genome.focusX / 100) * radius * 2, centreY + (content.genome.focusY / 100) * radius * 2);
  context.rotate((content.genome.tilt * Math.PI) / 180);
  context.scale(content.genome.zoom * content.genome.flip, content.genome.zoom);
  context.drawImage(image, -radius, -radius, radius * 2, radius * 2);
  context.restore();

  // The Pal print, as a stamp in the top left corner.
  const cell = 14;
  const stampX = 80;
  const stampY = 70;
  context.fillStyle = accent;
  content.genome.print.forEach((on, index) => {
    if (!on) return;
    context.fillRect(stampX + (index % PAL_PRINT_SIZE) * cell + 1, stampY + Math.floor(index / PAL_PRINT_SIZE) * cell + 1, cell - 2, cell - 2);
  });

  // The words.
  const textX = 80;
  const textW = IMAGE_W - 160;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = ink;
  context.font = `700 46px ${font}`;
  context.fillText(fitText(context, content.line, textW), textX, 640);
  context.font = `500 32px ${font}`;
  context.fillText(fitText(context, content.title, textW), textX, 700);
  context.font = `400 26px ${font}`;
  context.fillText(fitText(context, content.names.join(" · "), textW), textX, 752);
  if (content.date) context.fillText(fitText(context, content.date, textW), textX, 800);
  context.font = `700 22px ${font}`;
  context.textAlign = "right";
  context.fillText("PubMaxxing", IMAGE_W - 80, 840);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The postcard did not draw."))), "image/png");
  });
}
