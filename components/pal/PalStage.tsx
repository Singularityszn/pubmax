// The Pal stage: a Remotion composition that brings a Pal's REAL artwork to
// life. It draws nothing new. One WebGL pass moves the 512 master by a depth
// map built from the rig (lib/palStageRig.ts): the camera drifts, the head
// turns, nods and tilts over the body, the body breathes, the eyes blink with
// a lid of the Pal's own fur, and the mouth blends to the talking frame as the
// voice level rises. Every motion repeats over the composition's length, so a
// render loops without a jump.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import type { PalMascotSpecies } from "@/lib/palMascotAssets.mjs";
import { PAL_STAGE_MAX_BUMPS as MAX_BUMPS, PAL_STAGE_RIGS, palStageImages, type PalStageEllipse } from "@/lib/palStageRig";

/** @public The props the render entry passes (scripts/pubpal/render-pal-stage.mjs). */
export type PalStageProps = {
  slug: PalMascotSpecies;
  /** The mouth level for each frame, 0 (shut) to 1 (wide). Empty means silent. */
  voice?: number[];
};

const VERTEX = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D base;
uniform sampler2D talk;
uniform float side;
uniform vec4 bumps[${MAX_BUMPS}];
uniform float lifts[${MAX_BUMPS}];
uniform vec4 head;
uniform vec2 neck;
uniform vec4 eyeA;
uniform vec4 eyeB;
uniform vec4 mouth;
uniform vec2 cam;
uniform vec3 turn;
uniform float blink;
uniform float speak;
uniform float breath;

float ellipseRadius(vec2 p, vec4 e) { return length((p - e.xy) / e.zw); }
float soft(vec2 p, vec4 e, float edge) { return 1.0 - smoothstep(1.0 - edge, 1.0, ellipseRadius(p, e)); }

float depth(vec2 p) {
  float d = 0.18 * smoothstep(400.0, 512.0, p.y);
  for (int i = 0; i < ${MAX_BUMPS}; i++) {
    float r = ellipseRadius(p, bumps[i]);
    d = max(d, lifts[i] * sqrt(max(0.0, 1.0 - r * r)));
  }
  return d;
}

vec3 sampleAt(sampler2D image, vec2 p) { return texture2D(image, clamp(p / 512.0, 0.0, 1.0)).rgb; }

vec3 lid(vec3 colour, vec2 p, vec4 eye) {
  vec2 e = (p - eye.xy) / eye.zw;
  float inside = 1.0 - smoothstep(1.05, 1.3, length(e));
  float line = -1.25 + 2.5 * blink;
  float cover = inside * (1.0 - smoothstep(line - 0.12, line + 0.12, e.y));
  vec3 fur = sampleAt(base, eye.xy + vec2(e.x * eye.z, -eye.w * 1.9 + e.y * 0.25 * eye.w));
  colour = mix(colour, fur, cover);
  float lash = inside * step(0.02, blink) * (1.0 - smoothstep(0.0, 0.14, abs(e.y - line)));
  colour = mix(colour, colour * 0.35, lash * 0.8);
  // Shut, the lid shows a soft smiling crease.
  float crease = (1.0 - smoothstep(0.0, 0.12, abs(e.y - 0.25 + 0.35 * e.x * e.x))) * step(abs(e.x), 0.95);
  return mix(colour, vec3(0.01), crease * inside * pow(blink, 4.0) * 0.85);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, side - gl_FragCoord.y) / side * 512.0;
  float h = soft(p, head, 0.45);

  // The head tilts about the neck; the body breathes up from the floor.
  float c = cos(-turn.z * h);
  float s = sin(-turn.z * h);
  vec2 q = neck + mat2(c, s, -s, c) * (p - neck);
  q.y = 470.0 + (q.y - 470.0) / (1.0 + breath * (1.0 - h));

  // Parallax: nearer shapes move further. The head's turn adds to the camera.
  vec2 shift = cam + h * turn.xy;
  vec2 src = q;
  for (int i = 0; i < 5; i++) src = q - shift * depth(src);

  vec3 colour = sampleAt(base, src);
  colour = mix(colour, sampleAt(talk, src), soft(src, mouth, 0.5) * speak);
  colour = lid(colour, src, eyeA);
  colour = lid(colour, src, eyeB);
  gl_FragColor = vec4(colour, 1.0);
}
`;

const TAU = Math.PI * 2;

function pulse(phase: number, at: number, width: number) {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  return Math.max(0, 1 - distance / width);
}

/** Every motion of the stage at one point of the loop (0 to 1). */
export function palStagePose(phase: number, level: number) {
  const t = phase * TAU;
  return {
    cam: [9 * Math.sin(t), 3 * Math.sin(2 * t)] as const,
    turn: [
      12 * Math.sin(t + 0.6) + 3 * Math.sin(3 * t),
      4 * Math.sin(2 * t + 0.3) + 5 * level,
      0.05 * Math.sin(t + 1.2) + 0.015 * Math.sin(4 * t),
    ] as const,
    blink: Math.min(1, 1.6 * Math.max(pulse(phase, 0.31, 0.03), pulse(phase, 0.79, 0.03))),
    breath: 0.012 * Math.sin(3 * t),
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("No shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader");
  return shader;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load ${src}`));
    image.src = src;
  });
}

