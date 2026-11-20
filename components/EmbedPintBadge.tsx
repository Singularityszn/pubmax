import "./embed-pint-badge.css";

type Props = { kind: "area" | "venue"; id: string };

export default function EmbedPintBadge({ kind, id }: Props) {
  const origin = "https://pubmaxxing.com";
  const destination = kind === "area" ? `/borough/${encodeURIComponent(id)}` : `/pubs/${encodeURIComponent(id)}`;
  const image = `${origin}/api/badge/${kind}/${encodeURIComponent(id)}`;
  const snippet = `<a href="${origin}${destination}"><img src="${image}" alt="${kind === "area" ? "Cheapest pint found in this area" : "Cheapest pint found at this pub"} on PUBMAXX" width="360" height="160"></a>`;
  return (
    <details className="embedPintBadge">
      <summary>Embed this pint price</summary>
      <p>Copy this code to add a dated pint price to your website.</p>
      <textarea aria-label="Badge embed code" readOnly value={snippet} rows={4} />
    </details>
  );
}
