"use client";

import { useEffect, useRef } from "react";

import { BRAND_NAME } from "@/lib/brandNaming";
import { prefersReducedMotion } from "@/lib/wildMode";

import {
  canvasHeight,
  dotStep,
  dotsAtRest,
  pushRadius,
  scatterDots,
  settleDots,
  stepDots,
  type WordDot,
} from "./dotFooterMotion";
import "./dotFooter.css";

// THE GIANT DOT FOOTER (round-two wild idea 10; it renders only while the wild
// switch is on, lib/wildMode.ts, and loads as its own chunk). The PUBMAXX
// wordmark is drawn in dots on a canvas above the landing's footer links. A
// finger or a pointer scatters the dots near it and a spring pulls each one
// home; the final X takes the brand accent, as the wordmark's own X does
// (components/brand/PubmaxxWordmark.tsx).
//
// It fits any width: the letters are sized to the canvas, the dot spacing to
// the width, and the backing store to the device pixel ratio (capped at 2, the
// map's own ceiling). The loop runs only while the dots are moving and stops
// when the word is at rest. Reduced motion draws the word once and never moves
// it. The one line under it repeats counts the landing already prints, from
// the same figures.

export type DotFooterCount = { figure: string; words: string };

/** Reads a colour token off the canvas, or the fallback when it cannot be parsed. */
function tokenColour(ctx: CanvasRenderingContext2D, styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  ctx.fillStyle = fallback;
  if (value) ctx.fillStyle = value;
  return String(ctx.fillStyle);
}

export default function DotFooter({ counts }: { counts: DotFooterCount[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    const reduced = prefersReducedMotion();

    let dots: WordDot[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let radius = 2;
    let reach = 40;
    let ink = "#000";
    let accent = "#000";
    let raf = 0;
    let last = 0;
    let pointer: { x: number; y: number } | null = null;
    let burst = 1;
    let gathered = false;
    let disposed = false;

    const readColours = () => {
      const styles = getComputedStyle(canvas);
      ink = tokenColour(ctx, styles, "--ink", "#17171a");
      accent = tokenColour(ctx, styles, "--brass", ink);
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      for (const pass of [false, true]) {
        ctx.fillStyle = pass ? accent : ink;
        ctx.beginPath();
        for (const dot of dots) {
          if (dot.accent !== pass) continue;
          ctx.moveTo(dot.x + radius, dot.y);
          ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    };

    const build = () => {
      const measured = Math.round(wrap.getBoundingClientRect().width);
      if (measured < 40) return;
      width = measured;
      height = canvasHeight(width);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;

      const off = document.createElement("canvas");
      off.width = width;
      off.height = height;
      const o = off.getContext("2d", { willReadFrequently: true });
      if (!o) return;
      const family = getComputedStyle(canvas).getPropertyValue("--font-display").trim() || "sans-serif";
      const word = BRAND_NAME;
      const head = word.slice(0, -1);
      const tail = word.slice(-1);
      o.font = `800 100px ${family}`;
      if ("letterSpacing" in o) (o as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "-4px";
      const probe = o.measureText(word);
      const size = Math.min(height * 0.95 * (100 / Math.max(1, probe.actualBoundingBoxAscent)), ((width * 0.96) / probe.width) * 100);
      o.font = `800 ${size.toFixed(1)}px ${family}`;
      if ("letterSpacing" in o) {
        (o as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(-0.04 * size).toFixed(1)}px`;
      }
      const full = o.measureText(word);
      const headWidth = o.measureText(head).width;
      const x0 = (width - full.width) / 2;
      const baseline = (height + full.actualBoundingBoxAscent - full.actualBoundingBoxDescent) / 2;
      o.fillStyle = "rgb(0, 0, 255)";
      o.fillText(head, x0, baseline);
      o.fillStyle = "rgb(255, 0, 0)";
      o.fillText(tail, x0 + headWidth, baseline);

      const step = dotStep(width);
      const data = o.getImageData(0, 0, width, height).data;
      const next: WordDot[] = [];
      for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
          const i = (Math.floor(y) * width + Math.floor(x)) * 4;
          if ((data[i + 3] ?? 0) < 140) continue;
          next.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, accent: (data[i] ?? 0) > (data[i + 2] ?? 0) });
        }
      }
      dots = next;
      radius = step * 0.36;
      reach = pushRadius(width);
      if (!gathered && !reduced) scatterDots(dots, width, height);
      draw();
    };

    const frame = (now: number) => {
      raf = 0;
      const steps = last ? Math.max(1, Math.min(3, Math.round((now - last) / 16.67))) : 1;
      last = now;
      let motion = 0;
      for (let i = 0; i < steps; i += 1) {
        motion = stepDots(dots, pointer, reach, burst);
        burst = 1;
      }
      draw();
      if (!pointer && dotsAtRest(motion, dots.length)) {
        settleDots(dots);
        draw();
        last = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (reduced || disposed || raf) return;
      raf = requestAnimationFrame(frame);
    };

    const at = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onMove = (event: PointerEvent) => {
      pointer = at(event);
      wake();
    };
    const onDown = (event: PointerEvent) => {
      pointer = at(event);
      burst = 3;
      wake();
    };
    const onLeave = () => {
      pointer = null;
      wake();
    };

    readColours();
    build();

    // The word gathers itself the first time it is seen, then waits for a hand.
    const seen =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            if (gathered || !entries.some((entry) => entry.isIntersecting)) return;
            gathered = true;
            wake();
          }, { threshold: 0.35 })
        : null;
    if (seen) seen.observe(canvas);
    else {
      gathered = true;
      settleDots(dots);
      draw();
    }

    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const nextWidth = Math.round(wrap.getBoundingClientRect().width);
      const nextDpr = Math.min(2, window.devicePixelRatio || 1);
      if (nextWidth !== width || nextDpr !== dpr) build();
    }) : null;
    resize?.observe(wrap);

    // A theme switch repaints the dots in the new ink.
    const theme = new MutationObserver(() => {
      readColours();
      draw();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => {
      readColours();
      draw();
    };
    scheme?.addEventListener?.("change", onScheme);

    // The letters are sized to the brand face, so draw again once it is in.
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!disposed) build();
      });
    }

    if (!reduced) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("pointercancel", onLeave);
      canvas.addEventListener("pointerup", onLeave);
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      seen?.disconnect();
      resize?.disconnect();
      theme.disconnect();
      scheme?.removeEventListener?.("change", onScheme);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointercancel", onLeave);
      canvas.removeEventListener("pointerup", onLeave);
    };
  }, []);

  return (
    <div className="wildDots" ref={wrapRef}>
      <canvas ref={canvasRef} className="wildDotsCanvas" role="img" aria-label={BRAND_NAME} />
      {counts.length > 0 ? (
        <p className="wildDotsCounts">
          {counts.map((count) => (
            <span key={count.words} className="wildDotsCountRow">
              <span className="wildDotsCount">{count.figure}</span> {count.words}.
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
