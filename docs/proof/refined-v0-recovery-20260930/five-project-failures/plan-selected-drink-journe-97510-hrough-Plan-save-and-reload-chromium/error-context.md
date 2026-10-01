# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-selected-drink-journey.spec.ts >> wine intent carries a committed listing as backup from Map through Plan save and reload
- Location: e2e/plan-selected-drink-journey.spec.ts:146:7

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'View full plan', exact: true })

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - link "Skip to main content" [ref=f1e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=f1e3]:
    - navigation "Site navigation" [ref=f1e4]:
      - link "Open PUBMAXX landing page" [ref=f1e5] [cursor=pointer]:
        - /url: /
        - img "PUBMAXX" [ref=f1e6]:
          - generic [ref=f1e8]:
            - generic [ref=f1e9]: PUBMAX
            - generic [ref=f1e10]: X
      - generic [ref=f1e11]:
        - link "Activity" [ref=f1e12] [cursor=pointer]:
          - /url: /activity
        - link "Messages" [ref=f1e16] [cursor=pointer]:
          - /url: /messages
        - button "Switch to dark theme" [ref=f1e19] [cursor=pointer]
        - link "Sign in" [ref=f1e24] [cursor=pointer]:
          - /url: /login?from=%2Fplan%2F6f1c30d0-6611-448b-8289-db1465742512
    - region [ref=f1e29]:
      - generic [ref=f1e30]:
        - paragraph [ref=f1e31]: Your plan
        - heading "Your night out in Dalston" [level=1] [ref=f1e32]
        - paragraph [ref=f1e33]: 3 pubs, one link, zero account walls.
        - generic [ref=f1e34]:
          - link "Send to the crew" [ref=f1e36] [cursor=pointer]:
            - /url: "#share"
          - link "Make another plan" [ref=f1e38] [cursor=pointer]:
            - /url: /plan
    - generic [ref=f1e39]:
      - region [ref=f1e40]:
        - generic [ref=f1e41]:
          - paragraph [ref=f1e42]: First stop · 18:00
          - generic [ref=f1e43]:
            - heading "The route" [level=2] [ref=f1e44]
            - button "Edit route" [ref=f1e45] [cursor=pointer]
        - generic [ref=f1e46]:
          - paragraph [ref=f1e47]: Get-in estimate for one going. Never a guarantee of entry.
          - group [ref=f1e48] [cursor=pointer]:
            - 'link "Route map: 3 stops in Islington Walking route between De Beauvoir Arms, Farr’s Dalston, Burkes Warehouse." [ref=f1e49]':
              - /url: /map?mode=build&pubs=venue-e5jm0y%2Cvenue-2hnvjb%2Cvenue-1x47vxd
            - paragraph [ref=f1e50]: "Route map: 3 stops in Islington"
            - paragraph [ref=f1e51]: Walking route between De Beauvoir Arms, Farr’s Dalston, Burkes Warehouse.
            - generic [ref=f1e52]:
              - region [ref=f1e53]
              - group [ref=f1e54]:
                - generic "Toggle attribution" [ref=f1e55]
          - link "See the walking route" [ref=f1e56] [cursor=pointer]:
            - /url: /map?mode=build&pubs=venue-e5jm0y%2Cvenue-2hnvjb%2Cvenue-1x47vxd
          - list [ref=f1e59]:
            - listitem [ref=f1e60]:
              - generic [ref=f1e61]: "1"
              - generic [ref=f1e62]:
                - strong [ref=f1e63]: De Beauvoir Arms
                - link "Open on the map" [ref=f1e64] [cursor=pointer]:
                  - /url: /map?venue=venue-e5jm0y
                - generic [ref=f1e65]:
                  - generic "That's the usual pattern for this hour. We're not watching the door." [ref=f1e66]: Usually quiet
                  - generic "We do not hold opening hours for this pub, so we cannot say." [ref=f1e68]: Check before going
            - listitem [ref=f1e69]:
              - generic [ref=f1e70]: "2"
              - generic [ref=f1e71]:
                - strong [ref=f1e72]: Farr’s Dalston
                - link "Open on the map" [ref=f1e73] [cursor=pointer]:
                  - /url: /map?venue=venue-2hnvjb
                - generic [ref=f1e74]:
                  - generic "That's the usual pattern for this hour. We're not watching the door." [ref=f1e75]: Usually quiet
                  - generic "We do not hold opening hours for this pub, so we cannot say." [ref=f1e77]: Check before going
            - listitem [ref=f1e78]:
              - generic [ref=f1e79]: "3"
              - generic [ref=f1e80]:
                - strong [ref=f1e81]: Burkes Warehouse
                - link "Open on the map" [ref=f1e82] [cursor=pointer]:
                  - /url: /map?venue=venue-1x47vxd
                - generic [ref=f1e83]:
                  - generic "That's the usual pattern for this hour. We're not watching the door." [ref=f1e84]: Usually quiet
                  - generic "We do not hold opening hours for this pub, so we cannot say." [ref=f1e86]: Check before going
        - generic [ref=f1e87]:
          - generic [ref=f1e88]: The Round · group crawl
          - heading "Invite friends to this plan" [level=2] [ref=f1e94]
          - paragraph [ref=f1e95]: Turn this plan into a Round. Friends join by a short code; stops are already queued.
          - generic [ref=f1e96]:
            - textbox "Your handle" [ref=f1e97]:
              - /placeholder: your handle
            - button "Start Round" [ref=f1e98] [cursor=pointer]
        - region [ref=f1e104]:
          - generic [ref=f1e105]:
            - generic [ref=f1e106]:
              - paragraph [ref=f1e107]: Crew decisions
              - heading "Plan it together" [level=3] [ref=f1e108]
            - generic [ref=f1e109]: Host
          - generic [ref=f1e110]:
            - button "Create private invite" [ref=f1e111] [cursor=pointer]
            - generic [ref=f1e112]: One-use private link. Until they join, guests see the inviter, broad area, time window, and vibe, never the full stop list.
          - region [ref=f1e113]:
            - generic [ref=f1e114]:
              - generic [ref=f1e115]:
                - paragraph [ref=f1e116]: Sort My Night P1
                - heading "Match the group" [level=4] [ref=f1e117]
              - generic [ref=f1e118]: Not shared yet
            - paragraph [ref=f1e119]: Pick a budget, a vibe and optional needs. Saved picks are shared with everyone on this plan.
            - generic [ref=f1e120]:
              - strong [ref=f1e121]: Budget
              - group "Budget preference" [ref=f1e122]:
                - button "Under GBP 6" [ref=f1e123] [cursor=pointer]
                - button "Standard" [ref=f1e124] [cursor=pointer]
                - button "Flexible" [ref=f1e125] [cursor=pointer]
            - generic [ref=f1e126]:
              - strong [ref=f1e127]: Vibe
              - group "Atmosphere preference" [ref=f1e128]:
                - button "Cosy corners" [ref=f1e129] [cursor=pointer]
                - button "Chatty tables" [ref=f1e130] [cursor=pointer]
                - button "Lively room" [ref=f1e131] [cursor=pointer]
                - button "Music-led" [ref=f1e132] [cursor=pointer]
                - button "Food nearby" [ref=f1e133] [cursor=pointer]
            - generic [ref=f1e134]:
              - button "Zero-proof needed" [ref=f1e135] [cursor=pointer]
              - button "Step-free access" [ref=f1e136] [cursor=pointer]
              - button "Covered shelter" [ref=f1e137] [cursor=pointer]
              - button "Clear my picks" [ref=f1e138] [cursor=pointer]
            - status [ref=f1e139]: "Crew overlap: waiting on mate picks. No shared picks on this plan yet."
          - generic [ref=f1e140]:
            - strong [ref=f1e141]: Add a need
            - generic [ref=f1e142]:
              - combobox "Need type" [ref=f1e143]:
                - option "Access"
                - option "Budget"
                - option "Zero-proof"
                - option "Timing"
                - option "Transport"
                - option "Other" [selected]
              - combobox "Need priority" [ref=f1e144]:
                - option "Preference" [selected]
                - option "Must-have"
            - generic [ref=f1e145]:
              - textbox "Describe this crew need" [ref=f1e146]:
                - /placeholder: e.g. step-free entrance
              - button "Add" [disabled] [ref=f1e147]
      - complementary [ref=f1e148]:
        - region [ref=f1e149]:
          - paragraph [ref=f1e150]: Send the invite
          - heading "Get everyone on the same page" [level=2] [ref=f1e151]
          - paragraph [ref=f1e152]: WhatsApp the night link, or copy the invite. Mates tap “I’m in” with a name.
          - generic [ref=f1e153]:
            - link "Send on WhatsApp" [ref=f1e154] [cursor=pointer]:
              - /url: https://wa.me/?text=a%20night%20out%20in%20Dalston%20%C2%B7%203%20stops%20%C2%B7%20starts%2018%3A00.%20Open%20the%20link%20and%20tap%20I'm%20in.%20https%3A%2F%2Fpubmaxxing.com%2Fplan%2F6f1c30d0-6611-448b-8289-db1465742512%23invite%3Dc1475e158fc30feff97effc18c5f9f6f
            - generic [ref=f1e156]:
              - button "Copy invite link" [ref=f1e157] [cursor=pointer]
              - button "New link" [ref=f1e158] [cursor=pointer]
            - button "More ways to share" [ref=f1e159] [cursor=pointer]
        - region [ref=f1e160]:
          - generic [ref=f1e161]:
            - generic [ref=f1e162]:
              - paragraph [ref=f1e163]: The crew
              - heading "Who’s in" [level=2] [ref=f1e164]
            - generic [ref=f1e165]: "1"
          - group "Update your status" [ref=f1e166]:
            - button "In" [ref=f1e167] [cursor=pointer]
            - button "On the way" [ref=f1e168] [cursor=pointer]
            - button "Here" [ref=f1e169] [cursor=pointer]
            - button "Running late" [ref=f1e170] [cursor=pointer]
            - button "Start without me" [ref=f1e171] [cursor=pointer]
          - list [ref=f1e172]:
            - listitem [ref=f1e173]:
              - generic [ref=f1e174]: Wine Browser
              - generic [ref=f1e175]: In
        - region [ref=f1e176]:
          - paragraph [ref=f1e177]: Crew vibe
          - heading "What’s the vibe?" [level=2] [ref=f1e178]
          - paragraph [ref=f1e179]: One vote each. Tap another chip to change yours; the winner stamps the share card.
          - group "Vote the night's vibe" [ref=f1e180]:
            - button "Big one tonight" [ref=f1e181] [cursor=pointer]
            - button "Live and loud" [ref=f1e182] [cursor=pointer]
            - button "Quiet pint" [ref=f1e183] [cursor=pointer]
            - button "Cheeky one after work" [ref=f1e184] [cursor=pointer]
            - button "Match on" [ref=f1e185] [cursor=pointer]
            - button "Big brain energy" [ref=f1e186] [cursor=pointer]
            - button "Date night" [ref=f1e187] [cursor=pointer]
  - navigation "Primary":
    - list [ref=f1e188]:
      - listitem
      - listitem [ref=f1e189]:
        - link "Tonight" [ref=f1e190] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=f1e198]:
        - link "Map" [ref=f1e199] [cursor=pointer]:
          - /url: /map
      - listitem [ref=f1e205]:
        - link "Places" [ref=f1e206] [cursor=pointer]:
          - /url: /places
      - listitem [ref=f1e212]:
        - link "Out" [ref=f1e213] [cursor=pointer]:
          - /url: /out
      - listitem [ref=f1e220]:
        - link "Plan" [ref=f1e221] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=f1e229]:
        - link "You" [ref=f1e230] [cursor=pointer]:
          - /url: /u/you
  - alert [ref=f1e237]
