# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-discover-coverage.spec.ts >> mobile Discover shows Night Area evidence states without promising routes
- Location: e2e/mobile-discover-coverage.spec.ts:11:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.nightAreaCoverage')
Expected: visible
Error: strict mode violation: locator('.nightAreaCoverage') resolved to 2 elements:
    1) <section class="nightAreaCoverage" aria-labelledby="night-area-coverage-title">…</section> aka getByRole('region', { name: 'Where you can plan a crawl' })
    2) <section class="nightAreaCoverage" aria-labelledby="night-area-coverage-title">…</section> aka locator('div').filter({ hasText: 'PUBMAXXPUBMAXXTonightMapPlacesOutPlanYouMore⌘KSocialCrews and people who are' }).getByLabel('Where you can plan a crawl')

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.nightAreaCoverage')
    - locator resolved to <section class="nightAreaCoverage" aria-labelledby="night-area-coverage-title">…</section>
    - unexpected value "hidden"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - navigation "Site navigation" [ref=e3]:
    - link "Open PUBMAXX landing page" [ref=e4] [cursor=pointer]:
      - /url: /
      - img "PUBMAXX" [ref=e5]:
        - generic [ref=e7]:
          - generic [ref=e8]: PUBMAX
          - generic [ref=e9]: X
    - generic [ref=e10]:
      - link "Activity" [ref=e11] [cursor=pointer]:
        - /url: /activity
      - link "Messages" [ref=e15] [cursor=pointer]:
        - /url: /messages
      - button "Switch to dark theme" [ref=e18] [cursor=pointer]
  - main [ref=e21]:
    - region [ref=e22]:
      - generic [ref=e23]:
        - paragraph [ref=e24]: Social
        - heading "Crews and people who are already here." [level=1] [ref=e25]
        - button "Post" [disabled] [ref=e28]
      - generic [ref=e29]:
        - complementary "Social views" [ref=e30]:
          - navigation "Social view" [ref=e31]:
            - link "Posts" [ref=e32] [cursor=pointer]:
              - /url: /social
            - link "Pubs & pints" [ref=e33] [cursor=pointer]:
              - /url: /social?tab=discover
        - generic [ref=e34]:
          - region [ref=e35]:
            - heading "Creator lists" [level=2] [ref=e36]
            - status [ref=e37]: Loading creator lists…
          - generic [ref=e38]:
            - region [ref=e39]:
              - generic [ref=e40]:
                - generic [ref=e41]:
                  - paragraph [ref=e42]: Across London
                  - heading "Where you can plan a crawl tonight" [level=2] [ref=e43]
                - link "Open planner" [ref=e44] [cursor=pointer]:
                  - /url: /plan
              - paragraph [ref=e45]: We only call an area crawl-ready when its prices are fresh and checked. The rest are yours to browse.
              - list "Area coverage counts" [ref=e46]:
                - listitem [ref=e47]:
                  - strong [ref=e48]: "4"
                  - generic [ref=e49]: Route-ready
                - listitem [ref=e50]:
                  - strong [ref=e51]: "6"
                  - generic [ref=e52]: Some checks done
                - listitem [ref=e53]:
                  - strong [ref=e54]: "2"
                  - generic [ref=e55]: Reviewed
                - listitem [ref=e56]:
                  - strong [ref=e57]: "34"
                  - generic [ref=e58]: Not checked
                - listitem [ref=e59]:
                  - strong [ref=e60]: "1"
                  - generic [ref=e61]: Paused
              - generic [ref=e62]:
                - paragraph [ref=e63]: Quick read
                - list "Representative area coverage" [ref=e64]:
                  - listitem [ref=e65]:
                    - generic [ref=e66]:
                      - generic [ref=e67]:
                        - strong [ref=e68]: Clapham
                        - generic [ref=e69]: Route-ready
                      - paragraph [ref=e70]: Prices here are fresh and checked. Plan a crawl whenever.
                    - link "Open the planner from Clapham coverage" [ref=e71] [cursor=pointer]:
                      - /url: /plan
                      - text: Open planner
                  - listitem [ref=e72]:
                    - generic [ref=e73]:
                      - generic [ref=e74]:
                        - strong [ref=e75]: Shoreditch
                        - generic [ref=e76]: Some checks done
                      - paragraph [ref=e77]: 4 more checks to do here before a crawl.
                    - link "See Shoreditch pubs on the map" [ref=e78] [cursor=pointer]:
                      - /url: /map?q=Shoreditch
                      - text: See the pubs
                  - listitem [ref=e79]:
                    - generic [ref=e80]:
                      - generic [ref=e81]:
                        - strong [ref=e82]: Barnes
                        - generic [ref=e83]: Reviewed
                      - paragraph [ref=e84]: 2 more checks to do here before a crawl.
                    - link "See Barnes pubs on the map" [ref=e85] [cursor=pointer]:
                      - /url: /map?q=Barnes
                      - text: See the pubs
                  - listitem [ref=e86]:
                    - generic [ref=e87]:
                      - generic [ref=e88]:
                        - strong [ref=e89]: Dalston
                        - generic [ref=e90]: Not checked
                      - paragraph [ref=e91]: Haven't got to this one yet. Have a browse.
                    - link "See Dalston pubs on the map" [ref=e92] [cursor=pointer]:
                      - /url: /map?q=Dalston
                      - text: See the pubs
                  - listitem [ref=e93]:
                    - generic [ref=e94]:
                      - generic [ref=e95]:
                        - strong [ref=e96]: Richmond
                        - generic [ref=e97]: Paused
                      - paragraph [ref=e98]: Prices here have gone stale. Have a browse while we recheck them.
                    - link "See Richmond pubs on the map" [ref=e99] [cursor=pointer]:
                      - /url: /map?q=Richmond
                      - text: See the pubs
              - group [ref=e100]:
                - generic "See every area 47 areas +" [ref=e101] [cursor=pointer]:
                  - generic [ref=e102]: See every area
                  - generic [ref=e103]: 47 areas
                  - text: +
            - region [ref=e104]:
              - heading "Choose your drink" [level=2] [ref=e105]
              - paragraph [ref=e106]: Each drink family has a map colour. Pick the family you want in hand. A cheap pint, a house red, a gin and tonic, or the low/no option for one more stop before the last train.
              - region "Explore drinks by category" [ref=e107]:
                - list [ref=e109]:
                  - listitem [ref=e110]:
                    - link "Explore low and no alcohol drinks" [ref=e111] [cursor=pointer]:
                      - /url: /map?drink=low-no&low=1&alt=mocktail
                      - generic [ref=e112]: Free
                      - generic [ref=e113]: Low / No
                  - listitem [ref=e115]:
                    - link "Explore Beer" [ref=e116] [cursor=pointer]:
                      - /url: /map?drink=beer
                      - generic [ref=e121]: Beer
                  - listitem [ref=e123]:
                    - link "Explore Wine" [ref=e124] [cursor=pointer]:
                      - /url: /map?drink=wine
                      - generic [ref=e131]: Wine
                  - listitem [ref=e133]:
                    - link "Explore Whisky" [ref=e134] [cursor=pointer]:
                      - /url: /map?drink=whisky
                      - generic [ref=e140]: Whisky
                  - listitem [ref=e142]:
                    - link "Explore Gin" [ref=e143] [cursor=pointer]:
                      - /url: /map?drink=gin
                      - generic [ref=e153]: Gin
                  - listitem [ref=e155]:
                    - link "Explore Vodka" [ref=e156] [cursor=pointer]:
                      - /url: /map?drink=vodka
                      - generic [ref=e162]: Vodka
                  - listitem [ref=e164]:
                    - link "Explore Rum" [ref=e165] [cursor=pointer]:
                      - /url: /map?drink=rum
                      - generic [ref=e173]: Rum
                  - listitem [ref=e175]:
                    - link "Explore Cocktails" [ref=e176] [cursor=pointer]:
                      - /url: /map?drink=cocktail&cocktails=1
                      - generic [ref=e183]: Cocktails
                  - listitem [ref=e185]:
                    - link "Explore Shots" [ref=e186] [cursor=pointer]:
                      - /url: /map?drink=shot
                      - generic [ref=e191]: Shots
                  - listitem [ref=e193]:
                    - link "Explore Alcohol-free" [ref=e194] [cursor=pointer]:
                      - /url: /map?drink=alcohol-free
                      - generic [ref=e201]: Alcohol-free
                  - listitem [ref=e203]:
                    - link "Explore Soft drinks" [ref=e204] [cursor=pointer]:
                      - /url: /map?drink=soft-drink
                      - generic [ref=e212]: Soft drinks
                  - listitem [ref=e214]:
                    - link "Explore Coffee" [ref=e215] [cursor=pointer]:
                      - /url: /map?drink=coffee
                      - generic [ref=e222]: Coffee
              - generic [ref=e224]:
                - heading "Jump by brand" [level=3] [ref=e226]
                - paragraph [ref=e227]: Open a drink family on the map, or jump by brand. Beer and wine have the best coverage today.
                - list [ref=e228]:
                  - listitem [ref=e229]:
                    - link "Guinness" [ref=e230] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=guinness
                  - listitem [ref=e231]:
                    - link "Neck Oil" [ref=e232] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=neck-oil
                  - listitem [ref=e233]:
                    - link "Estrella" [ref=e234] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=estrella
                  - listitem [ref=e235]:
                    - link "Peroni" [ref=e236] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=peroni
                  - listitem [ref=e237]:
                    - link "Amstel" [ref=e238] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=amstel
                  - listitem [ref=e239]:
                    - link "Madrí" [ref=e240] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=madri
                  - listitem [ref=e241]:
                    - link "Camden Hells" [ref=e242] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=camden-hells
                  - listitem [ref=e243]:
                    - link "Birra Moretti" [ref=e244] [cursor=pointer]:
                      - /url: /map?drink=beer&brand=birra-moretti
                  - listitem [ref=e245]:
                    - link "Prosecco" [ref=e246] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=prosecco
                  - listitem [ref=e247]:
                    - link "Rioja" [ref=e248] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=rioja
                  - listitem [ref=e249]:
                    - link "Malbec" [ref=e250] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=malbec
                  - listitem [ref=e251]:
                    - link "Chardonnay" [ref=e252] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=chardonnay
                  - listitem [ref=e253]:
                    - link "Pinot Grigio" [ref=e254] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=pinot-grigio
                  - listitem [ref=e255]:
                    - link "Sauvignon Blanc" [ref=e256] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=sauvignon-blanc
                  - listitem [ref=e257]:
                    - link "Champagne" [ref=e258] [cursor=pointer]:
                      - /url: /map?drink=wine&brand=champagne
            - region [ref=e259]:
              - heading "Hungry?" [level=2] [ref=e260]
              - paragraph [ref=e261]: Pubs that serve food. Light cuisine tags only, not full menus. Open the map already filtered, or jump to a plate style.
              - generic [ref=e262]:
                - link "Show pubs that serve food" [ref=e263] [cursor=pointer]:
                  - /url: /map?food=1
                - list "Cuisine filters" [ref=e264]:
                  - listitem [ref=e265]:
                    - link "roast" [ref=e266] [cursor=pointer]:
                      - /url: /map?food=1&q=roast
                  - listitem [ref=e267]:
                    - link "gastropub" [ref=e268] [cursor=pointer]:
                      - /url: /map?food=1&q=gastropub
                  - listitem [ref=e269]:
                    - link "burger" [ref=e270] [cursor=pointer]:
                      - /url: /map?food=1&q=burger
                  - listitem [ref=e271]:
                    - link "pizza" [ref=e272] [cursor=pointer]:
                      - /url: /map?food=1&q=pizza
                  - listitem [ref=e273]:
                    - link "tapas" [ref=e274] [cursor=pointer]:
                      - /url: /map?food=1&q=tapas
                  - listitem [ref=e275]:
                    - link "pie" [ref=e276] [cursor=pointer]:
                      - /url: /map?food=1&q=pie
                  - listitem [ref=e277]:
                    - link "thai" [ref=e278] [cursor=pointer]:
                      - /url: /map?food=1&q=thai
                  - listitem [ref=e279]:
                    - link "italian" [ref=e280] [cursor=pointer]:
                      - /url: /map?food=1&q=italian
            - region [ref=e281]:
              - heading "UK city energy" [level=2] [ref=e282]
              - paragraph [ref=e283]: Cities ranked on Pint Drops, crawl packs, and how much ground we cover. Open a map and add to your city’s tally.
              - paragraph [ref=e284]: Seeded only where we’ve got demo data.
              - table [ref=e285]:
                - caption [ref=e286]: UK city energy. Demo Pint Drops, listed crawls, and venue coverage.
                - rowgroup [ref=e287]:
                  - row [ref=e288]:
                    - columnheader "#" [ref=e289]
                    - columnheader "City" [ref=e290]
                    - columnheader "Drops" [ref=e291]
                    - columnheader "Energy" [ref=e292]
                - rowgroup [ref=e293]:
                  - row [ref=e294]:
                    - cell "Rank 1" [ref=e295]:
                      - generic [ref=e296]: "1"
                    - rowheader [ref=e298]:
                      - link "London Price-aware crawls across the capital" [ref=e299] [cursor=pointer]:
                        - /url: /map
                        - generic [ref=e300]: London
                        - generic [ref=e301]: Price-aware crawls across the capital
                    - cell "12" [ref=e302]
                    - cell "131" [ref=e303]
                  - row [ref=e305]:
                    - cell "Rank 2" [ref=e306]:
                      - generic [ref=e307]: "2"
                    - rowheader [ref=e309]:
                      - link "Manchester Northern Quarter rounds and city-centre crawls" [ref=e310] [cursor=pointer]:
                        - /url: /map/manchester
                        - generic [ref=e311]: Manchester
                        - generic [ref=e312]: Northern Quarter rounds and city-centre crawls
                    - cell "10" [ref=e313]
                    - cell "65" [ref=e314]
                  - row [ref=e316]:
                    - cell "Rank 3" [ref=e317]:
                      - generic [ref=e318]: "3"
                    - rowheader [ref=e320]:
                      - link "Bristol Harbour-side rounds and hillside pubs" [ref=e321] [cursor=pointer]:
                        - /url: /map/bristol
                        - generic [ref=e322]: Bristol
                        - generic [ref=e323]: Harbour-side rounds and hillside pubs
                    - cell "0" [ref=e324]
                    - cell "35" [ref=e325]
                  - row [ref=e327]:
                    - cell "Rank 4" [ref=e328]:
                      - generic [ref=e329]: "4"
                    - rowheader [ref=e331]:
                      - link "Glasgow West End crawls and Subway nights" [ref=e332] [cursor=pointer]:
                        - /url: /map/glasgow
                        - generic [ref=e333]: Glasgow
                        - generic [ref=e334]: West End crawls and Subway nights
                    - cell "0" [ref=e335]
                    - cell "35" [ref=e336]
                  - row [ref=e338]:
                    - cell "Rank 5" [ref=e339]:
                      - generic [ref=e340]: "5"
                    - rowheader [ref=e342]:
                      - link "Liverpool Waterfront crawls and Merseyrail nights" [ref=e343] [cursor=pointer]:
                        - /url: /map/liverpool
                        - generic [ref=e344]: Liverpool
                        - generic [ref=e345]: Waterfront crawls and Merseyrail nights
                    - cell "0" [ref=e346]
                    - cell "35" [ref=e347]
                  - row [ref=e349]:
                    - cell "Rank 6" [ref=e350]:
                      - generic [ref=e351]: "6"
                    - rowheader [ref=e353]:
                      - link "Oxford College-town pints and riverside walks" [ref=e354] [cursor=pointer]:
                        - /url: /map/oxford
                        - generic [ref=e355]: Oxford
                        - generic [ref=e356]: College-town pints and riverside walks
                    - cell "0" [ref=e357]
                    - cell "24.7" [ref=e358]
                  - row [ref=e360]:
                    - cell "Rank 7" [ref=e361]:
                      - generic [ref=e362]: "7"
                    - rowheader [ref=e364]:
                      - link "Birmingham City-centre rounds and canal-side pubs" [ref=e365] [cursor=pointer]:
                        - /url: /map/birmingham
                        - generic [ref=e366]: Birmingham
                        - generic [ref=e367]: City-centre rounds and canal-side pubs
                    - cell "0" [ref=e368]
                    - cell "20" [ref=e369]
                  - row [ref=e371]:
                    - cell "Rank 8" [ref=e372]:
                      - generic [ref=e373]: "8"
                    - rowheader [ref=e375]:
                      - link "Leeds Arcade bars and Headingley terraces" [ref=e376] [cursor=pointer]:
                        - /url: /map/leeds
                        - generic [ref=e377]: Leeds
                        - generic [ref=e378]: Arcade bars and Headingley terraces
                    - cell "0" [ref=e379]
                    - cell "20" [ref=e380]
                  - row [ref=e382]:
                    - cell "Rank 9" [ref=e383]:
                      - generic [ref=e384]: "9"
                    - rowheader [ref=e386]:
                      - link "Cambridge Back-lane pubs and riverside college crawls" [ref=e387] [cursor=pointer]:
                        - /url: /map/cambridge
                        - generic [ref=e388]: Cambridge
                        - generic [ref=e389]: Back-lane pubs and riverside college crawls
                    - cell "0" [ref=e390]
                    - cell "18.1" [ref=e391]
                  - row [ref=e393]:
                    - cell "Rank 10" [ref=e394]:
                      - generic [ref=e395]: "10"
                    - rowheader [ref=e397]:
                      - link "Durham Cathedral-city snugs on a compact map" [ref=e398] [cursor=pointer]:
                        - /url: /map/durham
                        - generic [ref=e399]: Durham
                        - generic [ref=e400]: Cathedral-city snugs on a compact map
                    - cell "0" [ref=e401]
                    - cell "13" [ref=e402]
                  - row [ref=e404]:
                    - cell "Rank 11" [ref=e405]:
                      - generic [ref=e406]: "11"
                    - rowheader [ref=e408]:
                      - link "Bath Georgian streets and spa-city snugs" [ref=e409] [cursor=pointer]:
                        - /url: /map/bath
                        - generic [ref=e410]: Bath
                        - generic [ref=e411]: Georgian streets and spa-city snugs
                    - cell "0" [ref=e412]
                    - cell "6.8" [ref=e413]
                  - row [ref=e415]:
                    - cell "Rank 12" [ref=e416]:
                      - generic [ref=e417]: "12"
                    - rowheader [ref=e419]:
                      - link "Llandudno Seafront pubs from the Great Orme to Colwyn Bay" [ref=e420] [cursor=pointer]:
                        - /url: /map/llandudno
                        - generic [ref=e421]: Llandudno
                        - generic [ref=e422]: Seafront pubs from the Great Orme to Colwyn Bay
                    - cell "0" [ref=e423]
                    - cell "5.6" [ref=e424]
            - region [ref=e426]:
              - heading "Recently logged cheap pints" [level=2] [ref=e427]
              - paragraph [ref=e428]: Community prices logged in the last 24 hours, cheapest first.
              - status [ref=e429]: Tonight’s prices load as you reach the rankings.
            - region [ref=e430]:
              - heading "On tonight" [level=2] [ref=e432]
              - paragraph [ref=e437]: "Quiz, screens, deals, and live music live on the map Tonight lane, the same `/api/whats-on` spine, with pin badges and kind filters."
              - link "Open Tonight on the map" [ref=e438] [cursor=pointer]:
                - /url: /map?src=discover-tonight
            - region [ref=e439]:
              - heading "Cheap Pint Leaderboard" [level=2] [ref=e440]
              - paragraph [ref=e441]: Lowest listed pint prices, separate from the recently logged prices above. Open a pub to see how fresh its number is.
              - status [ref=e442]: The cheap pint table loads when you reach the rankings.
            - region [ref=e443]:
              - heading "Then vs Now" [level=2] [ref=e444]
              - paragraph [ref=e445]: Latest community-reported pint against the earlier price on record. The biggest movers first.
              - paragraph [ref=e446]: Then is the price on record. Now is the latest one someone logged.
              - status [ref=e447]: Price comparisons load when you reach the rankings.
            - region [ref=e448]:
              - heading "Ways to drink through the city" [level=2] [ref=e449]
              - generic [ref=e450]:
                - article [ref=e451]:
                  - paragraph [ref=e452]: Golden days
                  - heading "The old guard, still standing" [level=3] [ref=e453]
                  - paragraph [ref=e454]: Victorian gin palaces, listed snugs, and the bar Dickens leaned on.
                  - link "Walk Victorian Soho" [ref=e455] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-1ufn31x%2Cvenue-1t8siin%2Cvenue-xiesdn%2Cvenue-phqazo%2Cvenue-15i2wst&crawl=victorian-soho&style=heritage
                - article [ref=e459]:
                  - paragraph [ref=e460]: Coding pint
                  - heading "A quiet table and a slow pint" [level=3] [ref=e461]
                  - paragraph [ref=e462]: Pubs with sockets, listed Wi-Fi and quieter afternoon notes.
                  - link "Find a working pint" [ref=e463] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-1h8gb3j%2Cvenue-qtavbf%2Cvenue-1pq1x5j%2Cvenue-myhgdk%2Cvenue-10ilrk3&crawl=barbican-coding-pint&style=balanced&band=coding-pint
                - article [ref=e467]:
                  - paragraph [ref=e468]: Then vs now
                  - heading "What a pint used to cost" [level=3] [ref=e469]
                  - paragraph [ref=e470]: Listed pints around £4, mapped into a walk.
                  - link "Build a cheap crawl" [ref=e471] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-133uf6h%2Cvenue-fpmfjs%2Cvenue-16ze6b1%2Cvenue-1ywc2og%2Cvenue-2e3otf&crawl=borough-market-crawl&style=balanced&band=markets-theatre
                - article [ref=e475]:
                  - paragraph [ref=e476]: Tonight
                  - heading "Tonight's crawl, sorted" [level=3] [ref=e477]
                  - paragraph [ref=e478]: Pick a borough and set your price before opening the route on the map.
                  - link "Plan an outing" [ref=e479] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-1ufn31x%2Cvenue-1t8siin%2Cvenue-xiesdn%2Cvenue-phqazo%2Cvenue-15i2wst&crawl=victorian-soho&style=heritage
            - region [ref=e483]:
              - heading "Historic London" [level=2] [ref=e484]
              - paragraph [ref=e485]: Themed heritage routes built from the pubs’ cited histories. Oldest first, the riverside taverns, and the highly listed classics.
              - paragraph [ref=e486]: Cited from Wikipedia.
              - generic [ref=e487]:
                - article [ref=e488]:
                  - paragraph [ref=e489]: Historic London
                  - heading "London's Oldest Pubs" [level=3] [ref=e490]
                  - paragraph [ref=e491]: The city's oldest surviving pubs, earliest first. Every date is cited from Wikipedia.
                  - link "Start with the oldest" [ref=e492] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-16pnwmm%2Cvenue-ekvkuv%2Cvenue-178c07p%2Cvenue-11n82fd%2Cvenue-1r447i7%2Cvenue-xvusrx%2Cvenue-1ufn31x%2Cvenue-erabed&crawl=heritage-oldest-pubs&style=heritage
                - article [ref=e496]:
                  - paragraph [ref=e497]: Historic London
                  - heading "Historic Riverside Taverns" [level=3] [ref=e498]
                  - paragraph [ref=e499]: Thames-side taverns walked west to east along the river, wharf to wharf. Every stop is cited from Wikipedia.
                  - link "Walk the Thames taverns" [ref=e500] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-16twk4e%2Cvenue-1p5ftm3%2Cvenue-vys493%2Cvenue-1ya67fi%2Cvenue-1d8a5xb%2Cvenue-16pnwmm%2Cvenue-ekvkuv&crawl=heritage-riverside-taverns&style=heritage
                - article [ref=e504]:
                  - paragraph [ref=e505]: Historic London
                  - heading "Grade-Listed Classics" [level=3] [ref=e506]
                  - paragraph [ref=e507]: The map's most highly listed pubs. Grade II* and above, protected historic interiors. Every listing is cited from Wikipedia.
                  - link "See the listed classics" [ref=e508] [cursor=pointer]:
                    - /url: /map?mode=build&pubs=venue-16pnwmm%2Cvenue-178c07p%2Cvenue-eltcmh%2Cvenue-1p5ftm3&crawl=heritage-grade-listed&style=heritage
  - navigation "Primary":
    - list [ref=e512]:
      - listitem
      - listitem [ref=e513]:
        - link "Tonight" [ref=e514] [cursor=pointer]:
          - /url: /tonight
      - listitem [ref=e522]:
        - link "Map" [ref=e523] [cursor=pointer]:
          - /url: /map
      - listitem [ref=e529]:
        - link "Places" [ref=e530] [cursor=pointer]:
          - /url: /places
      - listitem [ref=e536]:
        - link "Out" [ref=e537] [cursor=pointer]:
          - /url: /out
      - listitem [ref=e544]:
        - link "Plan" [ref=e545] [cursor=pointer]:
          - /url: /plan
      - listitem [ref=e553]:
        - link "You" [ref=e554] [cursor=pointer]:
          - /url: /u/you
  - button "Create" [ref=e561] [cursor=pointer]
  - text: +
  - alert [ref=e563]
