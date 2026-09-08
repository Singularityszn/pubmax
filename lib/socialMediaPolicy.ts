import { inspectSocialAvc, inspectSocialAvcSlice } from "@/lib/socialAvc";
import { UPLOAD_PHOTO_MAX_BYTES, UPLOAD_FIELDS_ALLOWANCE_BYTES } from "@/lib/uploadBodyLimit";

export const SOCIAL_VIDEO_MAX_BYTES = UPLOAD_PHOTO_MAX_BYTES;
export const SOCIAL_MEDIA_BODY_MAX_BYTES = SOCIAL_VIDEO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES;
export const SOCIAL_VIDEO_MAX_SECONDS = 15;
export const SOCIAL_VIDEO_MAX_DIMENSION = 1_920;
export const SOCIAL_VIDEO_ACCEPT = "video/mp4";
export type SocialMediaKind = "photo" | "video";
export type SocialMediaContentType = "image/jpeg" | "video/mp4";
export const SOCIAL_VIDEO_REQUIREMENTS = "MP4 video, H.264 with optional AAC-LC audio, up to 15 seconds and 4 MB, at most 1920 pixels per side.";

export function socialMediaMetadata(contentType: SocialMediaContentType): {
  kind: SocialMediaKind; contentType: SocialMediaContentType;
} {
  return { kind: contentType === "video/mp4" ? "video" : "photo", contentType };
}

export function socialMediaFileName(contentType: SocialMediaContentType): string {
  return contentType === "video/mp4" ? "video.mp4" : "image.jpg";
}

type Box = { type: string; start: number; end: number };
export type SocialVideoInfo = { width: number; height: number; durationSeconds: number };

