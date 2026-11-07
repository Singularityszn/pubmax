// @vitest-environment jsdom
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

  it("puts block detail inside the row body, with its own link beside the row's link", () => {
    const html = renderToStaticMarkup(
      <RowList label="Cheapest pints">
        <RowListItem
          href={"/pubs/x" as Route}
          title="The Ship"
          detail={<p>Listed by <a href="https://example.org/menu">Pub menu</a></p>}
          trailing="£4.20"
        />
      </RowList>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const body = host.querySelector(".rowListBody")!;
    expect(body.tagName).toBe("DIV");
    const detail = body.querySelector(":scope > .rowListDetail")!;
    expect(detail.tagName).toBe("DIV");
    expect(detail.querySelector("p")?.textContent).toBe("Listed by Pub menu");
    // The source link is a sibling of the row's title link, never nested in it.
    expect(detail.querySelector("a")?.getAttribute("href")).toBe("https://example.org/menu");
    expect(host.querySelector(".rowListTitleLink a")).toBeNull();
  });
});
