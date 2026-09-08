// H.264 sections 7.3.2.1, 7.3.2.2 and Annex E. This checks headers, not decoded pictures.
const invalid = (): never => { throw new Error("Video parameter sets are damaged or unsupported."); };

class Bits {
  private at = 0;
  constructor(private readonly data: Uint8Array) {}
  read(count: number): number {
    if (this.at + count > this.data.length * 8) invalid();
    let value = 0;
    for (let i = 0; i < count; i++, this.at++) value = value * 2 + ((this.data[this.at >> 3] >> (7 - (this.at & 7))) & 1);
    return value;
  }
  ue(max = 0x7fffffff): number {
    let zeros = 0;
    while (!this.read(1)) if (++zeros > 30) invalid();
    const value = 2 ** zeros - 1 + this.read(zeros);
    if (value > max) invalid();
    return value;
  }
  se(min: number, max: number): number {
    const code = this.ue();
    const value = code & 1 ? (code + 1) / 2 : -code / 2;
    if (value < min || value > max) invalid();
    return value;
  }
  more(): boolean {
    const held = this.at;
    const remaining = this.data.length * 8 - held;
    if (!remaining) return invalid();
    const trailing = remaining <= 8 && this.read(remaining) === 2 ** (remaining - 1);
    this.at = held;
    return !trailing;
  }
  finish(): void {
    if (this.more()) invalid();
  }
}

function rbsp(nal: Uint8Array, type: number): Uint8Array {
  if (nal.length < 2 || (nal[0] & 159) !== type || !(nal[0] & 96)) invalid();
  const result: number[] = [];
  let zeros = 0;
  for (let i = 1; i < nal.length; i++) {
    const value = nal[i];
    if (zeros === 2) {
      if (value === 3) {
        if (i + 1 >= nal.length || nal[i + 1] > 3) invalid();
        zeros = 0;
        continue;
      }
      if (value < 3) invalid();
    }
    result.push(value);
    zeros = value === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(result);
}

function scalingLists(bits: Bits, count: number): void {
  for (let i = 0; i < count; i++) {
    if (!bits.read(1)) continue;
    let last = 8, next = 8;
    for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
      if (next) next = (last + bits.se(-128, 127) + 256) % 256;
      if (next) last = next;
    }
  }
}

function hrd(bits: Bits): void {
  const count = bits.ue(31) + 1;
  bits.read(8);
  for (let i = 0; i < count; i++) { bits.ue(); bits.ue(); bits.read(1); }
  bits.read(20);
}

function vui(bits: Bits, refs: number): void {
  if (bits.read(1)) {
    const ratio = bits.read(8);
    if (ratio === 255) { if (!bits.read(16) || !bits.read(16)) invalid(); }
    else if (ratio > 16) invalid();
  }
  if (bits.read(1)) bits.read(1);
  if (bits.read(1)) {
    if (bits.read(3) > 5) invalid();
    bits.read(1);
    if (bits.read(1)) bits.read(24);
  }
  if (bits.read(1)) { bits.ue(5); bits.ue(5); }
  if (bits.read(1)) {
    if (!bits.read(32) || !bits.read(32)) invalid();
    bits.read(1);
  }
  const nalHrd = bits.read(1);
  if (nalHrd) hrd(bits);
  const vclHrd = bits.read(1);
  if (vclHrd) hrd(bits);
  if (nalHrd || vclHrd) bits.read(1);
  bits.read(1);
  if (bits.read(1)) {
    bits.read(1);
    bits.ue(16); bits.ue(16); bits.ue(16); bits.ue(16);
    const reorder = bits.ue(16), buffering = bits.ue(16);
    if (reorder > buffering || refs > buffering) invalid();
  }
}

type Sps = { id: number; width: number; height: number; profile: number; macroblocks: number };

function dimensions(bits: Bits, maxDimension: number) {
  const codedWidth = (bits.ue(119) + 1) * 16;
  const mapHeight = bits.ue(119) + 1;
  const frameOnly = bits.read(1);
  if (!frameOnly) bits.read(1);
  bits.read(1);
  const codedHeight = mapHeight * 16 * (2 - frameOnly);
  let width = codedWidth, height = codedHeight;
  if (bits.read(1)) {
    width -= (bits.ue(960) + bits.ue(960)) * 2;
    height -= (bits.ue(960) + bits.ue(960)) * 2 * (2 - frameOnly);
  }
  if (width <= 0 || height <= 0 || codedWidth > maxDimension || codedHeight > maxDimension) invalid();
  return { width, height, macroblocks: codedWidth * codedHeight / 256 };
}

