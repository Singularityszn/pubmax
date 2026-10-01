# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-accessibility.spec.ts >> map keyboard and screen-reader venue path >> updates open venue list after map movement and a venue-kind filter
- Location: e2e/map-accessibility.spec.ts:205:7

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 135
Received:   221

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - main [ref=e3]:
    - navigation "Site navigation" [ref=e4]:
      - link "Open PUBMAXX landing page" [ref=e5] [cursor=pointer]:
        - /url: /
        - img "PUBMAXX" [ref=e6]:
          - generic [ref=e8]:
            - generic [ref=e9]: PUBMAX
            - generic [ref=e10]: X
      - list [ref=e11]:
        - listitem [ref=e12]:
          - link "Tonight" [ref=e13] [cursor=pointer]:
            - /url: /tonight
        - listitem [ref=e14]:
          - link "Map" [ref=e15] [cursor=pointer]:
            - /url: /map
        - listitem [ref=e16]:
          - link "Places" [ref=e17] [cursor=pointer]:
            - /url: /places
        - listitem [ref=e18]:
          - link "Out" [ref=e19] [cursor=pointer]:
            - /url: /out
        - listitem [ref=e20]:
          - link "Plan" [ref=e21] [cursor=pointer]:
            - /url: /plan
        - listitem [ref=e22]:
          - link "You" [ref=e23] [cursor=pointer]:
            - /url: /u/you
      - generic [ref=e24]:
        - button "More pages" [ref=e26] [cursor=pointer]:
          - generic [ref=e27]: More
        - link "Share a Moment" [ref=e30] [cursor=pointer]:
          - /url: /moment?returnTo=%2Fmap
        - button "Open command palette" [ref=e33] [cursor=pointer]:
          - generic [ref=e34]: ⌘K
        - link "Activity" [ref=e35] [cursor=pointer]:
          - /url: /activity
        - link "Messages" [ref=e39] [cursor=pointer]:
          - /url: /messages
        - button "Switch to dark theme" [ref=e42] [cursor=pointer]
        - button "Sign in" [ref=e47] [cursor=pointer]
    - region "Interactive pub map of London" [ref=e52]:
      - generic [ref=e53]:
        - generic [ref=e54]:
          - region "Map" [ref=e55]
          - generic:
            - generic [ref=e56]:
              - button "Zoom in" [active] [ref=e57] [cursor=pointer]
              - button "Zoom out" [ref=e59] [cursor=pointer]
            - group [ref=e61]:
              - generic "Toggle attribution" [ref=e62] [cursor=pointer]
        - 'button "Map layers: Tube, Rail, parks, and place stories" [ref=e63] [cursor=pointer]':
          - generic [ref=e68]: Layers
      - search [ref=e69]:
        - generic [ref=e70]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - generic [ref=e77]: Search pubs
              - combobox "Search pubs" [ref=e78]
            - status [ref=e79]
          - 'button "Filters: venue types, view and zone" [ref=e81] [cursor=pointer]':
            - generic [ref=e83]: Filters
          - 'button "Drink: Pints" [ref=e84] [cursor=pointer]'
          - button "Plan an outing" [ref=e89] [cursor=pointer]
          - 'button "Map area: King''s Cross. Change city" [ref=e96] [cursor=pointer]':
            - generic [ref=e97]: King's Cross
      - complementary "Conditions and area news"
      - button "Pub Pal Ask your Pub Pal" [ref=e99] [cursor=pointer]:
        - img "Pub Pal" [ref=e101]
        - generic [ref=e102]: Ask your Pub Pal
      - region "London venue list":
        - group "London venues on the map" [ref=e103]:
          - generic [ref=e104]:
            - generic [ref=e105]:
              - heading "Venues on the map" [level=2] [ref=e106]
              - status [ref=e107]: 221 venues
            - button "Close venue list" [ref=e108] [cursor=pointer]
          - group "Sort venues on the map" [ref=e112]:
            - button "Nearest" [pressed] [ref=e113] [cursor=pointer]
            - button "Cheapest" [ref=e114] [cursor=pointer]
          - generic [ref=e115]:
            - region "Listed pubs and venues" [ref=e116]:
              - heading "Listed pubs and venues" [level=3] [ref=e117]
              - list "Listed pubs and venues" [ref=e118]:
                - listitem [ref=e119]:
                  - button "The Dolphin Tavern Pub 165 m £6.50" [ref=e120] [cursor=pointer]:
                    - generic [ref=e121]: The Dolphin Tavern
                    - generic [ref=e125]:
                      - generic [ref=e126]: Pub
                      - generic [ref=e127]: 165 m
                      - generic [ref=e128]: £6.50
                - listitem [ref=e130]:
                  - button "The Enterprise Pub 179 m £5.60" [ref=e131] [cursor=pointer]:
                    - generic [ref=e132]: The Enterprise
                    - generic [ref=e136]:
                      - generic [ref=e137]: Pub
                      - generic [ref=e138]: 179 m
                      - generic [ref=e139]: £5.60
                - listitem [ref=e141]:
                  - button "The Bountiful Cow Pub 193 m £6.70" [ref=e142] [cursor=pointer]:
                    - generic [ref=e143]: The Bountiful Cow
                    - generic [ref=e147]:
                      - generic [ref=e148]: Pub
                      - generic [ref=e149]: 193 m
                      - generic [ref=e150]: £6.70
                - listitem [ref=e152]:
                  - button "The Queens Head Pub 223 m £6.10" [ref=e153] [cursor=pointer]:
                    - generic [ref=e154]: The Queens Head
                    - generic [ref=e158]:
                      - generic [ref=e159]: Pub
                      - generic [ref=e160]: 223 m
                      - generic [ref=e161]: £6.10
                - listitem [ref=e163]:
                  - button "Swan Pub 240 m £6.10" [ref=e164] [cursor=pointer]:
                    - generic [ref=e165]: Swan
                    - generic [ref=e169]:
                      - generic [ref=e170]: Pub
                      - generic [ref=e171]: 240 m
                      - generic [ref=e172]: £6.10
                - listitem [ref=e174]:
                  - button "The Perseverance Pub 257 m £6.45" [ref=e175] [cursor=pointer]:
                    - generic [ref=e176]: The Perseverance
                    - generic [ref=e180]:
                      - generic [ref=e181]: Pub
                      - generic [ref=e182]: 257 m
                      - generic [ref=e183]: £6.45
                - listitem [ref=e185]:
                  - button "The Old Nick Pub 270 m £6.05" [ref=e186] [cursor=pointer]:
                    - generic [ref=e187]: The Old Nick
                    - generic [ref=e191]:
                      - generic [ref=e192]: Pub
                      - generic [ref=e193]: 270 m
                      - generic [ref=e194]: £6.05
                - listitem [ref=e196]:
                  - button "The Rugby Tavern Pub 281 m £6.50" [ref=e197] [cursor=pointer]:
                    - generic [ref=e198]: The Rugby Tavern
                    - generic [ref=e202]:
                      - generic [ref=e203]: Pub
                      - generic [ref=e204]: 281 m
                      - generic [ref=e205]: £6.50
                - listitem [ref=e207]:
                  - button "Old Red Lion, Holborn Pub 314 m Price TBD" [ref=e208] [cursor=pointer]:
                    - generic [ref=e209]: Old Red Lion, Holborn
                    - generic [ref=e213]:
                      - generic [ref=e214]: Pub
                      - generic [ref=e215]: 314 m
                      - generic [ref=e216]: Price TBD
                - listitem [ref=e217]:
                  - button "Scarfes Bar Bar 315 m Scarfes signature cocktail · £24.00 Jul · rosewoodhotels.com" [ref=e218] [cursor=pointer]:
                    - generic [ref=e219]: Scarfes Bar
                    - generic [ref=e223]:
                      - generic [ref=e224]: Bar
                      - generic [ref=e225]: 315 m
                      - generic [ref=e226]:
                        - generic [ref=e227]: Scarfes signature cocktail · £24.00
                        - generic [ref=e228]: Jul · rosewoodhotels.com
                - listitem [ref=e229]:
                  - button "Princess Louise Pub 319 m Price TBD" [ref=e230] [cursor=pointer]:
                    - generic [ref=e231]: Princess Louise
                    - generic [ref=e235]:
                      - generic [ref=e236]: Pub
                      - generic [ref=e237]: 319 m
                      - generic [ref=e238]: Price TBD
                - listitem [ref=e239]:
                  - button "Ship Tavern, London Pub 321 m Price TBD" [ref=e240] [cursor=pointer]:
                    - generic [ref=e241]: Ship Tavern, London
                    - generic [ref=e245]:
                      - generic [ref=e246]: Pub
                      - generic [ref=e247]: 321 m
                      - generic [ref=e248]: Price TBD
                - listitem [ref=e249]:
                  - button "The Lamb Pub 351 m £6.65" [ref=e250] [cursor=pointer]:
                    - generic [ref=e251]: The Lamb
                    - generic [ref=e255]:
                      - generic [ref=e256]: Pub
                      - generic [ref=e257]: 351 m
                      - generic [ref=e258]: £6.65
                - listitem [ref=e260]:
                  - button "The Duke Pub 394 m £6.50" [ref=e261] [cursor=pointer]:
                    - generic [ref=e262]: The Duke
                    - generic [ref=e266]:
                      - generic [ref=e267]: Pub
                      - generic [ref=e268]: 394 m
                      - generic [ref=e269]: £6.50
                - listitem [ref=e271]:
                  - button "Friend At Hand Pub 452 m £6.00" [ref=e272] [cursor=pointer]:
                    - generic [ref=e273]: Friend At Hand
                    - generic [ref=e277]:
                      - generic [ref=e278]: Pub
                      - generic [ref=e279]: 452 m
                      - generic [ref=e280]: £6.00
                - listitem [ref=e282]:
                  - button "Museum Tavern Pub 456 m £6.15" [ref=e283] [cursor=pointer]:
                    - generic [ref=e284]: Museum Tavern
                    - generic [ref=e288]:
                      - generic [ref=e289]: Pub
                      - generic [ref=e290]: 456 m
                      - generic [ref=e291]: £6.15
                - listitem [ref=e293]:
                  - button "The Horse & Wig Pub 469 m £5.00" [ref=e294] [cursor=pointer]:
                    - generic [ref=e295]: The Horse & Wig
                    - generic [ref=e299]:
                      - generic [ref=e300]: Pub
                      - generic [ref=e301]: 469 m
                      - generic [ref=e302]: £5.00
                - listitem [ref=e304]:
                  - button "Hercules Pillars Pub 471 m £4.20" [ref=e305] [cursor=pointer]:
                    - generic [ref=e306]: Hercules Pillars
                    - generic [ref=e310]:
                      - generic [ref=e311]: Pub
                      - generic [ref=e312]: 471 m
                      - generic [ref=e313]: £4.20
                - listitem [ref=e315]:
                  - button "Plough Pub 477 m £6.15" [ref=e316] [cursor=pointer]:
                    - generic [ref=e317]: Plough
                    - generic [ref=e321]:
                      - generic [ref=e322]: Pub
                      - generic [ref=e323]: 477 m
                      - generic [ref=e324]: £6.15
                - listitem [ref=e326]:
                  - button "The Yorkshire Grey Pub 478 m £7.00" [ref=e327] [cursor=pointer]:
                    - generic [ref=e328]: The Yorkshire Grey
                    - generic [ref=e332]:
                      - generic [ref=e333]: Pub
                      - generic [ref=e334]: 478 m
                      - generic [ref=e335]: £7.00
                - listitem [ref=e337]:
                  - button "The Blue Lion Pub 524 m £6.40" [ref=e338] [cursor=pointer]:
                    - generic [ref=e339]: The Blue Lion
                    - generic [ref=e343]:
                      - generic [ref=e344]: Pub
                      - generic [ref=e345]: 524 m
                      - generic [ref=e346]: £6.40
                - listitem [ref=e348]:
                  - button "Cittie of Yorke Pub 528 m Price TBD" [ref=e349] [cursor=pointer]:
                    - generic [ref=e350]: Cittie of Yorke
                    - generic [ref=e354]:
                      - generic [ref=e355]: Pub
                      - generic [ref=e356]: 528 m
                      - generic [ref=e357]: Price TBD
                - listitem [ref=e358]:
                  - button "The Spice of Life Pub 576 m Price TBD" [ref=e359] [cursor=pointer]:
                    - generic [ref=e360]: The Spice of Life
                    - generic [ref=e364]:
                      - generic [ref=e365]: Pub
                      - generic [ref=e366]: 576 m
                      - generic [ref=e367]: Price TBD
                - listitem [ref=e368]:
                  - button "The Calthorpe Arms Pub 596 m £5.60" [ref=e369] [cursor=pointer]:
                    - generic [ref=e370]: The Calthorpe Arms
                    - generic [ref=e374]:
                      - generic [ref=e375]: Pub
                      - generic [ref=e376]: 596 m
                      - generic [ref=e377]: £5.60
                - listitem [ref=e379]:
                  - button "The Marquis Cornwallis Pub 602 m £6.20" [ref=e380] [cursor=pointer]:
                    - generic [ref=e381]: The Marquis Cornwallis
                    - generic [ref=e385]:
                      - generic [ref=e386]: Pub
                      - generic [ref=e387]: 602 m
                      - generic [ref=e388]: £6.20
                - listitem [ref=e390]:
                  - button "The Three Tuns - LSE Student Union Pub 603 m £2.95" [ref=e391] [cursor=pointer]:
                    - generic [ref=e392]: The Three Tuns - LSE Student Union
                    - generic [ref=e396]:
                      - generic [ref=e397]: Pub
                      - generic [ref=e398]: 603 m
                      - generic [ref=e399]: £2.95
                - listitem [ref=e401]:
                  - button "Prince of Wales (Covent Garden) Pub 623 m £6.40" [ref=e402] [cursor=pointer]:
                    - generic [ref=e403]: Prince of Wales (Covent Garden)
                    - generic [ref=e407]:
                      - generic [ref=e408]: Pub
                      - generic [ref=e409]: 623 m
                      - generic [ref=e410]: £6.40
                - listitem [ref=e412]:
                  - button "The George IV Pub 628 m £6.30" [ref=e413] [cursor=pointer]:
                    - generic [ref=e414]: The George IV
                    - generic [ref=e418]:
                      - generic [ref=e419]: Pub
                      - generic [ref=e420]: 628 m
                      - generic [ref=e421]: £6.30
                - listitem [ref=e423]:
                  - button "Freemasons Arms Pub 646 m Price TBD" [ref=e424] [cursor=pointer]:
                    - generic [ref=e425]: Freemasons Arms
                    - generic [ref=e429]:
                      - generic [ref=e430]: Pub
                      - generic [ref=e431]: 646 m
                      - generic [ref=e432]: Price TBD
                - listitem [ref=e433]:
                  - button "Staple Inn Pub 649 m Price TBD" [ref=e434] [cursor=pointer]:
                    - generic [ref=e435]: Staple Inn
                    - generic [ref=e439]:
                      - generic [ref=e440]: Pub
                      - generic [ref=e441]: 649 m
                      - generic [ref=e442]: Price TBD
                - listitem [ref=e443]:
                  - button "The Pregnant Man Pub 666 m £6.70" [ref=e444] [cursor=pointer]:
                    - generic [ref=e445]: The Pregnant Man
                    - generic [ref=e449]:
                      - generic [ref=e450]: Pub
                      - generic [ref=e451]: 666 m
                      - generic [ref=e452]: £6.70
                - listitem [ref=e454]:
                  - button "The Seven Stars Pub 715 m £6.50" [ref=e455] [cursor=pointer]:
                    - generic [ref=e456]: The Seven Stars
                    - generic [ref=e460]:
                      - generic [ref=e461]: Pub
                      - generic [ref=e462]: 715 m
                      - generic [ref=e463]: £6.50
                - listitem [ref=e465]:
                  - button "The Lord John Russell Pub 783 m £4.95" [ref=e466] [cursor=pointer]:
                    - generic [ref=e467]: The Lord John Russell
                    - generic [ref=e471]:
                      - generic [ref=e472]: Pub
                      - generic [ref=e473]: 783 m
                      - generic [ref=e474]: £4.95
                - listitem [ref=e476]:
                  - button "The Sir Christopher Hatton Pub 795 m Price TBD" [ref=e477] [cursor=pointer]:
                    - generic [ref=e478]: The Sir Christopher Hatton
                    - generic [ref=e482]:
                      - generic [ref=e483]: Pub
                      - generic [ref=e484]: 795 m
                      - generic [ref=e485]: Price TBD
                - listitem [ref=e486]:
                  - button "Crown (Covent Garden) Pub 819 m £6.45" [ref=e487] [cursor=pointer]:
                    - generic [ref=e488]: Crown (Covent Garden)
                    - generic [ref=e492]:
                      - generic [ref=e493]: Pub
                      - generic [ref=e494]: 819 m
                      - generic [ref=e495]: £6.45
                - listitem [ref=e497]:
                  - button "The College Arms Pub 823 m £7.40" [ref=e498] [cursor=pointer]:
                    - generic [ref=e499]: The College Arms
                    - generic [ref=e503]:
                      - generic [ref=e504]: Pub
                      - generic [ref=e505]: 823 m
                      - generic [ref=e506]: £7.40
                - listitem [ref=e508]:
                  - button "The Flying Horse Pub 840 m Price TBD" [ref=e509] [cursor=pointer]:
                    - generic [ref=e510]: The Flying Horse
                    - generic [ref=e514]:
                      - generic [ref=e515]: Pub
                      - generic [ref=e516]: 840 m
                      - generic [ref=e517]: Price TBD
                - listitem [ref=e518]:
                  - button "The Harrison Pub 846 m £5.00" [ref=e519] [cursor=pointer]:
                    - generic [ref=e520]: The Harrison
                    - generic [ref=e524]:
                      - generic [ref=e525]: Pub
                      - generic [ref=e526]: 846 m
                      - generic [ref=e527]: £5.00
                - listitem [ref=e529]:
                  - button "Ye Olde Mitre Pub 885 m Price TBD" [ref=e530] [cursor=pointer]:
                    - generic [ref=e531]: Ye Olde Mitre
                    - generic [ref=e535]:
                      - generic [ref=e536]: Pub
                      - generic [ref=e537]: 885 m
                      - generic [ref=e538]: Price TBD
                - listitem [ref=e539]:
                  - button "Ye Old Mitre Pub 889 m Price TBD" [ref=e540] [cursor=pointer]:
                    - generic [ref=e541]: Ye Old Mitre
                    - generic [ref=e545]:
                      - generic [ref=e546]: Pub
                      - generic [ref=e547]: 889 m
                      - generic [ref=e548]: Price TBD
                - listitem [ref=e549]:
                  - button "The Boot Pub 894 m £4.80" [ref=e550] [cursor=pointer]:
                    - generic [ref=e551]: The Boot
                    - generic [ref=e555]:
                      - generic [ref=e556]: Pub
                      - generic [ref=e557]: 894 m
                      - generic [ref=e558]: £4.80
                - listitem [ref=e560]:
                  - button "Wheatsheaf Pub 901 m £8.10" [ref=e561] [cursor=pointer]:
                    - generic [ref=e562]: Wheatsheaf
                    - generic [ref=e566]:
                      - generic [ref=e567]: Pub
                      - generic [ref=e568]: 901 m
                      - generic [ref=e569]: £8.10
                - listitem [ref=e571]:
                  - button "Rising Sun Pub 910 m £6.15" [ref=e572] [cursor=pointer]:
                    - generic [ref=e573]: Rising Sun
                    - generic [ref=e577]:
                      - generic [ref=e578]: Pub
                      - generic [ref=e579]: 910 m
                      - generic [ref=e580]: £6.15
                - listitem [ref=e582]:
                  - button "The Royal George Pub 927 m £6.60" [ref=e583] [cursor=pointer]:
                    - generic [ref=e584]: The Royal George
                    - generic [ref=e588]:
                      - generic [ref=e589]: Pub
                      - generic [ref=e590]: 927 m
                      - generic [ref=e591]: £6.60
                - listitem [ref=e593]:
                  - button "The Queens Head Pub 940 m £5.90" [ref=e594] [cursor=pointer]:
                    - generic [ref=e595]: The Queens Head
                    - generic [ref=e599]:
                      - generic [ref=e600]: Pub
                      - generic [ref=e601]: 940 m
                      - generic [ref=e602]: £5.90
                - listitem [ref=e604]:
                  - button "The Vault at Milroy's Bar 944 m Vault cocktail · £15.00 Jul · milroys.co.uk" [ref=e605] [cursor=pointer]:
                    - generic [ref=e606]: The Vault at Milroy's
                    - generic [ref=e610]:
                      - generic [ref=e611]: Bar
                      - generic [ref=e612]: 944 m
                      - generic [ref=e613]:
                        - generic [ref=e614]: Vault cocktail · £15.00
                        - generic [ref=e615]: Jul · milroys.co.uk
                - listitem [ref=e616]:
                  - button "Lucas Arms Pub 945 m £6.05" [ref=e617] [cursor=pointer]:
                    - generic [ref=e618]: Lucas Arms
                    - generic [ref=e622]:
                      - generic [ref=e623]: Pub
                      - generic [ref=e624]: 945 m
                      - generic [ref=e625]: £6.05
                - listitem [ref=e627]:
                  - button "The Marian Anderson Pub 947 m £4.00" [ref=e628] [cursor=pointer]:
                    - generic [ref=e629]: The Marian Anderson
                    - generic [ref=e633]:
                      - generic [ref=e634]: Pub
                      - generic [ref=e635]: 947 m
                      - generic [ref=e636]: £4.00
                - listitem [ref=e638]:
                  - button "The Montagu pyke (Wetherspoons) Pub 953 m £6.13" [ref=e639] [cursor=pointer]:
                    - generic [ref=e640]: The Montagu pyke (Wetherspoons)
                    - generic [ref=e644]:
                      - generic [ref=e645]: Pub
                      - generic [ref=e646]: 953 m
                      - generic [ref=e647]: £6.13
                - listitem [ref=e649]:
                  - button "McGlynn's Free House Pub 962 m £5.20" [ref=e650] [cursor=pointer]:
                    - generic [ref=e651]: McGlynn's Free House
                    - generic [ref=e655]:
                      - generic [ref=e656]: Pub
                      - generic [ref=e657]: 962 m
                      - generic [ref=e658]: £5.20
                - listitem [ref=e660]:
                  - button "Bradley’s Spanish Bar Pub 963 m £6.00" [ref=e661] [cursor=pointer]:
                    - generic [ref=e662]: Bradley’s Spanish Bar
                    - generic [ref=e666]:
                      - generic [ref=e667]: Pub
                      - generic [ref=e668]: 963 m
                      - generic [ref=e669]: £6.00
                - listitem [ref=e671]:
                  - button "Three Sheets Soho Bar 978 m Three Sheets seasonal cocktail · £14.00 Jul · threesheets-bar.com" [ref=e672] [cursor=pointer]:
                    - generic [ref=e673]: Three Sheets Soho
                    - generic [ref=e677]:
                      - generic [ref=e678]: Bar
                      - generic [ref=e679]: 978 m
                      - generic [ref=e680]:
                        - generic [ref=e681]: Three Sheets seasonal cocktail · £14.00
                        - generic [ref=e682]: Jul · threesheets-bar.com
                - listitem [ref=e683]:
                  - button "Pillars of Hercules Pub 979 m Price TBD" [ref=e684] [cursor=pointer]:
                    - generic [ref=e685]: Pillars of Hercules
                    - generic [ref=e689]:
                      - generic [ref=e690]: Pub
                      - generic [ref=e691]: 979 m
                      - generic [ref=e692]: Price TBD
                - listitem [ref=e693]:
                  - button "Moro Restaurant 1.0 km Charcoal-grilled Lamb · £38.00 Aug · moro.co.uk" [ref=e694] [cursor=pointer]:
                    - generic [ref=e695]: Moro
                    - generic [ref=e699]:
                      - generic [ref=e700]: Restaurant
                      - generic [ref=e701]: 1.0 km
                      - generic [ref=e702]:
                        - generic [ref=e703]: Charcoal-grilled Lamb · £38.00
                        - generic [ref=e704]: Aug · moro.co.uk
                - listitem [ref=e705]:
                  - button "Mabel's Tavern Pub 1.0 km £7.00" [ref=e706] [cursor=pointer]:
                    - generic [ref=e707]: Mabel's Tavern
                    - generic [ref=e711]:
                      - generic [ref=e712]: Pub
                      - generic [ref=e713]: 1.0 km
                      - generic [ref=e714]: £7.00
                - listitem [ref=e716]:
                  - button "The Water Rats Pub 1.0 km £6.80" [ref=e717] [cursor=pointer]:
                    - generic [ref=e718]: The Water Rats
                    - generic [ref=e722]:
                      - generic [ref=e723]: Pub
                      - generic [ref=e724]: 1.0 km
                      - generic [ref=e725]: £6.80
                - listitem [ref=e727]:
                  - button "Fitzrovia Pub 1.0 km £6.35" [ref=e728] [cursor=pointer]:
                    - generic [ref=e729]: Fitzrovia
                    - generic [ref=e733]:
                      - generic [ref=e734]: Pub
                      - generic [ref=e735]: 1.0 km
                      - generic [ref=e736]: £6.35
                - listitem [ref=e738]:
                  - button "Fitzroy Tavern Pub 1.0 km Price TBD" [ref=e739] [cursor=pointer]:
                    - generic [ref=e740]: Fitzroy Tavern
                    - generic [ref=e744]:
                      - generic [ref=e745]: Pub
                      - generic [ref=e746]: 1.0 km
                      - generic [ref=e747]: Price TBD
                - listitem [ref=e748]:
                  - button "The Three Kings Pub 1.0 km £6.60" [ref=e749] [cursor=pointer]:
                    - generic [ref=e750]: The Three Kings
                    - generic [ref=e754]:
                      - generic [ref=e755]: Pub
                      - generic [ref=e756]: 1.0 km
                      - generic [ref=e757]: £6.60
                - listitem [ref=e759]:
                  - button "The Dog & Duck Pub 1.1 km £6.05" [ref=e760] [cursor=pointer]:
                    - generic [ref=e761]: The Dog & Duck
                    - generic [ref=e765]:
                      - generic [ref=e766]: Pub
                      - generic [ref=e767]: 1.1 km
                      - generic [ref=e768]: £6.05
                - listitem [ref=e770]:
                  - button "The Crown Tavern Pub 1.1 km £7.30" [ref=e771] [cursor=pointer]:
                    - generic [ref=e772]: The Crown Tavern
                    - generic [ref=e776]:
                      - generic [ref=e777]: Pub
                      - generic [ref=e778]: 1.1 km
                      - generic [ref=e779]: £7.30
                - listitem [ref=e781]:
                  - button "The Rocket Pub 1.1 km £6.80" [ref=e782] [cursor=pointer]:
                    - generic [ref=e783]: The Rocket
                    - generic [ref=e787]:
                      - generic [ref=e788]: Pub
                      - generic [ref=e789]: 1.1 km
                      - generic [ref=e790]: £6.80
                - listitem [ref=e792]:
                  - button "The Northumberland Arms Pub 1.1 km £6.50" [ref=e793] [cursor=pointer]:
                    - generic [ref=e794]: The Northumberland Arms
                    - generic [ref=e798]:
                      - generic [ref=e799]: Pub
                      - generic [ref=e800]: 1.1 km
                      - generic [ref=e801]: £6.50
                - listitem [ref=e803]:
                  - button "Royal George (Euston) Pub 1.2 km £6.20" [ref=e804] [cursor=pointer]:
                    - generic [ref=e805]: Royal George (Euston)
                    - generic [ref=e809]:
                      - generic [ref=e810]: Pub
                      - generic [ref=e811]: 1.2 km
                      - generic [ref=e812]: £6.20
                - listitem [ref=e814]:
                  - button "The George & Monkey Pub 1.3 km £6.20" [ref=e815] [cursor=pointer]:
                    - generic [ref=e816]: The George & Monkey
                    - generic [ref=e820]:
                      - generic [ref=e821]: Pub
                      - generic [ref=e822]: 1.3 km
                      - generic [ref=e823]: £6.20
                - listitem [ref=e825]:
                  - button "Signal Box Pub 1.3 km £6.25" [ref=e826] [cursor=pointer]:
                    - generic [ref=e827]: Signal Box
                    - generic [ref=e831]:
                      - generic [ref=e832]: Pub
                      - generic [ref=e833]: 1.3 km
                      - generic [ref=e834]: £6.25
                - listitem [ref=e836]:
                  - button "Roti King Euston Restaurant 1.3 km Chicken Roti Canai · £10.95 Aug · rotiking.com" [ref=e837] [cursor=pointer]:
                    - generic [ref=e838]: Roti King Euston
                    - generic [ref=e842]:
                      - generic [ref=e843]: Restaurant
                      - generic [ref=e844]: 1.3 km
                      - generic [ref=e845]:
                        - generic [ref=e846]: Chicken Roti Canai · £10.95
                        - generic [ref=e847]: Aug · rotiking.com
                - listitem [ref=e848]:
                  - button "Crown & Anchor Pub 1.4 km £6.55" [ref=e849] [cursor=pointer]:
                    - generic [ref=e850]: Crown & Anchor
                    - generic [ref=e854]:
                      - generic [ref=e855]: Pub
                      - generic [ref=e856]: 1.4 km
                      - generic [ref=e857]: £6.55
                - listitem [ref=e859]:
                  - button "Prince of Wales, Euston Pub 1.6 km Price TBD" [ref=e860] [cursor=pointer]:
                    - generic [ref=e861]: Prince of Wales, Euston
                    - generic [ref=e865]:
                      - generic [ref=e866]: Pub
                      - generic [ref=e867]: 1.6 km
                      - generic [ref=e868]: Price TBD
            - region "Other pubs and bars with no listed price" [ref=e869]:
              - heading "Other pubs and bars · no listed price" [level=3] [ref=e870]
              - list "Other pubs and bars with no listed price" [ref=e871]:
                - listitem [ref=e872]:
                  - button "The Square Pig and Pen 152 m Other pub · no listed price" [ref=e873] [cursor=pointer]:
                    - generic [ref=e874]: The Square Pig and Pen
                    - generic [ref=e878]:
                      - generic [ref=e879]: 152 m
                      - generic [ref=e880]: Other pub · no listed price
                - listitem [ref=e881]:
                  - button "The Queen's Larder 222 m Other pub · no listed price" [ref=e882] [cursor=pointer]:
                    - generic [ref=e883]: The Queen's Larder
                    - generic [ref=e887]:
                      - generic [ref=e888]: 222 m
                      - generic [ref=e889]: Other pub · no listed price
                - listitem [ref=e890]:
                  - button "Dean's Bar 244 m Other pub · no listed price" [ref=e891] [cursor=pointer]:
                    - generic [ref=e892]: Dean's Bar
                    - generic [ref=e896]:
                      - generic [ref=e897]: 244 m
                      - generic [ref=e898]: Other pub · no listed price
                - listitem [ref=e899]:
                  - button "The Polish Bar (Na Zdrowie) 303 m Other bar · no listed price" [ref=e900] [cursor=pointer]:
                    - generic [ref=e901]: The Polish Bar (Na Zdrowie)
                    - generic [ref=e905]:
                      - generic [ref=e906]: 303 m
                      - generic [ref=e907]: Other bar · no listed price
                - listitem [ref=e908]:
                  - button "Ship Tavern 311 m Other pub · no listed price" [ref=e909] [cursor=pointer]:
                    - generic [ref=e910]: Ship Tavern
                    - generic [ref=e914]:
                      - generic [ref=e915]: 311 m
                      - generic [ref=e916]: Other pub · no listed price
                - listitem [ref=e917]:
                  - button "The Old Red Lion 311 m Other pub · no listed price" [ref=e918] [cursor=pointer]:
                    - generic [ref=e919]: The Old Red Lion
                    - generic [ref=e923]:
                      - generic [ref=e924]: 311 m
                      - generic [ref=e925]: Other pub · no listed price
                - listitem [ref=e926]:
                  - button "Shakespeare's Head 350 m Other pub · no listed price" [ref=e927] [cursor=pointer]:
                    - generic [ref=e928]: Shakespeare's Head
                    - generic [ref=e932]:
                      - generic [ref=e933]: 350 m
                      - generic [ref=e934]: Other pub · no listed price
                - listitem [ref=e935]:
                  - button "Bar Barella's 369 m Other bar · no listed price" [ref=e936] [cursor=pointer]:
                    - generic [ref=e937]: Bar Barella's
                    - generic [ref=e941]:
                      - generic [ref=e942]: 369 m
                      - generic [ref=e943]: Other bar · no listed price
                - listitem [ref=e944]:
                  - button "Simmons 377 m Other bar · no listed price" [ref=e945] [cursor=pointer]:
                    - generic [ref=e946]: Simmons
                    - generic [ref=e950]:
                      - generic [ref=e951]: 377 m
                      - generic [ref=e952]: Other bar · no listed price
                - listitem [ref=e953]:
                  - button "Davy's Wine House 378 m Other bar · no listed price" [ref=e954] [cursor=pointer]:
                    - generic [ref=e955]: Davy's Wine House
                    - generic [ref=e959]:
                      - generic [ref=e960]: 378 m
                      - generic [ref=e961]: Other bar · no listed price
                - listitem [ref=e962]:
                  - button "Penderel's Oak 382 m Other pub · no listed price" [ref=e963] [cursor=pointer]:
                    - generic [ref=e964]: Penderel's Oak
                    - generic [ref=e968]:
                      - generic [ref=e969]: 382 m
                      - generic [ref=e970]: Other pub · no listed price
                - listitem [ref=e971]:
                  - button "WC Wine Bar 385 m Other bar · no listed price" [ref=e972] [cursor=pointer]:
                    - generic [ref=e973]: WC Wine Bar
                    - generic [ref=e977]:
                      - generic [ref=e978]: 385 m
                      - generic [ref=e979]: Other bar · no listed price
                - listitem [ref=e980]:
                  - button "All Bar One 410 m Other bar · no listed price" [ref=e981] [cursor=pointer]:
                    - generic [ref=e982]: All Bar One
                    - generic [ref=e986]:
                      - generic [ref=e987]: 410 m
                      - generic [ref=e988]: Other bar · no listed price
                - listitem [ref=e989]:
                  - button "The Lady Ottoline 410 m Other pub · no listed price" [ref=e990] [cursor=pointer]:
                    - generic [ref=e991]: The Lady Ottoline
                    - generic [ref=e995]:
                      - generic [ref=e996]: 410 m
                      - generic [ref=e997]: Other pub · no listed price
                - listitem [ref=e998]:
                  - button "The George 427 m Other pub · no listed price" [ref=e999] [cursor=pointer]:
                    - generic [ref=e1000]: The George
                    - generic [ref=e1004]:
                      - generic [ref=e1005]: 427 m
                      - generic [ref=e1006]: Other pub · no listed price
                - listitem [ref=e1007]:
                  - button "Fitz's 437 m Other bar · no listed price" [ref=e1008] [cursor=pointer]:
                    - generic [ref=e1009]: Fitz's
                    - generic [ref=e1013]:
                      - generic [ref=e1014]: 437 m
                      - generic [ref=e1015]: Other bar · no listed price
                - listitem [ref=e1016]:
                  - button "Horse and Wig 459 m Other pub · no listed price" [ref=e1017] [cursor=pointer]:
                    - generic [ref=e1018]: Horse and Wig
                    - generic [ref=e1022]:
                      - generic [ref=e1023]: 459 m
                      - generic [ref=e1024]: Other pub · no listed price
                - listitem [ref=e1025]:
                  - button "The Old Crown Pub 483 m Other pub · no listed price" [ref=e1026] [cursor=pointer]:
                    - generic [ref=e1027]: The Old Crown Pub
                    - generic [ref=e1031]:
                      - generic [ref=e1032]: 483 m
                      - generic [ref=e1033]: Other pub · no listed price
                - listitem [ref=e1034]:
                  - button "The Bridge Bar 496 m Other bar · no listed price" [ref=e1035] [cursor=pointer]:
                    - generic [ref=e1036]: The Bridge Bar
                    - generic [ref=e1040]:
                      - generic [ref=e1041]: 496 m
                      - generic [ref=e1042]: Other bar · no listed price
                - listitem [ref=e1043]:
                  - button "The Bowery Bar 496 m Other bar · no listed price" [ref=e1044] [cursor=pointer]:
                    - generic [ref=e1045]: The Bowery Bar
                    - generic [ref=e1049]:
                      - generic [ref=e1050]: 496 m
                      - generic [ref=e1051]: Other bar · no listed price
                - listitem [ref=e1052]:
                  - button "Sandbox VR 497 m Other bar · no listed price" [ref=e1053] [cursor=pointer]:
                    - generic [ref=e1054]: Sandbox VR
                    - generic [ref=e1058]:
                      - generic [ref=e1059]: 497 m
                      - generic [ref=e1060]: Other bar · no listed price
                - listitem [ref=e1061]:
                  - button "Sway 498 m Other pub · no listed price" [ref=e1062] [cursor=pointer]:
                    - generic [ref=e1063]: Sway
                    - generic [ref=e1067]:
                      - generic [ref=e1068]: 498 m
                      - generic [ref=e1069]: Other pub · no listed price
                - listitem [ref=e1070]:
                  - button "The White Hart 508 m Other pub · no listed price" [ref=e1071] [cursor=pointer]:
                    - generic [ref=e1072]: The White Hart
                    - generic [ref=e1076]:
                      - generic [ref=e1077]: 508 m
                      - generic [ref=e1078]: Other pub · no listed price
                - listitem [ref=e1079]:
                  - button "Lockes 530 m Other bar · no listed price" [ref=e1080] [cursor=pointer]:
                    - generic [ref=e1081]: Lockes
                    - generic [ref=e1085]:
                      - generic [ref=e1086]: 530 m
                      - generic [ref=e1087]: Other bar · no listed price
                - listitem [ref=e1088]:
                  - button "The Bloomsbury 530 m Other pub · no listed price" [ref=e1089] [cursor=pointer]:
                    - generic [ref=e1090]: The Bloomsbury
                    - generic [ref=e1094]:
                      - generic [ref=e1095]: 530 m
                      - generic [ref=e1096]: Other pub · no listed price
                - listitem [ref=e1097]:
                  - button "Guanabara 546 m Other bar · no listed price" [ref=e1098] [cursor=pointer]:
                    - generic [ref=e1099]: Guanabara
                    - generic [ref=e1103]:
                      - generic [ref=e1104]: 546 m
                      - generic [ref=e1105]: Other bar · no listed price
                - listitem [ref=e1106]:
                  - button "Piano Works West-End 547 m Other bar · no listed price" [ref=e1107] [cursor=pointer]:
                    - generic [ref=e1108]: Piano Works West-End
                    - generic [ref=e1112]:
                      - generic [ref=e1113]: 547 m
                      - generic [ref=e1114]: Other bar · no listed price
                - listitem [ref=e1115]:
                  - button "London Cocktail 563 m Other bar · no listed price" [ref=e1116] [cursor=pointer]:
                    - generic [ref=e1117]: London Cocktail
                    - generic [ref=e1121]:
                      - generic [ref=e1122]: 563 m
                      - generic [ref=e1123]: Other bar · no listed price
                - listitem [ref=e1124]:
                  - button "Callaghan's 564 m Other pub · no listed price" [ref=e1125] [cursor=pointer]:
                    - generic [ref=e1126]: Callaghan's
                    - generic [ref=e1130]:
                      - generic [ref=e1131]: 564 m
                      - generic [ref=e1132]: Other pub · no listed price
                - listitem [ref=e1133]:
                  - button "The Rabbit Hole 565 m Other bar · no listed price" [ref=e1134] [cursor=pointer]:
                    - generic [ref=e1135]: The Rabbit Hole
                    - generic [ref=e1139]:
                      - generic [ref=e1140]: 565 m
                      - generic [ref=e1141]: Other bar · no listed price
                - listitem [ref=e1142]:
                  - button "The Crown 565 m Other pub · no listed price" [ref=e1143] [cursor=pointer]:
                    - generic [ref=e1144]: The Crown
                    - generic [ref=e1148]:
                      - generic [ref=e1149]: 565 m
                      - generic [ref=e1150]: Other pub · no listed price
                - listitem [ref=e1151]:
                  - button "Philomena's Irish Bar & Kitchen 570 m Other pub · no listed price" [ref=e1152] [cursor=pointer]:
                    - generic [ref=e1153]: Philomena's Irish Bar & Kitchen
                    - generic [ref=e1157]:
                      - generic [ref=e1158]: 570 m
                      - generic [ref=e1159]: Other pub · no listed price
                - listitem [ref=e1160]:
                  - button "The Sun 576 m Other pub · no listed price" [ref=e1161] [cursor=pointer]:
                    - generic [ref=e1162]: The Sun
                    - generic [ref=e1166]:
                      - generic [ref=e1167]: 576 m
                      - generic [ref=e1168]: Other pub · no listed price
                - listitem [ref=e1169]:
                  - button "London Welsh Bar 579 m Other pub · no listed price" [ref=e1170] [cursor=pointer]:
                    - generic [ref=e1171]: London Welsh Bar
                    - generic [ref=e1175]:
                      - generic [ref=e1176]: 579 m
                      - generic [ref=e1177]: Other pub · no listed price
                - listitem [ref=e1178]:
                  - button "PimpShuei 594 m Other bar · no listed price" [ref=e1179] [cursor=pointer]:
                    - generic [ref=e1180]: PimpShuei
                    - generic [ref=e1184]:
                      - generic [ref=e1185]: 594 m
                      - generic [ref=e1186]: Other bar · no listed price
                - listitem [ref=e1187]:
                  - button "The Three Tuns 598 m Other pub · no listed price" [ref=e1188] [cursor=pointer]:
                    - generic [ref=e1189]: The Three Tuns
                    - generic [ref=e1193]:
                      - generic [ref=e1194]: 598 m
                      - generic [ref=e1195]: Other pub · no listed price
                - listitem [ref=e1196]:
                  - button "Flight Club 621 m Other bar · no listed price" [ref=e1197] [cursor=pointer]:
                    - generic [ref=e1198]: Flight Club
                    - generic [ref=e1202]:
                      - generic [ref=e1203]: 621 m
                      - generic [ref=e1204]: Other bar · no listed price
                - listitem [ref=e1205]:
                  - button "Ye Olde White Horse 624 m Other pub · no listed price" [ref=e1206] [cursor=pointer]:
                    - generic [ref=e1207]: Ye Olde White Horse
                    - generic [ref=e1211]:
                      - generic [ref=e1212]: 624 m
                      - generic [ref=e1213]: Other pub · no listed price
                - listitem [ref=e1214]:
                  - button "The Institute Bar 630 m Other bar · no listed price" [ref=e1215] [cursor=pointer]:
                    - generic [ref=e1216]: The Institute Bar
                    - generic [ref=e1220]:
                      - generic [ref=e1221]: 630 m
                      - generic [ref=e1222]: Other bar · no listed price
                - listitem [ref=e1223]:
                  - button "Craft Beer Co. 637 m Other pub · no listed price" [ref=e1224] [cursor=pointer]:
                    - generic [ref=e1225]: Craft Beer Co.
                    - generic [ref=e1229]:
                      - generic [ref=e1230]: 637 m
                      - generic [ref=e1231]: Other pub · no listed price
                - listitem [ref=e1232]:
                  - button "London Pub 665 m Other pub · no listed price" [ref=e1233] [cursor=pointer]:
                    - generic [ref=e1234]: London Pub
                    - generic [ref=e1238]:
                      - generic [ref=e1239]: 665 m
                      - generic [ref=e1240]: Other pub · no listed price
                - listitem [ref=e1241]:
                  - button "Freud 682 m Other bar · no listed price" [ref=e1242] [cursor=pointer]:
                    - generic [ref=e1243]: Freud
                    - generic [ref=e1247]:
                      - generic [ref=e1248]: 682 m
                      - generic [ref=e1249]: Other bar · no listed price
                - listitem [ref=e1250]:
                  - button "Freud 686 m Other bar · no listed price" [ref=e1251] [cursor=pointer]:
                    - generic [ref=e1252]: Freud
                    - generic [ref=e1256]:
                      - generic [ref=e1257]: 686 m
                      - generic [ref=e1258]: Other bar · no listed price
                - listitem [ref=e1259]:
                  - button "The Clerk & Well 689 m Other pub · no listed price" [ref=e1260] [cursor=pointer]:
                    - generic [ref=e1261]: The Clerk & Well
                    - generic [ref=e1265]:
                      - generic [ref=e1266]: 689 m
                      - generic [ref=e1267]: Other pub · no listed price
                - listitem [ref=e1268]:
                  - button "The Sun Tavern 693 m Other pub · no listed price" [ref=e1269] [cursor=pointer]:
                    - generic [ref=e1270]: The Sun Tavern
                    - generic [ref=e1274]:
                      - generic [ref=e1275]: 693 m
                      - generic [ref=e1276]: Other pub · no listed price
                - listitem [ref=e1277]:
                  - button "The Cross Keys 693 m Other pub · no listed price" [ref=e1278] [cursor=pointer]:
                    - generic [ref=e1279]: The Cross Keys
                    - generic [ref=e1283]:
                      - generic [ref=e1284]: 693 m
                      - generic [ref=e1285]: Other pub · no listed price
                - listitem [ref=e1286]:
                  - button "The Bloomsbury Club 707 m Other bar · no listed price" [ref=e1287] [cursor=pointer]:
                    - generic [ref=e1288]: The Bloomsbury Club
                    - generic [ref=e1292]:
                      - generic [ref=e1293]: 707 m
                      - generic [ref=e1294]: Other bar · no listed price
                - listitem [ref=e1295]:
                  - button "All Bar One 718 m Other bar · no listed price" [ref=e1296] [cursor=pointer]:
                    - generic [ref=e1297]: All Bar One
                    - generic [ref=e1301]:
                      - generic [ref=e1302]: 718 m
                      - generic [ref=e1303]: Other bar · no listed price
                - listitem [ref=e1304]:
                  - button "The Gunmakers 719 m Other pub · no listed price" [ref=e1305] [cursor=pointer]:
                    - generic [ref=e1306]: The Gunmakers
                    - generic [ref=e1310]:
                      - generic [ref=e1311]: 719 m
                      - generic [ref=e1312]: Other pub · no listed price
                - listitem [ref=e1313]:
                  - button "The Craft Beer Co. 725 m Other pub · no listed price" [ref=e1314] [cursor=pointer]:
                    - generic [ref=e1315]: The Craft Beer Co.
                    - generic [ref=e1319]:
                      - generic [ref=e1320]: 725 m
                      - generic [ref=e1321]: Other pub · no listed price
                - listitem [ref=e1322]:
                  - button "Bloomsbury Lanes 726 m Other bar · no listed price" [ref=e1323] [cursor=pointer]:
                    - generic [ref=e1324]: Bloomsbury Lanes
                    - generic [ref=e1328]:
                      - generic [ref=e1329]: 726 m
                      - generic [ref=e1330]: Other bar · no listed price
                - listitem [ref=e1331]:
                  - button "Grand Union – Chancery Lane 736 m Other bar · no listed price" [ref=e1332] [cursor=pointer]:
                    - generic [ref=e1333]: Grand Union – Chancery Lane
                    - generic [ref=e1337]:
                      - generic [ref=e1338]: 736 m
                      - generic [ref=e1339]: Other bar · no listed price
                - listitem [ref=e1340]:
                  - button "The Angel 739 m Other pub · no listed price" [ref=e1341] [cursor=pointer]:
                    - generic [ref=e1342]: The Angel
                    - generic [ref=e1346]:
                      - generic [ref=e1347]: 739 m
                      - generic [ref=e1348]: Other pub · no listed price
                - listitem [ref=e1349]:
                  - button "Amelie's Wine House 752 m Other bar · no listed price" [ref=e1350] [cursor=pointer]:
                    - generic [ref=e1351]: Amelie's Wine House
                    - generic [ref=e1355]:
                      - generic [ref=e1356]: 752 m
                      - generic [ref=e1357]: Other bar · no listed price
                - listitem [ref=e1358]:
                  - button "The Crown and Anchor 753 m Other pub · no listed price" [ref=e1359] [cursor=pointer]:
                    - generic [ref=e1360]: The Crown and Anchor
                    - generic [ref=e1364]:
                      - generic [ref=e1365]: 753 m
                      - generic [ref=e1366]: Other pub · no listed price
                - listitem [ref=e1367]:
                  - button "26 Furnival Street 761 m Other pub · no listed price" [ref=e1368] [cursor=pointer]:
                    - generic [ref=e1369]: 26 Furnival Street
                    - generic [ref=e1373]:
                      - generic [ref=e1374]: 761 m
                      - generic [ref=e1375]: Other pub · no listed price
                - listitem [ref=e1376]:
                  - button "The Last Judgement 772 m Other pub · no listed price" [ref=e1377] [cursor=pointer]:
                    - generic [ref=e1378]: The Last Judgement
                    - generic [ref=e1382]:
                      - generic [ref=e1383]: 772 m
                      - generic [ref=e1384]: Other pub · no listed price
                - listitem [ref=e1385]:
                  - button "St. John 776 m Other bar · no listed price" [ref=e1386] [cursor=pointer]:
                    - generic [ref=e1387]: St. John
                    - generic [ref=e1391]:
                      - generic [ref=e1392]: 776 m
                      - generic [ref=e1393]: Other bar · no listed price
                - listitem [ref=e1394]:
                  - button "The Argyle 777 m Other pub · no listed price" [ref=e1395] [cursor=pointer]:
                    - generic [ref=e1396]: The Argyle
                    - generic [ref=e1400]:
                      - generic [ref=e1401]: 777 m
                      - generic [ref=e1402]: Other pub · no listed price
                - listitem [ref=e1403]:
                  - button "Shuffleboard Bar London 782 m Other pub · no listed price" [ref=e1404] [cursor=pointer]:
                    - generic [ref=e1405]: Shuffleboard Bar London
                    - generic [ref=e1409]:
                      - generic [ref=e1410]: 782 m
                      - generic [ref=e1411]: Other pub · no listed price
                - listitem [ref=e1412]:
                  - button "The Lower Third 806 m Other bar · no listed price" [ref=e1413] [cursor=pointer]:
                    - generic [ref=e1414]: The Lower Third
                    - generic [ref=e1418]:
                      - generic [ref=e1419]: 806 m
                      - generic [ref=e1420]: Other bar · no listed price
                - listitem [ref=e1421]:
                  - button "Thirt3en 807 m Other bar · no listed price" [ref=e1422] [cursor=pointer]:
                    - generic [ref=e1423]: Thirt3en
                    - generic [ref=e1427]:
                      - generic [ref=e1428]: 807 m
                      - generic [ref=e1429]: Other bar · no listed price
                - listitem [ref=e1430]:
                  - button "The Coach 814 m Other pub · no listed price" [ref=e1431] [cursor=pointer]:
                    - generic [ref=e1432]: The Coach
                    - generic [ref=e1436]:
                      - generic [ref=e1437]: 814 m
                      - generic [ref=e1438]: Other pub · no listed price
                - listitem [ref=e1439]:
                  - button "Norfolk Arms 821 m Other pub · no listed price" [ref=e1440] [cursor=pointer]:
                    - generic [ref=e1441]: Norfolk Arms
                    - generic [ref=e1445]:
                      - generic [ref=e1446]: 821 m
                      - generic [ref=e1447]: Other pub · no listed price
                - listitem [ref=e1448]:
                  - button "Bounce Farringdon 839 m Other bar · no listed price" [ref=e1449] [cursor=pointer]:
                    - generic [ref=e1450]: Bounce Farringdon
                    - generic [ref=e1454]:
                      - generic [ref=e1455]: 839 m
                      - generic [ref=e1456]: Other bar · no listed price
                - listitem [ref=e1457]:
                  - button "Dram 842 m Other bar · no listed price" [ref=e1458] [cursor=pointer]:
                    - generic [ref=e1459]: Dram
                    - generic [ref=e1463]:
                      - generic [ref=e1464]: 842 m
                      - generic [ref=e1465]: Other bar · no listed price
                - listitem [ref=e1466]:
                  - button "White Swan 842 m Other pub · no listed price" [ref=e1467] [cursor=pointer]:
                    - generic [ref=e1468]: White Swan
                    - generic [ref=e1472]:
                      - generic [ref=e1473]: 842 m
                      - generic [ref=e1474]: Other pub · no listed price
                - listitem [ref=e1475]:
                  - button "The Hat and Tun 845 m Other pub · no listed price" [ref=e1476] [cursor=pointer]:
                    - generic [ref=e1477]: The Hat and Tun
                    - generic [ref=e1481]:
                      - generic [ref=e1482]: 845 m
                      - generic [ref=e1483]: Other pub · no listed price
                - listitem [ref=e1484]:
                  - button "The Eagle 846 m Other pub · no listed price" [ref=e1485] [cursor=pointer]:
                    - generic [ref=e1486]: The Eagle
                    - generic [ref=e1490]:
                      - generic [ref=e1491]: 846 m
                      - generic [ref=e1492]: Other pub · no listed price
                - listitem [ref=e1493]:
                  - button "Baranis 847 m Other bar · no listed price" [ref=e1494] [cursor=pointer]:
                    - generic [ref=e1495]: Baranis
                    - generic [ref=e1499]:
                      - generic [ref=e1500]: 847 m
                      - generic [ref=e1501]: Other bar · no listed price
                - listitem [ref=e1502]:
                  - button "The Jack Horner 853 m Other pub · no listed price" [ref=e1503] [cursor=pointer]:
                    - generic [ref=e1504]: The Jack Horner
                    - generic [ref=e1508]:
                      - generic [ref=e1509]: 853 m
                      - generic [ref=e1510]: Other pub · no listed price
                - listitem [ref=e1511]:
                  - button "The Union Tavern 871 m Other pub · no listed price" [ref=e1512] [cursor=pointer]:
                    - generic [ref=e1513]: The Union Tavern
                    - generic [ref=e1517]:
                      - generic [ref=e1518]: 871 m
                      - generic [ref=e1519]: Other pub · no listed price
                - listitem [ref=e1520]:
                  - button "The Clerkenwell Tavern 873 m Other pub · no listed price" [ref=e1521] [cursor=pointer]:
                    - generic [ref=e1522]: The Clerkenwell Tavern
                    - generic [ref=e1526]:
                      - generic [ref=e1527]: 873 m
                      - generic [ref=e1528]: Other pub · no listed price
                - listitem [ref=e1529]:
                  - button "The Piano Works 884 m Other bar · no listed price" [ref=e1530] [cursor=pointer]:
                    - generic [ref=e1531]: The Piano Works
                    - generic [ref=e1535]:
                      - generic [ref=e1536]: 884 m
                      - generic [ref=e1537]: Other bar · no listed price
                - listitem [ref=e1538]:
                  - button "Sevilla Mia 901 m Other bar · no listed price" [ref=e1539] [cursor=pointer]:
                    - generic [ref=e1540]: Sevilla Mia
                    - generic [ref=e1544]:
                      - generic [ref=e1545]: 901 m
                      - generic [ref=e1546]: Other bar · no listed price
                - listitem [ref=e1547]:
                  - button "The Bleeding Heart Tavern 905 m Other pub · no listed price" [ref=e1548] [cursor=pointer]:
                    - generic [ref=e1549]: The Bleeding Heart Tavern
                    - generic [ref=e1553]:
                      - generic [ref=e1554]: 905 m
                      - generic [ref=e1555]: Other pub · no listed price
                - listitem [ref=e1556]:
                  - button "Ninth Ward 906 m Other pub · no listed price" [ref=e1557] [cursor=pointer]:
                    - generic [ref=e1558]: Ninth Ward
                    - generic [ref=e1562]:
                      - generic [ref=e1563]: 906 m
                      - generic [ref=e1564]: Other pub · no listed price
                - listitem [ref=e1565]:
                  - button "Betsey Trotwood 907 m Other pub · no listed price" [ref=e1566] [cursor=pointer]:
                    - generic [ref=e1567]: Betsey Trotwood
                    - generic [ref=e1571]:
                      - generic [ref=e1572]: 907 m
                      - generic [ref=e1573]: Other pub · no listed price
                - listitem [ref=e1574]:
                  - button "Simmons Bar 908 m Other bar · no listed price" [ref=e1575] [cursor=pointer]:
                    - generic [ref=e1576]: Simmons Bar
                    - generic [ref=e1580]:
                      - generic [ref=e1581]: 908 m
                      - generic [ref=e1582]: Other bar · no listed price
                - listitem [ref=e1583]:
                  - button "21Soho 908 m Other bar · no listed price" [ref=e1584] [cursor=pointer]:
                    - generic [ref=e1585]: 21Soho
                    - generic [ref=e1589]:
                      - generic [ref=e1590]: 908 m
                      - generic [ref=e1591]: Other bar · no listed price
                - listitem [ref=e1592]:
                  - button "The Queens Head 924 m Other pub · no listed price" [ref=e1593] [cursor=pointer]:
                    - generic [ref=e1594]: The Queens Head
                    - generic [ref=e1598]:
                      - generic [ref=e1599]: 924 m
                      - generic [ref=e1600]: Other pub · no listed price
                - listitem [ref=e1601]:
                  - button "The Editor's Tap 934 m Other bar · no listed price" [ref=e1602] [cursor=pointer]:
                    - generic [ref=e1603]: The Editor's Tap
                    - generic [ref=e1607]:
                      - generic [ref=e1608]: 934 m
                      - generic [ref=e1609]: Other bar · no listed price
                - listitem [ref=e1610]:
                  - button "The One Tun 938 m Other pub · no listed price" [ref=e1611] [cursor=pointer]:
                    - generic [ref=e1612]: The One Tun
                    - generic [ref=e1616]:
                      - generic [ref=e1617]: 938 m
                      - generic [ref=e1618]: Other pub · no listed price
                - listitem [ref=e1619]:
                  - button "Murder Inc. Cocktails 947 m Other bar · no listed price" [ref=e1620] [cursor=pointer]:
                    - generic [ref=e1621]: Murder Inc. Cocktails
                    - generic [ref=e1625]:
                      - generic [ref=e1626]: 947 m
                      - generic [ref=e1627]: Other bar · no listed price
                - listitem [ref=e1628]:
                  - button "The Royal Cocktail Exchange 948 m Other bar · no listed price" [ref=e1629] [cursor=pointer]:
                    - generic [ref=e1630]: The Royal Cocktail Exchange
                    - generic [ref=e1634]:
                      - generic [ref=e1635]: 948 m
                      - generic [ref=e1636]: Other bar · no listed price
                - listitem [ref=e1637]:
                  - button "Bradley's Spanish Bar 958 m Other pub · no listed price" [ref=e1638] [cursor=pointer]:
                    - generic [ref=e1639]: Bradley's Spanish Bar
                    - generic [ref=e1643]:
                      - generic [ref=e1644]: 958 m
                      - generic [ref=e1645]: Other pub · no listed price
                - listitem [ref=e1646]:
                  - button "The City Pride 959 m Other pub · no listed price" [ref=e1647] [cursor=pointer]:
                    - generic [ref=e1648]: The City Pride
                    - generic [ref=e1652]:
                      - generic [ref=e1653]: 959 m
                      - generic [ref=e1654]: Other pub · no listed price
                - listitem [ref=e1655]:
                  - button "Bricklayers Arms 960 m Other pub · no listed price" [ref=e1656] [cursor=pointer]:
                    - generic [ref=e1657]: Bricklayers Arms
                    - generic [ref=e1661]:
                      - generic [ref=e1662]: 960 m
                      - generic [ref=e1663]: Other pub · no listed price
                - listitem [ref=e1664]:
                  - button "Exmouth Arms 960 m Other pub · no listed price" [ref=e1665] [cursor=pointer]:
                    - generic [ref=e1666]: Exmouth Arms
                    - generic [ref=e1670]:
                      - generic [ref=e1671]: 960 m
                      - generic [ref=e1672]: Other pub · no listed price
                - listitem [ref=e1673]:
                  - button "The Raven 966 m Other bar · no listed price" [ref=e1674] [cursor=pointer]:
                    - generic [ref=e1675]: The Raven
                    - generic [ref=e1679]:
                      - generic [ref=e1680]: 966 m
                      - generic [ref=e1681]: Other bar · no listed price
                - listitem [ref=e1682]:
                  - button "The Wilmington 967 m Other pub · no listed price" [ref=e1683] [cursor=pointer]:
                    - generic [ref=e1684]: The Wilmington
                    - generic [ref=e1688]:
                      - generic [ref=e1689]: 967 m
                      - generic [ref=e1690]: Other pub · no listed price
                - listitem [ref=e1691]:
                  - button "68 and Boston 967 m Other bar · no listed price" [ref=e1692] [cursor=pointer]:
                    - generic [ref=e1693]: 68 and Boston
                    - generic [ref=e1697]:
                      - generic [ref=e1698]: 967 m
                      - generic [ref=e1699]: Other bar · no listed price
                - listitem [ref=e1700]:
                  - button "The Sir John Oldcastle 970 m Other pub · no listed price" [ref=e1701] [cursor=pointer]:
                    - generic [ref=e1702]: The Sir John Oldcastle
                    - generic [ref=e1706]:
                      - generic [ref=e1707]: 970 m
                      - generic [ref=e1708]: Other pub · no listed price
                - listitem [ref=e1709]:
                  - button "Black Horse 971 m Other pub · no listed price" [ref=e1710] [cursor=pointer]:
                    - generic [ref=e1711]: Black Horse
                    - generic [ref=e1715]:
                      - generic [ref=e1716]: 971 m
                      - generic [ref=e1717]: Other pub · no listed price
                - listitem [ref=e1718]:
                  - button "Louche 972 m Other bar · no listed price" [ref=e1719] [cursor=pointer]:
                    - generic [ref=e1720]: Louche
                    - generic [ref=e1724]:
                      - generic [ref=e1725]: 972 m
                      - generic [ref=e1726]: Other bar · no listed price
                - listitem [ref=e1727]:
                  - button "Simmons 972 m Other bar · no listed price" [ref=e1728] [cursor=pointer]:
                    - generic [ref=e1729]: Simmons
                    - generic [ref=e1733]:
                      - generic [ref=e1734]: 972 m
                      - generic [ref=e1735]: Other bar · no listed price
                - listitem [ref=e1736]:
                  - button "The Marlborough Arms 974 m Other pub · no listed price" [ref=e1737] [cursor=pointer]:
                    - generic [ref=e1738]: The Marlborough Arms
                    - generic [ref=e1742]:
                      - generic [ref=e1743]: 974 m
                      - generic [ref=e1744]: Other pub · no listed price
                - listitem [ref=e1745]:
                  - button "Jazz After Dark 975 m Other bar · no listed price" [ref=e1746] [cursor=pointer]:
                    - generic [ref=e1747]: Jazz After Dark
                    - generic [ref=e1751]:
                      - generic [ref=e1752]: 975 m
                      - generic [ref=e1753]: Other bar · no listed price
                - listitem [ref=e1754]:
                  - button "Skinners Arms 977 m Other pub · no listed price" [ref=e1755] [cursor=pointer]:
                    - generic [ref=e1756]: Skinners Arms
                    - generic [ref=e1760]:
                      - generic [ref=e1761]: 977 m
                      - generic [ref=e1762]: Other pub · no listed price
                - listitem [ref=e1763]:
                  - button "Crazy Bear Fitzrovia 985 m Other bar · no listed price" [ref=e1764] [cursor=pointer]:
                    - generic [ref=e1765]: Crazy Bear Fitzrovia
                    - generic [ref=e1769]:
                      - generic [ref=e1770]: 985 m
                      - generic [ref=e1771]: Other bar · no listed price
                - listitem [ref=e1772]:
                  - button "The Carpenters Arms 988 m Other pub · no listed price" [ref=e1773] [cursor=pointer]:
                    - generic [ref=e1774]: The Carpenters Arms
                    - generic [ref=e1778]:
                      - generic [ref=e1779]: 988 m
                      - generic [ref=e1780]: Other pub · no listed price
                - listitem [ref=e1781]:
                  - button "The Green 991 m Other pub · no listed price" [ref=e1782] [cursor=pointer]:
                    - generic [ref=e1783]: The Green
                    - generic [ref=e1787]:
                      - generic [ref=e1788]: 991 m
                      - generic [ref=e1789]: Other pub · no listed price
                - listitem [ref=e1790]:
                  - button "Zebrano 992 m Other bar · no listed price" [ref=e1791] [cursor=pointer]:
                    - generic [ref=e1792]: Zebrano
                    - generic [ref=e1796]:
                      - generic [ref=e1797]: 992 m
                      - generic [ref=e1798]: Other bar · no listed price
                - listitem [ref=e1799]:
                  - button "Be At One 994 m Other bar · no listed price" [ref=e1800] [cursor=pointer]:
                    - generic [ref=e1801]: Be At One
                    - generic [ref=e1805]:
                      - generic [ref=e1806]: 994 m
                      - generic [ref=e1807]: Other bar · no listed price
                - listitem [ref=e1808]:
                  - button "Mikkeller Brewpub London 998 m Other pub · no listed price" [ref=e1809] [cursor=pointer]:
                    - generic [ref=e1810]: Mikkeller Brewpub London
                    - generic [ref=e1814]:
                      - generic [ref=e1815]: 998 m
                      - generic [ref=e1816]: Other pub · no listed price
                - listitem [ref=e1817]:
                  - button "Thirst Bar 1.0 km Other bar · no listed price" [ref=e1818] [cursor=pointer]:
                    - generic [ref=e1819]: Thirst Bar
                    - generic [ref=e1823]:
                      - generic [ref=e1824]: 1.0 km
                      - generic [ref=e1825]: Other bar · no listed price
                - listitem [ref=e1826]:
                  - button "Horseshoe 1.0 km Other pub · no listed price" [ref=e1827] [cursor=pointer]:
                    - generic [ref=e1828]: Horseshoe
                    - generic [ref=e1832]:
                      - generic [ref=e1833]: 1.0 km
                      - generic [ref=e1834]: Other pub · no listed price
                - listitem [ref=e1835]:
                  - button "Cafe Kick 1.0 km Other bar · no listed price" [ref=e1836] [cursor=pointer]:
                    - generic [ref=e1837]: Cafe Kick
                    - generic [ref=e1841]:
                      - generic [ref=e1842]: 1.0 km
                      - generic [ref=e1843]: Other bar · no listed price
                - listitem [ref=e1844]:
                  - button "Lazy Ballerinas 1.0 km Other bar · no listed price" [ref=e1845] [cursor=pointer]:
                    - generic [ref=e1846]: Lazy Ballerinas
                    - generic [ref=e1850]:
                      - generic [ref=e1851]: 1.0 km
                      - generic [ref=e1852]: Other bar · no listed price
                - listitem [ref=e1853]:
                  - button "Simmons Bars 1.0 km Other bar · no listed price" [ref=e1854] [cursor=pointer]:
                    - generic [ref=e1855]: Simmons Bars
                    - generic [ref=e1859]:
                      - generic [ref=e1860]: 1.0 km
                      - generic [ref=e1861]: Other bar · no listed price
                - listitem [ref=e1862]:
                  - button "The Dolphin 1.0 km Other pub · no listed price" [ref=e1863] [cursor=pointer]:
                    - generic [ref=e1864]: The Dolphin
                    - generic [ref=e1868]:
                      - generic [ref=e1869]: 1.0 km
                      - generic [ref=e1870]: Other pub · no listed price
                - listitem [ref=e1871]:
                  - button "Circa 1.1 km Other bar · no listed price" [ref=e1872] [cursor=pointer]:
                    - generic [ref=e1873]: Circa
                    - generic [ref=e1877]:
                      - generic [ref=e1878]: 1.1 km
                      - generic [ref=e1879]: Other bar · no listed price
                - listitem [ref=e1880]:
                  - button "Rev. JW Simpson 1.1 km Other bar · no listed price" [ref=e1881] [cursor=pointer]:
                    - generic [ref=e1882]: Rev. JW Simpson
                    - generic [ref=e1886]:
                      - generic [ref=e1887]: 1.1 km
                      - generic [ref=e1888]: Other bar · no listed price
                - listitem [ref=e1889]:
                  - button "Henson’s Bar 1.1 km Other bar · no listed price" [ref=e1890] [cursor=pointer]:
                    - generic [ref=e1891]: Henson’s Bar
                    - generic [ref=e1895]:
                      - generic [ref=e1896]: 1.1 km
                      - generic [ref=e1897]: Other bar · no listed price
                - listitem [ref=e1898]:
                  - button "The Hope 1.1 km Other pub · no listed price" [ref=e1899] [cursor=pointer]:
                    - generic [ref=e1900]: The Hope
                    - generic [ref=e1904]:
                      - generic [ref=e1905]: 1.1 km
                      - generic [ref=e1906]: Other pub · no listed price
                - listitem [ref=e1907]:
                  - button "The Dog and Duck 1.1 km Other pub · no listed price" [ref=e1908] [cursor=pointer]:
                    - generic [ref=e1909]: The Dog and Duck
                    - generic [ref=e1913]:
                      - generic [ref=e1914]: 1.1 km
                      - generic [ref=e1915]: Other pub · no listed price
                - listitem [ref=e1916]:
                  - button "Euston Flyer 1.1 km Other pub · no listed price" [ref=e1917] [cursor=pointer]:
                    - generic [ref=e1918]: Euston Flyer
                    - generic [ref=e1922]:
                      - generic [ref=e1923]: 1.1 km
                      - generic [ref=e1924]: Other pub · no listed price
                - listitem [ref=e1925]:
                  - button "Old China Hand 1.1 km Other pub · no listed price" [ref=e1926] [cursor=pointer]:
                    - generic [ref=e1927]: Old China Hand
                    - generic [ref=e1931]:
                      - generic [ref=e1932]: 1.1 km
                      - generic [ref=e1933]: Other pub · no listed price
                - listitem [ref=e1934]:
                  - button "O'Neill's 1.1 km Other pub · no listed price" [ref=e1935] [cursor=pointer]:
                    - generic [ref=e1936]: O'Neill's
                    - generic [ref=e1940]:
                      - generic [ref=e1941]: 1.1 km
                      - generic [ref=e1942]: Other pub · no listed price
                - listitem [ref=e1943]:
                  - button "Pix Pintxos 1.1 km Other bar · no listed price" [ref=e1944] [cursor=pointer]:
                    - generic [ref=e1945]: Pix Pintxos
                    - generic [ref=e1949]:
                      - generic [ref=e1950]: 1.1 km
                      - generic [ref=e1951]: Other bar · no listed price
                - listitem [ref=e1952]:
                  - button "TCR Bar 1.1 km Other bar · no listed price" [ref=e1953] [cursor=pointer]:
                    - generic [ref=e1954]: TCR Bar
                    - generic [ref=e1958]:
                      - generic [ref=e1959]: 1.1 km
                      - generic [ref=e1960]: Other bar · no listed price
                - listitem [ref=e1961]:
                  - button "Double Standard 1.1 km Other bar · no listed price" [ref=e1962] [cursor=pointer]:
                    - generic [ref=e1963]: Double Standard
                    - generic [ref=e1967]:
                      - generic [ref=e1968]: 1.1 km
                      - generic [ref=e1969]: Other bar · no listed price
                - listitem [ref=e1970]:
                  - button "GA 1.1 km Other bar · no listed price" [ref=e1971] [cursor=pointer]:
                    - generic [ref=e1972]: GA
                    - generic [ref=e1976]:
                      - generic [ref=e1977]: 1.1 km
                      - generic [ref=e1978]: Other bar · no listed price
                - listitem [ref=e1979]:
                  - button "The Holy Tavern 1.1 km Other pub · no listed price" [ref=e1980] [cursor=pointer]:
                    - generic [ref=e1981]: The Holy Tavern
                    - generic [ref=e1985]:
                      - generic [ref=e1986]: 1.1 km
                      - generic [ref=e1987]: Other pub · no listed price
                - listitem [ref=e1988]:
                  - button "Phineas 1.1 km Other bar · no listed price" [ref=e1989] [cursor=pointer]:
                    - generic [ref=e1990]: Phineas
                    - generic [ref=e1994]:
                      - generic [ref=e1995]: 1.1 km
                      - generic [ref=e1996]: Other bar · no listed price
                - listitem [ref=e1997]:
                  - button "Fitzrovia Belle 1.1 km Other pub · no listed price" [ref=e1998] [cursor=pointer]:
                    - generic [ref=e1999]: Fitzrovia Belle
                    - generic [ref=e2003]:
                      - generic [ref=e2004]: 1.1 km
                      - generic [ref=e2005]: Other pub · no listed price
                - listitem [ref=e2006]:
                  - button "Gothic Bar 1.1 km Other bar · no listed price" [ref=e2007] [cursor=pointer]:
                    - generic [ref=e2008]: Gothic Bar
                    - generic [ref=e2012]:
                      - generic [ref=e2013]: 1.1 km
                      - generic [ref=e2014]: Other bar · no listed price
                - listitem [ref=e2015]:
                  - button "The Artisan 1.1 km Other pub · no listed price" [ref=e2016] [cursor=pointer]:
                    - generic [ref=e2017]: The Artisan
                    - generic [ref=e2021]:
                      - generic [ref=e2022]: 1.1 km
                      - generic [ref=e2023]: Other pub · no listed price
                - listitem [ref=e2024]:
                  - button "The Jeremy Bentham 1.1 km Other pub · no listed price" [ref=e2025] [cursor=pointer]:
                    - generic [ref=e2026]: The Jeremy Bentham
                    - generic [ref=e2030]:
                      - generic [ref=e2031]: 1.1 km
                      - generic [ref=e2032]: Other pub · no listed price
                - listitem [ref=e2033]:
                  - button "Euston Tap 1.2 km Other pub · no listed price" [ref=e2034] [cursor=pointer]:
                    - generic [ref=e2035]: Euston Tap
                    - generic [ref=e2039]:
                      - generic [ref=e2040]: 1.2 km
                      - generic [ref=e2041]: Other pub · no listed price
                - listitem [ref=e2042]:
                  - button "The Dovetail 1.2 km Other pub · no listed price" [ref=e2043] [cursor=pointer]:
                    - generic [ref=e2044]: The Dovetail
                    - generic [ref=e2048]:
                      - generic [ref=e2049]: 1.2 km
                      - generic [ref=e2050]: Other pub · no listed price
                - listitem [ref=e2051]:
                  - button "The Sekforde 1.2 km Other pub · no listed price" [ref=e2052] [cursor=pointer]:
                    - generic [ref=e2053]: The Sekforde
                    - generic [ref=e2057]:
                      - generic [ref=e2058]: 1.2 km
                      - generic [ref=e2059]: Other pub · no listed price
                - listitem [ref=e2060]:
                  - button "Mully's 1.2 km Other bar · no listed price" [ref=e2061] [cursor=pointer]:
                    - generic [ref=e2062]: Mully's
                    - generic [ref=e2066]:
                      - generic [ref=e2067]: 1.2 km
                      - generic [ref=e2068]: Other bar · no listed price
                - listitem [ref=e2069]:
                  - button "The Huntley 1.2 km Other pub · no listed price" [ref=e2070] [cursor=pointer]:
                    - generic [ref=e2071]: The Huntley
                    - generic [ref=e2075]:
                      - generic [ref=e2076]: 1.2 km
                      - generic [ref=e2077]: Other pub · no listed price
                - listitem [ref=e2078]:
                  - button "Betjeman Arms 1.2 km Other pub · no listed price" [ref=e2079] [cursor=pointer]:
                    - generic [ref=e2080]: Betjeman Arms
                    - generic [ref=e2084]:
                      - generic [ref=e2085]: 1.2 km
                      - generic [ref=e2086]: Other pub · no listed price
                - listitem [ref=e2087]:
                  - button "The Doric Arch 1.2 km Other pub · no listed price" [ref=e2088] [cursor=pointer]:
                    - generic [ref=e2089]: The Doric Arch
                    - generic [ref=e2093]:
                      - generic [ref=e2094]: 1.2 km
                      - generic [ref=e2095]: Other pub · no listed price
                - listitem [ref=e2096]:
                  - button "The Court 1.2 km Other pub · no listed price" [ref=e2097] [cursor=pointer]:
                    - generic [ref=e2098]: The Court
                    - generic [ref=e2102]:
                      - generic [ref=e2103]: 1.2 km
                      - generic [ref=e2104]: Other pub · no listed price
                - listitem [ref=e2105]:
                  - button "The Signal Box 1.3 km Other pub · no listed price" [ref=e2106] [cursor=pointer]:
                    - generic [ref=e2107]: The Signal Box
                    - generic [ref=e2111]:
                      - generic [ref=e2112]: 1.3 km
                      - generic [ref=e2113]: Other pub · no listed price
                - listitem [ref=e2114]:
                  - button "Simmons 1.3 km Other bar · no listed price" [ref=e2115] [cursor=pointer]:
                    - generic [ref=e2116]: Simmons
                    - generic [ref=e2120]:
                      - generic [ref=e2121]: 1.3 km
                      - generic [ref=e2122]: Other bar · no listed price
                - listitem [ref=e2123]:
                  - button "Virgin First Class Lounge 1.3 km Other bar · no listed price" [ref=e2124] [cursor=pointer]:
                    - generic [ref=e2125]: Virgin First Class Lounge
                    - generic [ref=e2129]:
                      - generic [ref=e2130]: 1.3 km
                      - generic [ref=e2131]: Other bar · no listed price
                - listitem [ref=e2132]:
                  - button "The George and Monkey 1.3 km Other pub · no listed price" [ref=e2133] [cursor=pointer]:
                    - generic [ref=e2134]: The George and Monkey
                    - generic [ref=e2138]:
                      - generic [ref=e2139]: 1.3 km
                      - generic [ref=e2140]: Other pub · no listed price
                - listitem [ref=e2141]:
                  - button "Somers Town Coffee House 1.3 km Other pub · no listed price" [ref=e2142] [cursor=pointer]:
                    - generic [ref=e2143]: Somers Town Coffee House
                    - generic [ref=e2147]:
                      - generic [ref=e2148]: 1.3 km
                      - generic [ref=e2149]: Other pub · no listed price
                - listitem [ref=e2150]:
                  - button "The Captain Flinders 1.3 km Other pub · no listed price" [ref=e2151] [cursor=pointer]:
                    - generic [ref=e2152]: The Captain Flinders
                    - generic [ref=e2156]:
                      - generic [ref=e2157]: 1.3 km
                      - generic [ref=e2158]: Other pub · no listed price
                - listitem [ref=e2159]:
                  - button "The Shakespeare's Head 1.4 km Other pub · no listed price" [ref=e2160] [cursor=pointer]:
                    - generic [ref=e2161]: The Shakespeare's Head
                    - generic [ref=e2165]:
                      - generic [ref=e2166]: 1.4 km
                      - generic [ref=e2167]: Other pub · no listed price
                - listitem [ref=e2168]:
                  - button "Square Tavern 1.4 km Other pub · no listed price" [ref=e2169] [cursor=pointer]:
                    - generic [ref=e2170]: Square Tavern
                    - generic [ref=e2174]:
                      - generic [ref=e2175]: 1.4 km
                      - generic [ref=e2176]: Other pub · no listed price
                - listitem [ref=e2177]:
                  - button "Dame Alice Owen 1.4 km Other pub · no listed price" [ref=e2178] [cursor=pointer]:
                    - generic [ref=e2179]: Dame Alice Owen
                    - generic [ref=e2183]:
                      - generic [ref=e2184]: 1.4 km
                      - generic [ref=e2185]: Other pub · no listed price
                - listitem [ref=e2186]:
                  - button "The Prince Arthur 1.4 km Other pub · no listed price" [ref=e2187] [cursor=pointer]:
                    - generic [ref=e2188]: The Prince Arthur
                    - generic [ref=e2192]:
                      - generic [ref=e2193]: 1.4 km
                      - generic [ref=e2194]: Other pub · no listed price
                - listitem [ref=e2195]:
                  - button "Exmouth Arms 1.4 km Other pub · no listed price" [ref=e2196] [cursor=pointer]:
                    - generic [ref=e2197]: Exmouth Arms
                    - generic [ref=e2201]:
                      - generic [ref=e2202]: 1.4 km
                      - generic [ref=e2203]: Other pub · no listed price
                - listitem [ref=e2204]:
                  - button "The Harlequin 1.5 km Other pub · no listed price" [ref=e2205] [cursor=pointer]:
                    - generic [ref=e2206]: The Harlequin
                    - generic [ref=e2210]:
                      - generic [ref=e2211]: 1.5 km
                      - generic [ref=e2212]: Other pub · no listed price
                - listitem [ref=e2213]:
                  - button "Shaker and Co 1.6 km Other pub · no listed price" [ref=e2214] [cursor=pointer]:
                    - generic [ref=e2215]: Shaker and Co
                    - generic [ref=e2219]:
                      - generic [ref=e2220]: 1.6 km
                      - generic [ref=e2221]: Other pub · no listed price
                - listitem [ref=e2222]:
                  - button "City Bar 1.6 km Other bar · no listed price" [ref=e2223] [cursor=pointer]:
                    - generic [ref=e2224]: City Bar
                    - generic [ref=e2228]:
                      - generic [ref=e2229]: 1.6 km
                      - generic [ref=e2230]: Other bar · no listed price
                - listitem [ref=e2231]:
                  - button "Shaker and Company 1.6 km Other pub · no listed price" [ref=e2232] [cursor=pointer]:
                    - generic [ref=e2233]: Shaker and Company
                    - generic [ref=e2237]:
                      - generic [ref=e2238]: 1.6 km
                      - generic [ref=e2239]: Other pub · no listed price
  - alert [ref=e2240]
