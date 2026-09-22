import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Markdown alone cannot prove which URL supplied it. A cache is reusable only
// with its requested/resolved URL pair, revalidated against current policy.
function metadataPath(markdownPath) {
  return `${markdownPath}.source.json`;
}

export async function readValidatedMenuPageCache({
  requestedUrl,
  markdownPath,
  validateResolvedMenuUrl,
}) {
  const sourcePath = metadataPath(markdownPath);
  if (!existsSync(markdownPath) || !existsSync(sourcePath)) return null;

  let metadata;
  try {
    metadata = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch {
    return null;
  }
  if (metadata?.requestedUrl !== requestedUrl) return null;
  const finalUrl = await validateResolvedMenuUrl(requestedUrl, metadata?.finalUrl);
  return {
    markdown: readFileSync(markdownPath, "utf8"),
    finalUrl,
  };
}

export function writeMenuPageCache({ requestedUrl, markdownPath, page }) {
  writeFileSync(markdownPath, `${page.markdown.trim()}\n`);
  writeFileSync(
    metadataPath(markdownPath),
    `${JSON.stringify({ requestedUrl, finalUrl: page.finalUrl }, null, 2)}\n`,
  );
}
