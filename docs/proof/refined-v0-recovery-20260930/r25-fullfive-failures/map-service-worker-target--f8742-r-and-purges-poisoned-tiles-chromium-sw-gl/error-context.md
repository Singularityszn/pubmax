# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-service-worker.spec.ts >> target worker replaces the pre-fix controller and purges poisoned tiles
- Location: e2e/map-service-worker.spec.ts:51:5

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: page.evaluate: Test timeout of 180000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=f3e1]:
  - link "Skip to main content" [ref=f3e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=f3e3]:
    - region "Interactive pub map of London" [ref=f3e4]:
      - generic [ref=f3e6]:
        - region "Map" [ref=f3e7]
        - group [ref=f3e8]:
          - generic "Toggle attribution" [ref=f3e9] [cursor=pointer]
      - generic "Map controls":
        - generic [ref=f3e10]:
          - link "Open PUBMAXX landing page" [ref=f3e11] [cursor=pointer]:
            - /url: /
            - img "PUBMAXX" [ref=f3e12]:
              - generic [ref=f3e14]:
                - generic [ref=f3e15]: PUBMAX
                - generic [ref=f3e16]: X
          - 'button "Map area: London. Change city" [ref=f3e18] [cursor=pointer]':
            - generic [ref=f3e19]: London
          - button "Search the map" [ref=f3e21] [cursor=pointer]
          - button "Filters" [ref=f3e25] [cursor=pointer]
          - button "More map controls" [ref=f3e27] [cursor=pointer]
        - 'button "Drink shown on the map: Pints. Choose another drink" [ref=f3e33] [cursor=pointer]':
          - generic [ref=f3e37]: Pints
      - generic "Map utilities":
        - 'button "TfL live: 8 updates" [ref=f3e38] [cursor=pointer]':
          - generic [ref=f3e46]: "8"
        - button "Near me" [ref=f3e47] [cursor=pointer]
      - button "Describe the outing" [ref=f3e51] [cursor=pointer]:
        - strong [ref=f3e57]: Describe the outing
  - navigation "Primary":
    - list [ref=f3e58]:
      - listitem
      - listitem [ref=f3e59]:
        - link "Tonight" [ref=f3e60] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=f3e68]:
        - link "Map" [ref=f3e69] [cursor=pointer]:
          - /url: /map
      - listitem [ref=f3e75]:
        - link "Places" [ref=f3e76] [cursor=pointer]:
          - /url: /places
      - listitem [ref=f3e82]:
        - link "Out" [ref=f3e83] [cursor=pointer]:
          - /url: /out
      - listitem [ref=f3e90]:
        - link "Plan" [ref=f3e91] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=f3e99]:
        - link "You" [ref=f3e100] [cursor=pointer]:
          - /url: /u/you
  - button "Create" [ref=f3e107] [cursor=pointer]
  - alert [ref=f3e109]