function sequence(nal: Uint8Array, maxDimension: number): Sps {
  const bits = new Bits(rbsp(nal, 7));
  const profile = bits.read(8);
  if (![66, 77, 88, 100].includes(profile) || (bits.read(8) & 3)) invalid();
  if (![9, 10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62].includes(bits.read(8))) invalid();
  const id = bits.ue(31);
  if (profile === 100) {
    // The release accepts 8-bit 4:2:0. Other formats require a different browser contract.
    if (bits.ue(3) !== 1 || bits.ue(6) !== 0 || bits.ue(6) !== 0) invalid();
    bits.read(1);
    if (bits.read(1)) scalingLists(bits, 8);
  }
  bits.ue(12);
  const order = bits.ue(2);
  if (order === 0) bits.ue(12);
  if (order === 1) {
    bits.read(1); bits.se(-0x7fffffff, 0x7fffffff); bits.se(-0x7fffffff, 0x7fffffff);
    const count = bits.ue(255);
    for (let i = 0; i < count; i++) bits.se(-0x7fffffff, 0x7fffffff);
  }
  const refs = bits.ue(16);
  bits.read(1);
  const size = dimensions(bits, maxDimension);
  if (bits.read(1)) vui(bits, refs);
  bits.finish();
  return { id, profile, ...size };
}

function picture(nal: Uint8Array, sequences: Map<number, Sps>): { id: number; sps: Sps } {
  const bits = new Bits(rbsp(nal, 8));
  const id = bits.ue(255);
  const sps = sequences.get(bits.ue(31)) ?? invalid();
  bits.read(2);
  // Flexible macroblock ordering is outside this bounded browser upload format.
  if (bits.ue(7) !== 0) invalid();
  bits.ue(31); bits.ue(31); bits.read(1);
  if (bits.read(2) > 2) invalid();
  bits.se(-26, 25); bits.se(-26, 25); bits.se(-12, 12);
  bits.read(3);
  if (bits.more()) {
    const transform = bits.read(1);
    if (transform && sps.profile !== 100) invalid();
    if (bits.read(1)) scalingLists(bits, 6 + 2 * transform);
    bits.se(-12, 12);
  }
  bits.finish();
  return { id, sps };
}

export function inspectSocialAvc(config: Uint8Array, width: number, height: number, maxDimension: number) {
  if (config.length < 7 || config[0] !== 1 || (config[4] & 252) !== 252 || (config[5] & 224) !== 224) invalid();
  const nalLength = (config[4] & 3) + 1;
  if (nalLength === 3) invalid();
  const sequences = new Map<number, Sps>();
  const pictures = new Map<number, Sps>();
  let at = 6;
  const next = () => {
    if (at + 2 > config.length) return invalid();
    const size = config[at] * 256 + config[at + 1]; at += 2;
    if (!size || size > 4096 || at + size > config.length) return invalid();
    const nal = config.subarray(at, at + size); at += size;
    return nal;
  };
  const count = config[5] & 31;
  if (!count) invalid();
  for (let i = 0; i < count; i++) {
    const nal = next();
    const sps = sequence(nal, maxDimension);
    if (sps.width !== width || sps.height !== height || sequences.has(sps.id)) invalid();
    if (nal[1] !== config[1] || nal[2] !== config[2] || nal[3] !== config[3]) invalid();
    sequences.set(sps.id, sps);
  }
  if (at >= config.length) invalid();
  const ppsCount = config[at++];
  if (!ppsCount) invalid();
  for (let i = 0; i < ppsCount; i++) {
    const pps = picture(next(), sequences);
    if (pictures.has(pps.id)) invalid();
    pictures.set(pps.id, pps.sps);
  }
  if (at < config.length) {
    // Optional High-profile avcC extension, with no sequence parameter set extensions.
    if (config[1] !== 100 || config.length - at !== 4 || config[at] !== 253 || config[at + 1] !== 248 || config[at + 2] !== 248 || config[at + 3] !== 0) invalid();
  }
  return { nalLength, pictures };
}

export function inspectSocialAvcSlice(nal: Uint8Array, pictures: Map<number, Sps>): void {
  // Only the leading slice fields are needed to bind every picture to a checked SPS.
  // The header prefix cannot consume more than 96 bits; do not copy a whole coded picture.
  const prefix = nal.subarray(1, Math.min(nal.length, 32));
  const unescaped: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    if (i >= 2 && prefix[i] === 3 && prefix[i - 1] === 0 && prefix[i - 2] === 0) continue;
    unescaped.push(prefix[i]);
  }
  const bits = new Bits(Uint8Array.from(unescaped));
  const first = bits.ue(14_399);
  bits.ue(9);
  const sps = pictures.get(bits.ue(255)) ?? invalid();
  if (first >= sps.macroblocks) invalid();
}
