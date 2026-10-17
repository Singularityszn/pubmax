# Food-lane fixtures (synthetic)

Every page here is INVENTED for `__tests__/ukFoodCrawl.test.ts` and
`__tests__/ukFoodHarvestLane.test.ts`. No pub, dish or price in them was read
from a real site, and none of them may be copied into a published pack. Each
one exercises a rule in `lib/harvest/ukFoodCrawl.ts`:

- `served-menu.html`: a served food menu with sections, an inline-priced dish,
  a name-description-price dish, an offer, an add-on, a two-figure line and a
  drinks section underneath.
- `rendered-menu.md`: the markdown a rendered (Browserbase) page returns, with
  dishes written as headings, which is how a rendered estate menu states them.
- `home.html`: a pub's home page with one promo figure and the links a crawl
  must and must not follow.
- `drinks-only.html`: a drinks list, which must yield no dish at all.
