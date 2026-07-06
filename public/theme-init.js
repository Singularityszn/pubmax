// No-flash theme init. Runs before paint so the page never flashes the wrong
// theme. Served as a static file (covered by CSP `script-src 'self'`) instead of
// an inline <script>, so it needs no per-build hash. Keep in sync with the
// ThemeToggle storage key ("pubmax-theme").
(function () {
  try {
    var t = localStorage.getItem("pubmax-theme");
    if (t !== "light" && t !== "dark") {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}

  // Legacy Mode: larger type / higher contrast / stronger focus rings / forced
  // reduced motion, for older and low-vision users (issue #28). Same no-flash
  // pattern as the theme above — read before paint so there is no flash of
  // small/low-contrast type before this attribute lands. Keep in sync with the
  // LegacyToggle storage key ("pubmax-legacy").
  try {
    var legacy = localStorage.getItem("pubmax-legacy");
    if (legacy === "1") {
      document.documentElement.dataset.legacy = "1";
    }
  } catch (e) {}
})();
