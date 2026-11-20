import "./embed-pint-badge.css";

type Props = { id: string };

export default function EmbedPintBadge({ id }: Props) {
  const origin = "https://pubmaxxing.com";
  const destination = `/borough/${encodeURIComponent(id)}`;
  const image = `${origin}/api/badge/area/${encodeURIComponent(id)}`;
  const snippet = `<a href="${origin}${destination}"><img src="${image}" alt="Cheapest pint found in this area on PUBMAXX" width="360" height="160"></a>`;
  return (
    <details className="embedPintBadge">
      <summary>Embed this pint price</summary>
      <p>Copy this code to add a dated pint price to your website.</p>
      <textarea aria-label="Badge embed code" readOnly value={snippet} rows={4} />
    </details>
  );
}
