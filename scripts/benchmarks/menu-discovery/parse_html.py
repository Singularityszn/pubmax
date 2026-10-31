"""Parse inert HTML and rewrite crawl links for the local access gateway."""
import json
import re
import resource
import sys
from html import escape
from html.parser import HTMLParser
from urllib.parse import urljoin


class Page(HTMLParser):
    def __init__(self, base, mapping):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.mapping = mapping
        self.links = []
        self.text = []
        self.headings = []
        self.title = []
        self.output = []
        self.hidden = 0
        self.heading = False
        self.in_title = False
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
            return
        if self.hidden:
            return
        if tag == 'base':
            # Honour the original document base for discovery, never for local egress.
            self.base = urljoin(self.base, attrs.get('href', self.base))
            return
        self.heading = tag in ('h1', 'h2', 'h3') or self.heading
        self.in_title = tag == 'title' or self.in_title
        if tag == 'a' and attrs.get('href'):
            self.anchor = {'url': urljoin(self.base, attrs['href']), 'anchor': ''}
            self.links.append(self.anchor)
        if tag in ('iframe', 'object', 'embed'):
            target = attrs.get('data') or attrs.get('src')
            if target:
                self.links.append({'url': urljoin(self.base, target), 'anchor': attrs.get('title', '')})
                rewritten = self.mapping.get(urljoin(self.base, target))
                if rewritten:
                    self.output.append(f'<a href="{escape(rewritten, quote=True)}">{escape(attrs.get("title", "Menu document"))}</a>')
            return
        safe = []
        for key, value in attrs.items():
            if key.startswith('on') or key in ('src', 'srcset', 'action', 'data', 'style'):
                continue
            if key == 'href':
                value = self.mapping.get(urljoin(self.base, value or ''))
                if not value:
                    continue
            safe.append(f' {key}="{escape(value or "", quote=True)}"')
        self.output.append(f'<{tag}{"".join(safe)}>')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
            return
        if self.hidden:
            return
        if tag in ('h1', 'h2', 'h3'):
            self.heading = False
        if tag == 'title':
            self.in_title = False
        if tag == 'a':
            self.anchor = None
        self.output.append(f'</{tag}>')
        if tag in ('p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'br'):
            self.text.append('\n')

    def handle_data(self, data):
        if self.hidden:
            return
        self.text.append(data)
        if self.heading:
            self.headings.append(data)
        if self.in_title:
            self.title.append(data)
        if self.anchor:
            self.anchor['anchor'] += data
        self.output.append(escape(data))


if __name__ == '__main__':
    request = json.load(sys.stdin)
    page = Page(request['url'], request.get('mapping', {}))
    page.feed(request['html'])
    usage = resource.getrusage(resource.RUSAGE_SELF)
    print(json.dumps({
        'links': page.links,
        'text': re.sub(r'[ \t]+', ' ', ''.join(page.text)),
        'headings': ' '.join(page.headings), 'title': ' '.join(page.title),
        'html': ''.join(page.output),
        'parserCpuSeconds': usage.ru_utime + usage.ru_stime,
        'parserPeakRssBytes': usage.ru_maxrss if sys.platform == 'darwin' else usage.ru_maxrss * 1024,
    }))