```

# Test source

```ts
  149 |             resolve();
  150 |           }
  151 |         });
  152 |       });
  153 |     }
  154 |     return {
  155 |       active: registration.active?.scriptURL ?? null,
  156 |       controller: navigator.serviceWorker.controller?.scriptURL ?? null,
  157 |       waiting: registration.waiting?.scriptURL ?? null,
  158 |     };
  159 |   }, waitingLegacyUrl);
  160 |   expect(waitingState.active).toBe(activeLegacyController);
  161 |   expect(waitingState.controller).toBe(activeLegacyController);
  162 |   expect(waitingState.waiting).toContain("legacy-waiting-");
  163 | 
  164 |   const poisonedUrl = `${tileUrl}?poisoned-rollout=1`;
  165 |   const legacyState = await page.evaluate(
  166 |     async ({ activeScriptUrl, poisonedTileUrl }) => {
  167 |       const version = new URL(activeScriptUrl).searchParams.get("v");
  168 |       const cacheNames = {
  169 |         data: `pubmax-sw-data-${version}`,
  170 |         plan: `pubmax-sw-plan-${version}`,
  171 |         shell: `pubmax-sw-shell-${version}`,
  172 |         swr: `pubmax-sw-swr-${version}`,
  173 |       };
  174 |       const swr = await caches.open(cacheNames.swr);
  175 |       await swr.put(
  176 |         poisonedTileUrl,
  177 |         new Response("poisoned", {
  178 |           status: 503,
  179 |           headers: { "Content-Type": "application/x-protobuf" },
  180 |         }),
  181 |       );
  182 |       await swr.put(
  183 |         "/_next/static/chunks/legacy-offline.js",
  184 |         new Response("legacy static"),
  185 |       );
  186 |       await (await caches.open(cacheNames.shell)).put(
  187 |         "/offline.html",
  188 |         new Response("legacy shell"),
  189 |       );
  190 |       await (await caches.open(cacheNames.data)).put(
  191 |         "/data/legacy-offline.json",
  192 |         new Response('{"legacy":true}', {
  193 |           headers: { "Content-Type": "application/json" },
  194 |         }),
  195 |       );
  196 |       await (await caches.open(cacheNames.plan)).put(
  197 |         "/plan/legacy-offline",
  198 |         new Response("legacy plan"),
  199 |       );
  200 |       return {
  201 |         all: (await caches.keys()).filter((name) =>
  202 |           name.startsWith("pubmax-sw-"),
  203 |         ),
  204 |         cacheNames,
  205 |       };
  206 |     },
  207 |     {
  208 |       activeScriptUrl: activeLegacyController!,
  209 |       poisonedTileUrl: poisonedUrl,
  210 |     },
  211 |   );
  212 |   expect(
  213 |     legacyState.all.some((name) => name.includes("legacy-waiting-")),
  214 |   ).toBe(true);
  215 | 
  216 |   const cdp = await context.newCDPSession(page);
  217 |   const origin = new URL(page.url()).origin;
  218 |   const usage = await cdp.send("Storage.getUsageAndQuota", { origin });
  219 |   await cdp.send("Storage.overrideQuotaForOrigin", {
  220 |     origin,
  221 |     quotaSize: Math.ceil(usage.usage + 1),
  222 |   });
  223 | 
  224 |   const uncachedTileUrl = `${tileUrl}?quota-miss=${Date.now()}`;
  225 |   const direct = await request.get(uncachedTileUrl);
  226 |   expect(direct.status()).toBe(200);
  227 |   expect((await direct.body()).byteLength).toBeGreaterThan(0);
  228 |   expect(
  229 |     await page.evaluate(async (url) => {
  230 |       try {
  231 |         await fetch(url);
  232 |         return "delivered";
  233 |       } catch {
  234 |         return "errored";
  235 |       }
  236 |     }, uncachedTileUrl),
  237 |   ).toBe("errored");
  238 | 
  239 |   await context.unroute(workerRoute);
  240 |   const manifestResponse = await request.get("/data/venues_slim.manifest.json");
  241 |   expect(manifestResponse.status()).toBe(200);
  242 |   const manifest = await manifestResponse.json();
  243 |   expect(typeof manifest.revision).toBe("string");
  244 |   expect(manifest.revision.trim()).not.toBe("");
  245 |   const targetMarker = `rollout-target-${Date.now()}`;
  246 |   const targetWorkerUrl =
  247 |     `/sw.js?v=${encodeURIComponent(manifest.revision)}` +
  248 |     `&rollout=${targetMarker}&cache-policy=write-safe-v1`;
