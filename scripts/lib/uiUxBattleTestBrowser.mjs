export const UI_UX_CHROMIUM_ARGS = Object.freeze([
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
]);

export function uiUxChromiumLaunchOptions(channel) {
  if (channel !== undefined && channel !== "chrome") {
    throw new Error("UI_UX_BROWSER_CHANNEL must be chrome when set");
  }
  return {
    headless: true,
    ...(channel ? { channel } : {}),
    args: UI_UX_CHROMIUM_ARGS,
  };
}

export function isLocalUiUxAuditOrigin(originUrl) {
  const hostname = new URL(originUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function uiUxAuditContextOptions(originUrl) {
  return isLocalUiUxAuditOrigin(originUrl) ? {} : { reducedMotion: "reduce" };
}

export function uiUxChromiumProjectUse(channel) {
  const options = uiUxChromiumLaunchOptions(channel);
  return {
    ...(options.channel ? { channel: options.channel } : {}),
    launchOptions: { args: options.args },
  };
}
