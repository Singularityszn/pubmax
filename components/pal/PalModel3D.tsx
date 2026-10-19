"use client";

import { useEffect, useRef } from "react";
import type { PalAnimationState, PubPalSpecies } from "@/lib/pubPal";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";
import { palHeadTarget } from "./usePalHead3D";
import { palModelParts, palModelSphere } from "./palModelGeometry";

const VERTEX = `#version 300 es
in vec3 position;
in vec3 normal;
uniform vec3 centre;
uniform vec3 size;
uniform vec2 turn;
uniform float aspect;
out vec3 N;
out vec3 P;
void main() {
  float cy=cos(turn.x), sy=sin(turn.x), cx=cos(turn.y), sx=sin(turn.y);
  mat3 rotation=mat3(cy,0.,-sy, sy*sx,cx,cy*sx, sy*cx,-sx,cy*cx);
  P=rotation*(position*size+centre);
  N=normalize(rotation*(normal/size));
  float depth=4.8-P.z;
  gl_Position=vec4(P.x*2.7/aspect,(P.y-.15)*2.7,-P.z*.15,depth);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 N;
in vec3 P;
uniform vec3 colour;
uniform float glow;
out vec4 pixel;
void main() {
  vec3 n=normalize(N);
  float light=max(0.,dot(n,normalize(vec3(-.6,1.,1.4))));
  float rim=pow(1.-max(0.,n.z),3.);
  float grain=fract(sin(dot(P.xy*270.,vec2(12.9898,78.233)))*43758.5453);
  vec3 lit=colour*(.52+light*.8+grain*.08)+vec3(.05,.12,.15)*rim+colour*glow;
  pixel=vec4(pow(lit,vec3(1./2.2)),1.);
}`;

export default function PalModel3D({ species, state, signal }: {
  species: PubPalSpecies; state: PalAnimationState; signal?: PalVoiceSignal;
}) {
  const host = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = host.current;
    if (!canvas) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let raf = 0, visible = true, last = 0, pointerX = 0, pointerY = 0;
    let yaw = 0, pitch = 0;
    const hide = () => { canvas.removeAttribute("data-model-ready"); };
    try {
      program = gl.createProgram();
      if (!program) return;
      for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
        const shader = gl.createShader(kind);
        if (!shader) throw new Error("No shader");
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Shader unavailable");
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Model unavailable");
      gl.useProgram(program);
      buffer = gl.createBuffer();
      if (!buffer) throw new Error("No geometry buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const vertices = palModelSphere();
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      for (const [name, offset] of [["position", 0], ["normal", 12]] as const) {
        const attribute = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 24, offset);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      const uniforms = Object.fromEntries(["centre", "size", "colour", "glow", "turn", "aspect"].map((name) => [name, gl.getUniformLocation(program!, name)]));
      const parts = palModelParts(species);
      const draw = (now: number) => {
        raf = 0;
        if (!visible || document.hidden || motion.matches || gl.isContextLost()) return;
        if (now - last >= 1000 / 30) {
          last = now;
          const box = canvas.getBoundingClientRect();
          const ratio = Math.min(devicePixelRatio || 1, 1.5);
          const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          gl.viewport(0, 0, width, height);
          const levels = signal?.read();
          const current = stateRef.current;
          const mode = levels?.mode !== "idle" && levels?.mode ? levels.mode : current === "speaking" || current === "listening" ? current : "idle";
          const pose = palHeadTarget({ t: now / 1000, pointerX, pointerY, mode, state: current, heard: levels?.input ?? 0, spoken: levels?.output ?? 0 });
          yaw += (pose.yaw * Math.PI / 180 - yaw) * .15;
          pitch += (pose.pitch * Math.PI / 180 - pitch) * .15;
          gl.uniform2f(uniforms.turn!, yaw, pitch);
          gl.uniform1f(uniforms.aspect!, width / height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          const blink = current === "sleeping" ? .12 : now % 4700 < 120 ? .18 : 1;
          for (const part of parts) {
            gl.uniform3fv(uniforms.centre!, part.centre);
            gl.uniform3f(uniforms.size!, part.scale[0], part.scale[1] * (part.eye ? blink : 1), part.scale[2]);
            gl.uniform3fv(uniforms.colour!, part.colour);
            gl.uniform1f(uniforms.glow!, part.glow);
            gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
          }
          if (!canvas.hasAttribute("data-model-ready") && gl.getError() === gl.NO_ERROR) canvas.setAttribute("data-model-ready", "true");
        }
        raf = requestAnimationFrame(draw);
      };
      const stop = () => { cancelAnimationFrame(raf); raf = 0; };
      const resume = () => { if (!raf && visible && !document.hidden && !motion.matches) raf = requestAnimationFrame(draw); };
      const visibility = () => document.hidden ? stop() : resume();
      const changedMotion = () => { if (motion.matches) { stop(); hide(); } else resume(); };
      const pointer = (event: PointerEvent) => {
        const box = canvas.getBoundingClientRect();
        pointerX = Math.max(-1, Math.min(1, (event.clientX - box.left - box.width / 2) / box.width));
        pointerY = Math.max(-1, Math.min(1, (event.clientY - box.top - box.height / 2) / box.height));
      };
      const leave = () => { pointerX = 0; pointerY = 0; };
      const lost = () => { stop(); hide(); };
      const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; if (visible) resume(); else stop(); });
      observer.observe(canvas);
      canvas.addEventListener("pointermove", pointer, { passive: true });
      canvas.addEventListener("pointerleave", leave);
      canvas.addEventListener("webglcontextlost", lost);
      document.addEventListener("visibilitychange", visibility);
      motion.addEventListener("change", changedMotion);
      resume();
      return () => {
        stop(); hide(); observer.disconnect();
        canvas.removeEventListener("pointermove", pointer);
        canvas.removeEventListener("pointerleave", leave);
        canvas.removeEventListener("webglcontextlost", lost);
        document.removeEventListener("visibilitychange", visibility);
        motion.removeEventListener("change", changedMotion);
        gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach((shader) => gl.deleteShader(shader));
      };
    } catch {
      hide();
      gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }, [species, signal]);
  return <canvas ref={host} className="palModelCanvas" aria-hidden="true" />;
}
