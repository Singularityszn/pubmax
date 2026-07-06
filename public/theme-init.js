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
})();