> 249 |   const takeover = await page.evaluate(async (scriptUrl) => {
      |                               ^ Error: page.evaluate: Test timeout of 180000ms exceeded.
  250 |     const states: string[] = [];
  251 |     const controllerChanged = new Promise<void>((resolve) => {
  252 |       navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
  253 |         once: true,
  254 |       });
  255 |     });
  256 |     const registration = await navigator.serviceWorker.register(scriptUrl, {
  257 |       updateViaCache: "none",
  258 |     });
  259 |     const candidate = registration.installing ?? registration.waiting;
  260 |     if (candidate) {
  261 |       states.push(candidate.state);
  262 |       candidate.addEventListener("statechange", () => states.push(candidate.state));
  263 |     }
  264 |     await controllerChanged;
  265 |     if (candidate && candidate.state !== "activated") {
  266 |       await new Promise<void>((resolve, reject) => {
  267 |         const timeout = setTimeout(
  268 |           () => reject(new Error("target worker did not finish activating")),
  269 |           15_000,
  270 |         );
  271 |         const onStateChange = () => {
  272 |           if (candidate.state !== "activated") return;
  273 |           clearTimeout(timeout);
  274 |           candidate.removeEventListener("statechange", onStateChange);
  275 |           resolve();
  276 |         };
  277 |         candidate.addEventListener("statechange", onStateChange);
  278 |         onStateChange();
  279 |       });
  280 |     }
  281 |     return {
  282 |       controller: navigator.serviceWorker.controller?.scriptURL ?? null,
  283 |       states,
  284 |       waiting: registration.waiting?.scriptURL ?? null,
  285 |     };
  286 |   }, targetWorkerUrl);
  287 | 
  288 |   expect(takeover.controller).not.toBeNull();
  289 |   const takeoverControllerUrl = new URL(takeover.controller!);
  290 |   expect(takeoverControllerUrl.origin).toBe(origin);
  291 |   expect(takeoverControllerUrl.pathname).toBe("/sw.js");
  292 |   expect(takeoverControllerUrl.searchParams.get("v")).toBe(manifest.revision);
  293 |   expect(takeoverControllerUrl.searchParams.get("rollout")).toBe(targetMarker);
  294 |   expect(takeoverControllerUrl.searchParams.get("cache-policy")).toBe("write-safe-v1");
  295 |   expect(takeover.states).toContain("installed");
  296 |   expect(takeover.states).toContain("activated");
  297 |   expect(takeover.waiting).toBeNull();
  298 |   const cacheContinuity = await page.evaluate(
  299 |     async ({ poisonedTileUrl, targetScriptUrl }) => {
  300 |       const names = await caches.keys();
  301 |       const targetVersion = new URL(targetScriptUrl).searchParams.get("v");
  302 |       const familyNames = (family: string) =>
  303 |         names.filter((name) => name.startsWith(`pubmax-sw-${family}-`));
  304 |       const matchFamily = async (family: string, request: string) => {
  305 |         for (const name of familyNames(family)) {
  306 |           const response = await (await caches.open(name)).match(request);
  307 |           if (response) return true;
  308 |         }
  309 |         return false;
  310 |       };
  311 |       const oldTileUrls: string[] = [];
  312 |       for (const name of familyNames("swr")) {
  313 |         if (name === `pubmax-sw-swr-${targetVersion}`) continue;
  314 |         const cache = await caches.open(name);
  315 |         for (const request of await cache.keys()) {
  316 |           if (new URL(request.url).hostname === "tiles.openfreemap.org") {
  317 |             oldTileUrls.push(request.url);
  318 |           }
  319 |         }
  320 |       }
  321 |       return {
  322 |         data: await matchFamily("data", "/data/legacy-offline.json"),
  323 |         plan: await matchFamily("plan", "/plan/legacy-offline"),
  324 |         poisoned: await matchFamily("swr", poisonedTileUrl),
  325 |         shell: await matchFamily("shell", "/offline.html"),
  326 |         staticAsset: await matchFamily(
  327 |           "swr",
  328 |           "/_next/static/chunks/legacy-offline.js",
  329 |         ),
  330 |         oldTileUrls,
  331 |       };
  332 |     },
  333 |     {
  334 |       poisonedTileUrl: poisonedUrl,
  335 |       targetScriptUrl: takeover.controller!,
  336 |     },
  337 |   );
  338 |   expect(cacheContinuity).toEqual({
  339 |     data: true,
  340 |     plan: true,
  341 |     poisoned: false,
  342 |     shell: true,
  343 |     staticAsset: true,
  344 |     oldTileUrls: [],
  345 |   });
  346 | 
  347 |   await page.reload();
  348 |   const revealBaseline = await page.evaluate(
  349 |     () =>
```