/** Validate a self-contained, non-fragmented AVC MP4. No decoding or transcoding is claimed. */
export function inspectSocialVideo(bytes: Uint8Array): SocialVideoInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (): never => { throw new Error("Video is damaged or unsupported. " + SOCIAL_VIDEO_REQUIREMENTS); };
  if (!bytes.length || bytes.length > SOCIAL_VIDEO_MAX_BYTES) fail();
  let boxCount = 0;
  const u32 = (at: number, end: number) => {
    if (at < 0 || at + 4 > end) return fail();
    return view.getUint32(at);
  };
  const u16 = (at: number, end: number) => {
    if (at + 2 > end) return fail();
    return view.getUint16(at);
  };
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      if (++boxCount > 10_000 || start + 8 > end) fail();
      let size = u32(start, end);
      let header = 8;
      if (size === 1) {
        if (u32(start + 8, end) !== 0) fail();
        size = u32(start + 12, end); header = 16;
      }
      if (size === 0) size = end - start;
      if (size < header || start + size > end) fail();
      result.push({ type: text(start + 4), start: start + header, end: start + size });
      start += size;
    }
    return result;
  };
  const one = (items: Box[], type: string): Box => {
    const found = items.filter((item) => item.type === type);
    return found.length === 1 ? found[0] : fail();
  };
  const child = (parent: Box, type: string) => one(boxes(parent.start, parent.end), type);
  const duration = (box: Box) => {
    const version = bytes[box.start];
    if (version !== 0 && version !== 1) fail();
    const scaleAt = box.start + (version === 1 ? 20 : 12);
    const scale = u32(scaleAt, box.end);
    if (version === 1 && u32(scaleAt + 4, box.end) !== 0) fail();
    const ticks = u32(scaleAt + (version === 1 ? 8 : 4), box.end);
    const seconds = ticks / scale;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > SOCIAL_VIDEO_MAX_SECONDS) fail();
    return { seconds, ticks, scale };
  };
  const top = boxes(0, bytes.length);
  if (top.some((box) => !["ftyp", "moov", "mdat", "free", "wide", "skip", "udta", "meta", "uuid"].includes(box.type))) fail();
  const ftyp = one(top, "ftyp");
  if (ftyp.end - ftyp.start < 8 || (ftyp.end - ftyp.start) % 4) fail();
  const brands = [text(ftyp.start)];
  for (let at = ftyp.start + 8; at < ftyp.end; at += 4) brands.push(text(at));
  if (!brands.some((brand) => ["isom", "iso2", "mp41", "mp42", "avc1"].includes(brand))) fail();
  const moov = one(top, "moov");
  const mdat = top.filter((box) => box.type === "mdat");
  if (!mdat.length || boxes(moov.start, moov.end).some((box) => box.type === "mvex")) fail();
  const movieDuration = duration(child(moov, "mvhd")).seconds;
  const tracks = boxes(moov.start, moov.end).filter((box) => box.type === "trak");
  if (!tracks.length || tracks.length > 2) fail();
  let video: SocialVideoInfo | null = null;
  let audio = false;
  let avc: ReturnType<typeof inspectSocialAvc> | null = null;
  const intervals: Array<[number, number]> = [];
  function inspectTrack(track: Box) {
    const mdia = child(track, "mdia");
    const hdlr = child(mdia, "hdlr");
    u32(hdlr.start + 8, hdlr.end);
    const handler = text(hdlr.start + 8);
    if (handler !== "vide" && handler !== "soun") fail();
    const timing = duration(child(mdia, "mdhd"));
    const minf = child(mdia, "minf");
    const dref = child(child(minf, "dinf"), "dref");
    if (u32(dref.start + 4, dref.end) !== 1) fail();
    const url = one(boxes(dref.start + 8, dref.end), "url ");
    if (u32(url.start, url.end) !== 1 || url.end !== url.start + 4) fail();
    const stbl = child(minf, "stbl");
    const tables = boxes(stbl.start, stbl.end);
    const stsd = one(tables, "stsd");
    if (u32(stsd.start + 4, stsd.end) !== 1) fail();
    const entries = boxes(stsd.start + 8, stsd.end);
    if (entries.length !== 1) fail();
    const entry = entries[0];
    if (u16(entry.start + 6, entry.end) !== 1) fail();
    let nalLength = 0;
    if (handler === "vide") {
      if (video || entry.type !== "avc1") fail();
      const width = u16(entry.start + 24, entry.end);
      const height = u16(entry.start + 26, entry.end);
      if (!width || !height || width > SOCIAL_VIDEO_MAX_DIMENSION || height > SOCIAL_VIDEO_MAX_DIMENSION) fail();
      const avcc = one(boxes(entry.start + 78, entry.end), "avcC");
      avc = inspectSocialAvc(bytes.subarray(avcc.start, avcc.end), width, height, SOCIAL_VIDEO_MAX_DIMENSION);
      nalLength = avc.nalLength;
      video = { width, height, durationSeconds: Math.max(movieDuration, timing.seconds) };
    } else {
      if (audio || entry.type !== "mp4a" || u16(entry.start + 8, entry.end) !== 0) fail();
      const esds = one(boxes(entry.start + 28, entry.end), "esds");
      const descriptor = (start: number, end: number, tag: number) => {
        if (bytes[start++] !== tag) return fail();
        let length = 0, complete = false;
        for (let n = 0; n < 4 && start < end; n++) {
          const value = bytes[start++];
          length = length * 128 + (value & 127);
          if (!(value & 128)) { complete = true; break; }
        }
        if (!complete || !length || start + length > end) return fail();
        return { start, end: start + length };
      };
      const es = descriptor(esds.start + 4, esds.end, 3);
      let at = es.start + 3;
      if (at > es.end) fail();
      const flags = bytes[es.start + 2];
      if (flags & 128) at += 2;
      if (flags & 64) { if (at >= es.end) fail(); at += 1 + bytes[at]; }
      if (flags & 32) at += 2;
      const decoder = descriptor(at, es.end, 4);
      if (decoder.end - decoder.start < 13 || bytes[decoder.start] !== 0x40 || ((bytes[decoder.start + 1] >> 2) & 63) !== 5) fail();
      const config = descriptor(decoder.start + 13, decoder.end, 5);
      if (config.end - config.start < 2 || bytes[config.start] >> 3 !== 2) fail();
      audio = true;
    }
    inspectSamples(stbl, timing.scale, nalLength);
  }
  function inspectSamples(stbl: Box, timescale: number, nalLength: number) {
    const tables = boxes(stbl.start, stbl.end);
    const stsz = one(tables, "stsz");
    const uniform = u32(stsz.start + 4, stsz.end);
    const count = u32(stsz.start + 8, stsz.end);
    if (!count || count > 10_000 || stsz.end !== stsz.start + 12 + (uniform ? 0 : count * 4)) fail();
    const sizes = Array.from({ length: count }, (_, i) => uniform || u32(stsz.start + 12 + i * 4, stsz.end));
    if (sizes.some((size) => !size)) fail();
    const stts = one(tables, "stts");
    const timeCount = u32(stts.start + 4, stts.end);
    if (!timeCount || timeCount > count || stts.end !== stts.start + 8 + timeCount * 8) fail();
    let samples = 0, ticks = 0;
    for (let i = 0; i < timeCount; i++) {
      const n = u32(stts.start + 8 + i * 8, stts.end);
      const delta = u32(stts.start + 12 + i * 8, stts.end);
      if (!n || !delta) fail();
      samples += n; ticks += n * delta;
    }
    if (samples !== count || ticks / timescale > SOCIAL_VIDEO_MAX_SECONDS) fail();
    const offsets = tables.filter((box) => box.type === "stco" || box.type === "co64");
    if (offsets.length !== 1) fail();
    const offset = offsets[0];
    const stride = offset.type === "co64" ? 8 : 4;
    const chunks = u32(offset.start + 4, offset.end);
    if (!chunks || chunks > count || offset.end !== offset.start + 8 + chunks * stride) fail();
    const stsc = one(tables, "stsc");
    const rules = u32(stsc.start + 4, stsc.end);
    if (!rules || rules > chunks || stsc.end !== stsc.start + 8 + rules * 12) fail();
    const mapping = Array.from({ length: rules }, (_, i) => ({
      first: u32(stsc.start + 8 + i * 12, stsc.end),
      count: u32(stsc.start + 12 + i * 12, stsc.end),
      description: u32(stsc.start + 16 + i * 12, stsc.end),
    }));
    if (mapping[0].first !== 1 || mapping.some((r, i) => !r.count || r.first > chunks || r.description !== 1 || (i > 0 && r.first <= mapping[i - 1].first))) fail();
    let sample = 0, rule = 0;
    for (let chunk = 1; chunk <= chunks; chunk++) {
      if (rule + 1 < rules && mapping[rule + 1].first === chunk) rule++;
      const at = offset.start + 8 + (chunk - 1) * stride;
      if (stride === 8 && u32(at, offset.end) !== 0) fail();
      let position = u32(at + stride - 4, offset.end);
      for (let n = 0; n < mapping[rule].count; n++) {
        if (sample >= count) fail();
        const end = position + sizes[sample++];
        if (!mdat.some((data) => position >= data.start && end <= data.end)) fail();
        intervals.push([position, end]);
        if (nalLength) inspectNalSample(position, end, nalLength);
        position = end;
      }
    }
    if (sample !== count) fail();
  }
  function inspectNalSample(position: number, end: number, nalLength: number) {
    let cursor = position, slice = false;
    while (cursor < end) {
      if (cursor + nalLength >= end) fail();
      let size = 0;
      for (let k = 0; k < nalLength; k++) size = size * 256 + bytes[cursor++];
      if (!size || cursor + size > end || bytes[cursor] & 128) fail();
      const type = bytes[cursor] & 31;
      if (type === 1 || type === 5) {
        if (!avc) return fail();
        inspectSocialAvcSlice(bytes.subarray(cursor, cursor + size), avc.pictures);
        slice = true;
      }
      // avc1 keeps parameter sets in avcC. In-band sets could replace checked dimensions.
      if (![1, 5, 6, 9, 10, 11, 12].includes(type)) fail();
      cursor += size;
    }
    if (!slice) fail();
  }
  for (const track of tracks) inspectTrack(track);
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals.some((range, i) => i > 0 && range[0] < intervals[i - 1][1])) fail();
  return video ?? fail();
}

