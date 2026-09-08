import { describe, expect, it } from "vitest";
import { inspectSocialAvc, inspectSocialAvcSlice } from "@/lib/socialAvc";
import { SOCIAL_VIDEO_MAX_DIMENSION } from "@/lib/socialMediaPolicy";

const ue = (value: number) => {
  const binary = (value + 1).toString(2);
  return "0".repeat(binary.length - 1) + binary;
};
const nal = (type: number, fields: string) => {
  const bits = (fields + "1").padEnd(Math.ceil((fields.length + 1) / 8) * 8, "0");
  const data = [0x60 | type];
  let zeros = 0;
  for (let i = 0; i < bits.length; i += 8) {
    const value = parseInt(bits.slice(i, i + 8), 2);
    if (zeros === 2 && value <= 3) { data.push(3); zeros = 0; }
    data.push(value);
    zeros = value === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(data);
};
function sps(width = 20, height = 15, cropRight = 0) {
  const header = "01000010" + "00000000" + "00011110";
  const ordering = ue(0) + ue(0) + ue(0) + ue(0) + ue(1) + "0";
  const crop = cropRight ? "1" + ue(0) + ue(cropRight) + ue(0) + ue(0) : "0";
  return nal(7, header + ordering + ue(width - 1) + ue(height - 1) + "11" + crop + "0");
}
function pps(spsId = 0, ppsId = 0) {
  return nal(8, ue(ppsId) + ue(spsId) + "00" + ue(0) + ue(0) + ue(0) + "000" + ue(0) + ue(0) + ue(0) + "100");
}
function config(sequence = sps(), picture = pps()) {
  const entry = (data: Uint8Array) => [data.length >> 8, data.length & 255, ...data];
  return Uint8Array.from([1, 66, 0, 30, 255, 225, ...entry(sequence), 1, ...entry(picture)]);
}
const inspect = (data: Uint8Array, width = 320, height = 240) => inspectSocialAvc(data, width, height, SOCIAL_VIDEO_MAX_DIMENSION);

describe("bounded AVC parameter set syntax", () => {
  it("reads complete SPS/PPS syntax and binds slice references", () => {
    const result = inspect(config());
    expect(result.pictures.get(0)).toMatchObject({ width: 320, height: 240, macroblocks: 300 });
    expect(() => inspectSocialAvcSlice(nal(5, ue(0) + ue(2) + ue(0)), result.pictures)).not.toThrow();
    expect(() => inspectSocialAvcSlice(nal(5, ue(0) + ue(2) + ue(1)), result.pictures)).toThrow();
    expect(() => inspectSocialAvcSlice(nal(5, ue(300) + ue(2) + ue(0)), result.pictures)).toThrow();
  });
  it("rejects missing SPS references and truncated PPS syntax", () => {
    expect(() => inspect(config(sps(), pps(1)))).toThrow();
    expect(() => inspect(config(sps(), nal(8, ue(0) + ue(0))))).toThrow();
    const bad = pps(); bad[bad.length - 1] = 0;
    expect(() => inspect(config(sps(), bad))).toThrow();
  });
  it("rejects truncated SPS fields, illegal emulation prevention, and unterminated Golomb codes", () => {
    const sequence = sps();
    for (let size = 1; size < sequence.length; size++) {
      expect(() => inspect(config(sequence.subarray(0, size)))).toThrow();
    }
    expect(() => inspect(config(Uint8Array.from([103, 66, 0, 30, 0, 0, 3])))).toThrow();
    expect(() => inspect(config(Uint8Array.from([103, 66, 0, 30, ...new Uint8Array(4090)])))).toThrow();
  });
  it("enforces coded and cropped dimensions independently of sample-entry claims", () => {
    expect(() => inspect(config(sps(120, 120)), 1920, 1920)).not.toThrow();
    expect(() => inspect(config(sps(121, 15)), 1936, 240)).toThrow();
    expect(() => inspect(config(sps(121, 15, 8)), 1920, 240)).toThrow();
    expect(() => inspect(config(sps(20, 121)), 320, 1936)).toThrow();
    expect(() => inspect(config(sps(20, 15, 160)), 0, 240)).toThrow();
    expect(() => inspect(config(), 1, 1)).toThrow();
  });
});
