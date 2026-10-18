import type { Route } from "next";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RowList, RowListItem } from "@/components/ui/row-list";

describe("RowList", () => {
  it("renders an unboxed list whose linked rows are one tap target", () => {
    const html = renderToStaticMarkup(
      <RowList label="Cheapest pints">
        <RowListItem
          href={"/pubs/x" as Route}
          lead="1"
          title="The Ship"
          meta="Wapping"
          trailing="£4.20"
        />
        <RowListItem title="No link here" />
      </RowList>,
    );
    expect(html).toContain('<ul class="rowList" aria-label="Cheapest pints">');
    expect(html).toContain('class="rowListItem rowListItem--link"');
    expect(html).toContain('href="/pubs/x"');
    expect(html).toContain('<span class="rowListMeta">Wapping</span>');
    expect(html).toContain('<span class="rowListTrailing">£4.20</span>');
    expect(html).toContain('<span class="rowListTitle">No link here</span>');
  });
});