```

# Test source

```ts
  187 |       source.selectedDrinkPriceEvidence = replacement.selectedDrinkPriceEvidence ?? null;
  188 |       source.alternatives = [
  189 |         ...(source.alternatives ?? []),
  190 |         { ...originalVenue, selectedDrinkPriceEvidence: replayedEvidence },
  191 |       ];
  192 |       await route.fulfill({ response, body: JSON.stringify(body) });
  193 |     });
  194 | 
  195 |     const discoveryResponse = page.waitForResponse((response) => response.request().method() === "GET"
  196 |       && new URL(response.url()).pathname === "/api/price-submit"
  197 |       && new URL(response.url()).searchParams.get("drinkCategory") === journey.category);
  198 |     expect((await page.goto(`/map?plan=1&drink=${journey.category}`))?.status()).toBe(200);
  199 |     const discovery = await (await discoveryResponse).json() as { listedPrices: Array<{ venueId: string; category: string; priceGbp: number; sourceUrl: string; observedAt: string }> };
  200 |     expect(discovery.listedPrices.length).toBeGreaterThan(0);
  201 |     expect(discovery.listedPrices.length).toBeLessThanOrEqual(1000);
  202 |     for (const quote of discovery.listedPrices) {
  203 |       expect(quote.category).toBe(journey.category);
  204 |       expect(committedPrices.some((row) => row.venueId === quote.venueId && row.category === quote.category
  205 |         && row.priceGbp === quote.priceGbp && row.sourceUrl === quote.sourceUrl && row.observedAt === quote.observedAt)).toBe(true);
  206 |     }
  207 |     await page.getByRole("textbox", { name: "Describe the outing" }).fill(journey.query);
  208 |     const generation = page.waitForResponse((response) => response.request().method() === "POST"
  209 |       && new URL(response.url()).pathname === "/api/plans/generate");
  210 |     await page.getByRole("button", { name: "Make a plan" }).click();
  211 |     const generatedResponse = await generation;
  212 |     const generated = await generatedResponse.json() as {
  213 |       inferredContext?: { nightArea?: string; drinkCategory?: string; zeroProof?: boolean };
  214 |       stops?: JourneyStop[];
  215 |     };
  216 |     expect(generatedResponse.status(), JSON.stringify(generated)).toBe(200);
  217 |     const listedStops = assertGeneratedListing(journey, generated, replayedVenueId, replayedEvidence);
  218 |     await expect(page.getByRole("link", { name: "Open Plan to lock it in" })).toBeVisible();
  219 |     await page.screenshot({ path: testInfo.outputPath(`${journey.category}-map.png`), animations: "disabled" });
  220 |     let extraGenerations = 0;
  221 |     page.on("request", (request) => {
  222 |       if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans/generate") extraGenerations += 1;
  223 |     });
  224 |     await page.getByRole("link", { name: "Open Plan to lock it in" }).click();
  225 |     await expect(page).toHaveURL(/\/plan\?src=mobile-route-preview$/);
  226 |     await expect(page.getByLabel("Drinks")).toHaveValue(journey.category);
  227 |     await expect(page.locator(".planComposer__stop")).toHaveCount(generated.stops!.length);
  228 |     expect(extraGenerations, "Map transfer should keep its generated route without another request").toBe(0);
  229 |     await expect(page.locator(".planComposer__stopReason").filter({ hasText: "community report" })).toHaveCount(0);
  230 |     await expect(page.locator(".planComposer__stopReason").filter({ hasText: /published menu.*Serving size not recorded/ })).toHaveCount(listedStops.length);
  231 |     await page.locator(".planComposer__stop").first().scrollIntoViewIfNeeded();
  232 |     await page.screenshot({ path: testInfo.outputPath(`${journey.category}-preview.png`), animations: "disabled" });
  233 | 
  234 |     await page.getByLabel("Your name").fill(journey.name);
  235 |     const creation = page.waitForResponse((response) => response.request().method() === "POST"
  236 |       && new URL(response.url()).pathname === "/api/plans");
  237 |     await page.getByRole("button", { name: "Lock it in" }).click();
  238 |     const createdResponse = await creation;
  239 |     const submitted = createdResponse.request().postDataJSON() as { stops: JourneyStop[] };
  240 |     const backups = (stops: JourneyStop[]) => stops.map((stop) => (stop.alternatives ?? []).map((alternative) => ({
  241 |       venueId: alternative.venueId,
  242 |       selectedDrinkPriceEvidence: alternative.selectedDrinkPriceEvidence ?? null,
  243 |     })));
  244 |     expect(backups(submitted.stops)).toEqual(backups(generated.stops!));
  245 |     expect(createdResponse.status()).toBe(201);
  246 |     const created = await createdResponse.json() as {
  247 |       plan?: { context?: { drinkCategory?: string }; stops?: JourneyStop[] };
  248 |     };
  249 |     expect(created.plan?.context?.drinkCategory).toBe(journey.category);
  250 |     expect(created.plan?.stops).toHaveLength(generated.stops!.length);
  251 |     expect(created.plan?.stops?.map((stop) => stop.venueId)).toEqual(generated.stops?.map((stop) => stop.venueId));
  252 |     expect(created.plan?.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null))
  253 |       .toEqual(generated.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null));
  254 |     expect(backups(created.plan!.stops!)).toEqual(backups(generated.stops!));
  255 |     if (journey.replay) expect(created.plan?.stops?.find((stop) => stop.alternatives?.some((alternative) => alternative.venueId === replayedVenueId))
  256 |       ?.alternatives?.find((alternative) => alternative.venueId === replayedVenueId)
  257 |       ?.selectedDrinkPriceEvidence).toEqual(replayedEvidence);
  258 |     await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
  259 | 
  260 |     const planId = new URL(page.url()).pathname.split("/").pop();
  261 |     await page.reload();
  262 |     await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();
  263 |     const read = await page.evaluate(async (id) => {
  264 |       const response = await fetch(`/api/plans/${id}`, { cache: "no-store" });
  265 |       return { status: response.status, body: await response.json() };
  266 |     }, planId);
  267 |     expect(read.status).toBe(200);
  268 |     const reloaded = read.body as { context?: { drinkCategory?: string }; stops?: JourneyStop[] };
  269 |     expect(reloaded.context?.drinkCategory).toBe(journey.category);
  270 |     expect(reloaded.stops).toHaveLength(generated.stops!.length);
  271 |     expect(reloaded.stops?.map((stop) => stop.venueId)).toEqual(generated.stops?.map((stop) => stop.venueId));
  272 |     expect(reloaded.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null))
  273 |       .toEqual(generated.stops?.map((stop) => stop.selectedDrinkPriceEvidence ?? null));
  274 |     expect(backups(reloaded.stops!)).toEqual(backups(generated.stops!));
  275 |     if (journey.replay) expect(reloaded.stops?.find((stop) => stop.alternatives?.some((alternative) => alternative.venueId === replayedVenueId))
  276 |       ?.alternatives?.find((alternative) => alternative.venueId === replayedVenueId)
  277 |       ?.selectedDrinkPriceEvidence).toEqual(replayedEvidence);
  278 |     if (!journey.replay) {
  279 |       expect(reloaded.stops?.filter((stop) => stop.selectedDrinkPriceEvidence?.source === "listed").length).toBeGreaterThan(0);
  280 |       await page.getByRole("button", { name: "View full plan", exact: true }).click();
  281 |       await page.locator(".planRoute").scrollIntoViewIfNeeded();
  282 |       await page.screenshot({ path: testInfo.outputPath(`${journey.category}-primary-reloaded.png`), animations: "disabled" });
  283 |       return;
  284 |     }
  285 |     const swapIndex = reloaded.stops!.findIndex((stop) => stop.alternatives?.[0]?.venueId && stop.alternatives[0].venueId !== replayedVenueId);
  286 |     expect(swapIndex).toBeGreaterThanOrEqual(0);