const vec4 = (e: PalStageEllipse) => [e.cx, e.cy, e.rx, e.ry];

/**
 * @public Rendered by the Remotion entry that scripts/pubpal/render-pal-stage.mjs
 * writes fresh on each run, so no committed file imports it.
 */
export default function PalStage({ slug, voice = [] }: PalStageProps) {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<[HTMLImageElement, HTMLImageElement] | null>(null);
  const [handle] = useState(() => delayRender(`Pal art for ${slug}`));
  const rig = PAL_STAGE_RIGS[slug];

  useEffect(() => {
    const { master, talk } = palStageImages(slug);
    Promise.all([loadImage(staticFile(master)), loadImage(staticFile(talk))])
      .then((loaded) => {
        setImages(loaded);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle, slug]);

  const program = useRef<{ gl: WebGLRenderingContext; program: WebGLProgram } | null>(null);
  const setup = useCallback(() => {
    if (program.current || !canvas.current || !images) return program.current;
    const gl = canvas.current.getContext("webgl", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL is not available");
    const linked = gl.createProgram();
    gl.attachShader(linked, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(linked, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(linked);
    gl.useProgram(linked);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(linked, "corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    images.forEach((image, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    });
    gl.uniform1i(gl.getUniformLocation(linked, "base"), 0);
    gl.uniform1i(gl.getUniformLocation(linked, "talk"), 1);
    const bumps = Array.from({ length: MAX_BUMPS }, (_, i) => rig.bumps[i]);
    gl.uniform4fv(
      gl.getUniformLocation(linked, "bumps"),
      bumps.flatMap((bump) => (bump ? vec4(bump) : [0, 0, 1, 1])),
    );
    gl.uniform1fv(gl.getUniformLocation(linked, "lifts"), bumps.map((bump) => bump?.lift ?? 0));
    gl.uniform4fv(gl.getUniformLocation(linked, "head"), vec4(rig.head));
    gl.uniform2f(gl.getUniformLocation(linked, "neck"), rig.neck.x, rig.neck.y);
    gl.uniform4fv(gl.getUniformLocation(linked, "eyeA"), vec4(rig.eyes[0]));
    gl.uniform4fv(gl.getUniformLocation(linked, "eyeB"), vec4(rig.eyes[1]));
    gl.uniform4fv(gl.getUniformLocation(linked, "mouth"), vec4(rig.mouth));
    program.current = { gl, program: linked };
    return program.current;
  }, [images, rig]);

  useLayoutEffect(() => {
    const ready = setup();
    if (!ready) return;
    const { gl, program: linked } = ready;
    const level = voice[frame] ?? 0;
    const pose = palStagePose(frame / durationInFrames, level);
    const at = (name: string) => gl.getUniformLocation(linked, name);
    gl.viewport(0, 0, width, width);
    gl.uniform1f(at("side"), width);
    gl.uniform2f(at("cam"), pose.cam[0], pose.cam[1]);
    gl.uniform3f(at("turn"), pose.turn[0], pose.turn[1], pose.turn[2]);
    gl.uniform1f(at("blink"), pose.blink);
    gl.uniform1f(at("breath"), pose.breath);
    gl.uniform1f(at("speak"), rig.mouthOpensWithVoice ? level : 1 - level);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [durationInFrames, frame, rig, setup, voice, width]);

  return (
    <AbsoluteFill style={{ background: "#05070a" }}>
      <canvas ref={canvas} width={width} height={width} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
}
