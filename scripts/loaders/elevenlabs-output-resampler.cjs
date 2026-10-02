// Backport elevenlabs/packages#1002/#1003 for the locked client 1.26.0.
// This loader changes build input in memory, never the installed package.
// Remove both bundler rules and this file once a released SDK forwards the
// output path and the real setup regression passes without the backport.
const { createHash } = process.getBuiltinModule("node:crypto");

const BROKEN_SETUP_SHA = "802601c2bd79c5467e134ba447c7d584e7138d3cbe9c6d7a6a0a15eac4322d58";
const BACKPORTED_SETUP_SHA = "870f71e5b83ae6c934359f47ea878136db61ce7af8c0b1bf0819cb564615eafa";
const OUTPUT_SETUP = "        MediaDeviceOutput.create({\n            ...connection.outputFormat,\n            outputDeviceId: options.outputDeviceId,\n            workletPaths: options.workletPaths,\n            audioContext: audioContext ?? undefined,\n        }),";
const FORWARDED_OUTPUT_SETUP = "        MediaDeviceOutput.create({\n            ...connection.outputFormat,\n            outputDeviceId: options.outputDeviceId,\n            workletPaths: options.workletPaths, libsampleratePath: options.libsampleratePath,\n            audioContext: audioContext ?? undefined,\n        }),";

module.exports = function elevenlabsOutputResampler(source) {
  const path = this.resourcePath.replace(/\\/g, "/");
  if (!path.endsWith("/node_modules/@elevenlabs/client/dist/platform/web/VoiceSessionSetup.js")) {
    throw new Error("ElevenLabs output backport matched an unexpected module.");
  }
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest === BACKPORTED_SETUP_SHA) return source;
  if (digest !== BROKEN_SETUP_SHA || source.split(OUTPUT_SETUP).length !== 2) {
    throw new Error("ElevenLabs setup changed. Review the released output path and remove or renew its scoped backport.");
  }
  return source.replace(OUTPUT_SETUP, FORWARDED_OUTPUT_SETUP);
};