```

# Test source

```ts
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | 
  3  | const MOBILE = { width: 390, height: 844 };
  4  | 
  5  | async function expectNoHorizontalOverflow(page: Page) {
  6  |   await expect
  7  |     .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
  8  |     .toBeLessThanOrEqual(1);
  9  | }
  10 | 
  11 | test("mobile Discover shows Night Area evidence states without promising routes", async ({ page }) => {
  12 |   await page.setViewportSize(MOBILE);
  13 |   await page.addInitScript(() => {
  14 |     window.localStorage.setItem("pubmax-tour-v1-done", "1");
  15 |     window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  16 |     window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  17 |   });
  18 | 
  19 |   const response = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  20 |   expect(response?.status()).toBe(200);
  21 | 
  22 |   const coverage = page.locator(".nightAreaCoverage");
> 23 |   await expect(coverage).toBeVisible();
     |                          ^ Error: expect(locator).toBeVisible() failed
  24 |   await expect(coverage.getByRole("heading", { name: "Where you can plan a crawl tonight" })).toBeVisible();
  25 |   await expect(coverage).toContainText("We only call an area crawl-ready when its prices are fresh and checked.");
  26 |   await expect(coverage.getByRole("link", { name: "Open planner", exact: true })).toHaveAttribute("href", "/plan");
  27 |   await expectNoHorizontalOverflow(page);
  28 | 
  29 |   const plannerLink = coverage.getByRole("link", { name: /Open the planner from / }).first();
  30 |   const plannerBox = await plannerLink.boundingBox();
  31 |   expect(plannerBox?.height ?? 0, "route-ready action should be thumb-safe").toBeGreaterThanOrEqual(44);
  32 | 
  33 |   const details = coverage.locator("details");
  34 |   await expect(details).not.toHaveAttribute("open", "");
  35 |   await details.locator("summary").click();
  36 |   await expect(details).toHaveAttribute("open", "");
  37 |   await expect(details.locator('[data-route-ready="true"]').first()).toBeVisible();
  38 |   await expect(details.locator('[data-coverage-status="captured"]').first()).toBeVisible();
  39 |   await expect(details.locator('[data-coverage-status="reviewed"]').first()).toBeVisible();
  40 |   await expect(details.locator('[data-coverage-status="discovered"]').first()).toBeVisible();
  41 |   await expect(details.locator('[data-coverage-status="paused"]').first()).toBeVisible();
  42 |   await expect(details.getByRole("link", { name: /See .* pubs on the map/ }).first()).toHaveAttribute(
  43 |     "href",
  44 |     /\/map\?q=/,
  45 |   );
  46 |   await expectNoHorizontalOverflow(page);
  47 | });
  48 | 
```