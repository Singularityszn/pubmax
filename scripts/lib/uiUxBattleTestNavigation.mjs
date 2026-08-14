export const AUDITED_ORIGINS = [
  { name: "live", url: "https://pubmaxxing.com" },
  { name: "local", url: "http://127.0.0.1:3000" },
];

export const AUDITED_ROUTES = [
  { name: "home", path: "/", readySelector: "main#main", waitForAuthChrome: true },
  {
    name: "today",
    path: "/today",
    readySelector: '[data-testid="today-screen"]',
    waitForAuthChrome: true,
  },
  {
    name: "tonight",
    path: "/tonight",
    readySelector: '[data-testid="tonight-screen"]',
    pendingTexts: ["Reading tonight’s listings…"],
    waitForAuthChrome: true,
  },
  { name: "near", path: "/near", readySelector: ".nmnIntro", waitForAuthChrome: true },
  {
    name: "add",
    path: "/add/karan",
    readySelector: "main.addShell",
    waitForAuthChrome: true,
  },
  {
    name: "login",
    path: "/login",
    readySelector:
      ".loginPageForm, .loginPageSignedIn, .loginPageWelcomeBack, .loginPageNotice:not(:has-text('Checking your session'))",
  },
  {
    name: "profile",
    path: "/u/karan",
    readySelector: "main.profileMain",
    pendingSelectors: [".profileTimelineSkel", ".profileHeaderLoading"],
    waitForAuthChrome: true,
  },
  {
    name: "map",
    path: "/map/london",
    readySelector: ".mapCanvasWrap:not(.mapCanvasSkeleton)",
    pendingSelectors: ["main.mapSkeleton", ".mapLoading"],
  },
  {
    name: "plan",
    path: "/plan",
    readySelector: "main.planPage h1",
    waitForAuthChrome: true,
  },
  {
    name: "crawls",
    path: "/crawls",
    readySelector: "main.crawlsShell:not([aria-busy='true'])",
    waitForAuthChrome: true,
  },
];

function selectAuditValues(filter, values, environmentName, noun, matches) {
  if (filter === undefined) return values;

  const requested = filter.split(",").map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new Error(`${environmentName} must select at least one ${noun}`);
  }

  const unknown = requested.filter((value) => !values.some((candidate) => matches(candidate, value)));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${environmentName} value: ${unknown.join(", ")}`);
  }

  const selected = values.filter((candidate) => requested.some((value) => matches(candidate, value)));
  if (selected.length === 0) {
    throw new Error(`${environmentName} must select at least one ${noun}`);
  }
  return selected;
}

export function selectAuditedOrigins(filter) {
  return selectAuditValues(filter, AUDITED_ORIGINS, "UI_UX_ORIGINS", "origin", (origin, value) =>
    origin.name === value,
  );
}

export function selectAuditedRoutes(filter) {
  return selectAuditValues(filter, AUDITED_ROUTES, "UI_UX_ROUTES", "route", (route, value) =>
    route.name === value || route.path === value,
  );
}

export async function navigateToAuditedRoute(page, originUrl, route, timeout = 30_000) {
  const url = new URL(route.path, originUrl).href;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  if (!response) {
    throw new Error(`Navigation produced no HTTP response for ${url}`);
  }
  if (!response.ok()) {
    throw new Error(`Navigation returned HTTP ${response.status()} for ${url}`);
  }

  await page.locator(route.readySelector).first().waitFor({ state: "visible", timeout });
  for (const selector of route.pendingSelectors ?? []) {
    await page.locator(selector).waitFor({ state: "hidden", timeout });
  }
  for (const text of route.pendingTexts ?? []) {
    await page.getByText(text).waitFor({ state: "hidden", timeout });
  }
  if (route.waitForAuthChrome) {
    await page.locator(".authUser").first().waitFor({ state: "attached", timeout });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    const settlingAnimations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      const duration = Number(timing?.duration);
      const delay = Number(timing?.delay);
      const iterations = Number(timing?.iterations);
      const totalDuration = (duration + delay) * iterations;
      return animation.playState === "running" && Number.isFinite(totalDuration) && totalDuration <= 2_000;
    });
    await Promise.allSettled(settlingAnimations.map((animation) => animation.finished));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