> 287 |     await page.getByRole("button", { name: "View full plan", exact: true }).click();
      |                                                                             ^ Error: locator.click: Test timeout of 120000ms exceeded.
  288 |     await page.getByRole("button", { name: "Edit route", exact: true }).click();
  289 |     const swap = page.getByRole("button", { name: new RegExp(`^Swap stop ${swapIndex + 1},`) });
  290 |     await expect(swap).toBeEnabled();
  291 |     await swap.click();
  292 |     const replacement = page.waitForResponse((response) => response.request().method() === "PATCH"
  293 |       && new URL(response.url()).pathname === `/api/plans/${planId}`);
  294 |     await page.getByRole("button", { name: "Save route changes", exact: true }).click();
  295 |     const replacedResponse = await replacement;
  296 |     expect(replacedResponse.status()).toBe(200);
  297 |     const submittedEdit = replacedResponse.request().postDataJSON() as { stops: JourneyStop[] };
  298 |     const replaced = await replacedResponse.json() as { stops: JourneyStop[] };
  299 |     expect(backups(replaced.stops)).toEqual(backups(submittedEdit.stops));
  300 |     const editedIds = new Set(replaced.stops.map((stop) => stop.venueId));
  301 |     for (const oldStop of reloaded.stops!) {
  302 |       for (const backup of oldStop.alternatives ?? []) {
  303 |         if (editedIds.has(backup.venueId)) continue;
  304 |         expect(replaced.stops.flatMap((stop) => stop.alternatives ?? [])).toContainEqual(backup);
  305 |       }
  306 |     }
  307 |     expect(replaced.stops.flatMap((stop) => stop.alternatives ?? []).find((backup) => backup.venueId === replayedVenueId)?.selectedDrinkPriceEvidence).toEqual(replayedEvidence);
  308 |     await page.reload();
  309 |     const editedRead = await page.evaluate(async (id) => (await fetch(`/api/plans/${id}`, { cache: "no-store" })).json(), planId);
  310 |     expect(backups(editedRead.stops)).toEqual(backups(replaced.stops));
  311 |     await expect(page.locator(".planRoute")).not.toContainText("community report");
  312 |     await page.locator(".planRoute").scrollIntoViewIfNeeded();
  313 |     await page.screenshot({ path: testInfo.outputPath(`${journey.category}-reloaded.png`), animations: "disabled" });
  314 |   });
  315 | }
  316 | 
```