```

# Test source

```ts
  127 |   const firstVenue = page.locator(".mapVenueListItem").first();
  128 |   // Layers opens from the toolbar; pointer taps can race hydration (e2e/AGENTS.md).
  129 |   await expect(async () => {
  130 |     await layers.focus();
  131 |     await page.keyboard.press("Enter");
  132 |     await expect(list).toBeVisible({ timeout: 2_000 });
  133 |   }).toPass({ timeout: 60_000 });
  134 |   // List view lives in that popover; same hydration idiom as the control above.
  135 |   await list.focus();
  136 |   await page.keyboard.press("Enter");
  137 |   await expect(page.locator(".mapVenueList--open")).toBeVisible({ timeout: 30_000 });
  138 |   await expect.poll(async () => firstVenue.count(), { timeout: 90_000 }).toBeGreaterThan(0);
  139 |   await expect(firstVenue).toBeVisible();
  140 | }
  141 | 
  142 | async function openVenueListWithKeyboard(page: Page): Promise<Locator> {
  143 |   const layers = page.getByRole("button", { name: /Map layers:/ });
  144 |   await expect(layers).toBeVisible({ timeout: 30_000 });
  145 |   await tabTo(page, layers);
  146 |   await page.keyboard.press("Enter");
  147 |   const list = page.getByRole("button", { name: "List view" });
  148 |   await expect(list).toBeVisible();
  149 |   await tabTo(page, list);
  150 |   await page.keyboard.press("Enter");
  151 | 
  152 |   const firstVenue = page.locator(".mapVenueListItem").first();
  153 |   await expect(firstVenue).toBeFocused();
  154 |   return firstVenue;
  155 | }
  156 | 
  157 | test.describe("map keyboard and screen-reader venue path", () => {
  158 |   test.beforeEach(async ({ page }) => {
  159 |     await page.setViewportSize(DESKTOP);
  160 |     await page.emulateMedia({ reducedMotion: "reduce" });
  161 |     await dismissFirstRunChrome(page);
  162 |   });
  163 | 
  164 |   test("keeps desktop MapLibre zoom controls at the 44px target floor", async ({
  165 |     page,
  166 |   }) => {
  167 |     await page.goto("/map");
  168 | 
  169 |     for (const name of ["Zoom in", "Zoom out"] as const) {
  170 |       const control = page.getByRole("button", { name });
  171 |       await expect(control).toBeVisible({ timeout: 30_000 });
  172 |       const box = await control.boundingBox();
  173 |       expect(box).not.toBeNull();
  174 |       expect(box!.width).toBeGreaterThanOrEqual(44);
  175 |       expect(box!.height).toBeGreaterThanOrEqual(44);
  176 |     }
  177 |   });
  178 | 
  179 |   test("tabs into venue list and opens a named venue without canvas hit-testing", async ({
  180 |     page,
  181 |   }) => {
  182 |     test.setTimeout(90_000);
  183 |     await page.goto("/map");
  184 | 
  185 |     const firstVenue = await openVenueListWithKeyboard(page);
  186 |     const venueName = (await firstVenue.locator(".mapVenueListItemName").innerText()).trim();
  187 |     const venueId = await firstVenue.getAttribute("data-venue-id");
  188 |     const accessibleName = await firstVenue.getAttribute("aria-label");
  189 | 
  190 |     expect(venueName.length).toBeGreaterThan(0);
  191 |     expect(venueId).toBeTruthy();
  192 |     expect(accessibleName).toBeNull();
  193 |     await expect(firstVenue).toContainText(/Pub|Bar|Late food|Restaurant/);
  194 |     await expect(firstVenue).toContainText(/£|Price|no price/i);
  195 | 
  196 |     await page.keyboard.press("Enter");
  197 | 
  198 |     const drawer = page.locator(".mapDrawer.right.open");
  199 |     await expect(drawer).toBeVisible();
  200 |     await expect
  201 |       .poll(() => new URL(page.url()).searchParams.get("sel"))
  202 |       .toBe(venueId);
  203 |   });
  204 | 
  205 |   test("updates open venue list after map movement and a venue-kind filter", async ({
  206 |     page,
  207 |   }) => {
  208 |     test.setTimeout(180_000);
  209 |     await page.goto("/map");
  210 |     await openVenueListWithKeyboard(page);
  211 | 
  212 |     const rows = page.locator(".mapVenueListItem");
  213 |     const beforeMove = await rows.count();
  214 |     const beforeMoveIds = await rows.evaluateAll((items) =>
  215 |       items.map((item) => item.getAttribute("data-venue-id")),
  216 |     );
  217 |     expect(beforeMove).toBeGreaterThan(0);
  218 |     expect(beforeMoveIds.every(Boolean)).toBe(true);
  219 | 
  220 |     const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  221 |     await zoomIn.click();
  222 |     await zoomIn.click();
  223 |     await zoomIn.click();
  224 | 
  225 |     await expect
  226 |       .poll(() => rows.count(), { timeout: 20_000 })
> 227 |       .toBeLessThan(beforeMove);
      |        ^ Error: expect(received).toBeLessThan(expected)
  228 |     await expect
  229 |       .poll(
  230 |         () =>
  231 |           rows.evaluateAll((items) =>
  232 |             items.map((item) => item.getAttribute("data-venue-id")),
  233 |           ),
  234 |         { timeout: 20_000 },
  235 |       )
  236 |       .not.toEqual(beforeMoveIds);
  237 | 
  238 |     const beforeFilter = await rows.count();
  239 |     // The venue-type chips live in the toolbar's Filters panel (#1631).
  240 |     await page.getByRole("button", { name: /^Filters:/ }).click();
  241 |     const bars = page
  242 |       .getByRole("dialog", { name: "Filters" })
  243 |       .getByRole("button", { name: "Bars", exact: true });
  244 |     await expect(bars).toHaveAttribute("aria-pressed", "true");
  245 |     await bars.click();
  246 |     await expect(bars).toHaveAttribute("aria-pressed", "false");
  247 |     await expect.poll(() => rows.count()).toBeLessThan(beforeFilter);
  248 |   });
  249 | 
  250 |   test("drops old base-pub rows during a disjoint pan before the next shard fetch", async ({
  251 |     page,
  252 |   }) => {
  253 |     test.setTimeout(120_000);
  254 |     await page.goto("/map");
  255 | 
  256 |     const canvas = page.locator(".maplibregl-canvas").first();
  257 |     const wrap = page.locator(".mapCanvasWrap");
  258 |     await expect(canvas).toBeVisible({ timeout: 30_000 });
  259 |     await canvas.focus();
  260 |     for (let press = 0; press < 3; press += 1) {
  261 |       await page.keyboard.press("Equal");
  262 |       await page.waitForTimeout(1_400);
  263 |     }
  264 |     await expect
  265 |       .poll(
  266 |         async () => Number(await wrap.getAttribute("data-uk-base-count")),
  267 |         { timeout: 30_000 },
  268 |       )
  269 |       .toBeGreaterThan(0);
  270 | 
  271 |     await openVenueListFromLayers(page);
  272 |     const baseRows = page.locator(
  273 |       '.mapVenueListItem[data-venue-id^="venue-uk-"]',
  274 |     );
  275 |     await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  276 |     const oldIds = new Set(
  277 |       await baseRows.evaluateAll((items) =>
  278 |         items.map((item) => item.getAttribute("data-venue-id") ?? ""),
  279 |       ),
  280 |     );
  281 | 
  282 |     // One quick multi-screen drag leaves the next 180 ms shard request
  283 |     // pending. DOM membership must still follow camera projection immediately.
  284 |     for (let drag = 0; drag < 3; drag += 1) {
  285 |       await page.mouse.move(1_300, 500);
  286 |       await page.mouse.down();
  287 |       await page.mouse.move(400, 500);
  288 |       await page.mouse.up();
  289 |     }
  290 |     await page.waitForTimeout(50);
  291 | 
  292 |     const overlappingOldIds = await baseRows.evaluateAll(
  293 |       (items, ids) =>
  294 |         items
  295 |           .map((item) => item.getAttribute("data-venue-id") ?? "")
  296 |           .filter((id) => ids.includes(id)),
  297 |       [...oldIds],
  298 |     );
  299 |     expect(overlappingOldIds).toEqual([]);
  300 | 
  301 |     await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  302 |     await canvas.focus();
  303 |     // London opens already past UK_BASE_MIN_ZOOM (12). Three Minus presses
  304 |     // from a zoomed-in view often land back on that street-level camera, which
  305 |     // is still above the gate, so keep zooming until the wrap reports the
  306 |     // floor rather than assuming a fixed key count crossed it.
  307 |     await expect
  308 |       .poll(
  309 |         async () => {
  310 |           await page.keyboard.press("Minus");
  311 |           return wrap.getAttribute("data-uk-base-status");
  312 |         },
  313 |         { timeout: 20_000 },
  314 |       )
  315 |       .toBe("zoom_required");
  316 |     // MapLibre has settled below the layer floor, but the base stream's 180 ms
  317 |     // clear may still be pending on a loaded runner. Poll rather than a tight
  318 |     // fixed-timeout assertion so runner variance can't race the clear.
  319 |     await expect.poll(() => baseRows.count(), { timeout: 5_000 }).toBe(0);
  320 |   });
  321 | 
  322 |   test("keeps desktop drawer focus inside and restores chosen venue on Escape", async ({
  323 |     page,
  324 |   }) => {
  325 |     test.setTimeout(180_000);
  326 |     await page.goto("/map");
  327 |     const canvas = page.locator(".maplibregl-canvas").first();
```