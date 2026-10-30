// The Pal stage's one WebGL pass, shared by the Remotion composition
// (components/pal/PalStage.tsx) and the live head on /pal
// (components/pal/PalStageCanvas.tsx). It draws nothing new: it moves the
// Pal's 512 master by a depth map built from the rig (lib/palStageRig.ts). The
// head turns, nods and tilts over the body, the body breathes, the eyes blink
// with a lid of the Pal's own fur, and the mouth blends to the talking frame.

import { PAL_STAGE_MAX_BUMPS as MAX_BUMPS, type PalStageEllipse, type PalStageFrame, type PalStageRig } from "@/lib/palStageRig";

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

export type PalStageRenderer = {
  /** Draws one frame at the canvas's current pixel size. */
  draw: (frame: PalStageFrame) => void;
  /** Frees the GPU objects; the canvas can be dropped after. */
  dispose: () => void;
};

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("No shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader");
  return shader;
}

const vec4 = (e: PalStageEllipse) => [e.cx, e.cy, e.rx, e.ry];

/**
 * Sets the stage up on a square canvas, or returns null where WebGL is not
 * available, so the caller keeps showing the still photograph.
 */
export function createPalStageRenderer(
  canvas: HTMLCanvasElement,
  rig: PalStageRig,
  images: readonly [master: TexImageSource, talk: TexImageSource],
  { preserveDrawingBuffer = false }: { preserveDrawingBuffer?: boolean } = {},
): PalStageRenderer | null {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer, alpha: false, antialias: false });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Link");
  gl.useProgram(program);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const textures = images.map((image, unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    return texture;
  });
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(at("base"), 0);
  gl.uniform1i(at("talk"), 1);
  const bumps = Array.from({ length: MAX_BUMPS }, (_, i) => rig.bumps[i]);
  gl.uniform4fv(at("bumps"), bumps.flatMap((bump) => (bump ? vec4(bump) : [0, 0, 1, 1])));
  gl.uniform1fv(at("lifts"), bumps.map((bump) => bump?.lift ?? 0));
  gl.uniform4fv(at("head"), vec4(rig.head));
  gl.uniform2f(at("neck"), rig.neck.x, rig.neck.y);
  gl.uniform4fv(at("eyeA"), vec4(rig.eyes[0]));
  gl.uniform4fv(at("eyeB"), vec4(rig.eyes[1]));
  gl.uniform4fv(at("mouth"), vec4(rig.mouth));
  const uniforms = {
    side: at("side"),
    cam: at("cam"),
    turn: at("turn"),
    blink: at("blink"),
    breath: at("breath"),
    speak: at("speak"),
  };

  return {
    draw(frame) {
      const side = canvas.width;
      gl.viewport(0, 0, side, side);
      gl.uniform1f(uniforms.side, side);
      gl.uniform2f(uniforms.cam, frame.cam[0], frame.cam[1]);
      gl.uniform3f(uniforms.turn, frame.turn[0], frame.turn[1], frame.turn[2]);
      gl.uniform1f(uniforms.blink, frame.blink);
      gl.uniform1f(uniforms.breath, frame.breath);
      gl.uniform1f(uniforms.speak, rig.mouthOpensWithVoice ? frame.mouth : 1 - frame.mouth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      textures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteBuffer(corners);
      gl.deleteProgram(program);
    },
  };
}