/** Replace identifying metadata with equal-sized padding, preserving every sample offset. */
export function stripSocialVideoMetadata(input: Uint8Array): Uint8Array {
  const bytes = Uint8Array.from(input);
  const view = new DataView(bytes.buffer);
  const visit = (start: number, end: number, depth: number) => {
    if (depth > 8) throw new Error("Video metadata is nested too deeply.");
    while (start < end) {
      if (start + 8 > end) throw new Error("Video metadata is damaged.");
      let size = view.getUint32(start), header = 8;
      const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
      if (size === 1) {
        if (start + 16 > end || view.getUint32(start + 8) !== 0) throw new Error("Video metadata is damaged.");
        size = view.getUint32(start + 12); header = 16;
      }
      if (!size) size = end - start;
      if (size < header || start + size > end) throw new Error("Video metadata is damaged.");
      if (["udta", "meta", "uuid"].includes(type)) {
        bytes.set([102, 114, 101, 101], start + 4);
        bytes.fill(0, start + header, start + size);
      } else if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) {
        visit(start + header, start + size, depth + 1);
      } else if (type === "mvhd" || type === "tkhd" || type === "mdhd") {
        const times = bytes[start + header] === 1 ? 16 : 8;
        if (start + header + 4 + times > start + size) throw new Error("Video metadata is damaged.");
        bytes.fill(0, start + header + 4, start + header + 4 + times);
      }
      start += size;
    }
  };
  visit(0, bytes.length, 0);
  return bytes;
}
