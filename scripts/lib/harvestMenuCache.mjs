import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

// Markdown alone cannot prove which URL supplied it. A cache is reusable only
// with its requested/resolved URL pair, revalidated against current policy.
function metadataPath(markdownPath) {
  return `${markdownPath}.source.json`;
}

function markdownSha256(markdown) {
  return createHash("sha256").update(markdown).digest("hex");
}

export async function readValidatedMenuPageCache({
  requestedUrl,
  markdownPath,
  validateResolvedMenuUrl,
}) {
  const sourcePath = metadataPath(markdownPath);
  if (!existsSync(markdownPath) || !existsSync(sourcePath)) return null;

  let metadata;
  let markdown;
  try {
    metadata = JSON.parse(readFileSync(sourcePath, "utf8"));
    markdown = readFileSync(markdownPath, "utf8");
  } catch {
    return null;
  }
  if (
    metadata?.version !== 1 ||
    metadata.requestedUrl !== requestedUrl ||
    typeof metadata.markdownSha256 !== "string" ||
    metadata.markdownSha256 !== markdownSha256(markdown)
  ) {
    return null;
  }
  const finalUrl = await validateResolvedMenuUrl(requestedUrl, metadata?.finalUrl);
  return { markdown, finalUrl };
}

export function writeMenuPageCache({ requestedUrl, markdownPath, page }) {
  const markdown = `${page.markdown.trim()}\n`;
  const sourcePath = metadataPath(markdownPath);
  const token = `${process.pid}-${randomUUID()}`;
  const markdownTemp = `${markdownPath}.${token}.tmp`;
  const sourceTemp = `${sourcePath}.${token}.tmp`;
  const metadata = {
    version: 1,
    requestedUrl,
    finalUrl: page.finalUrl,
    markdownSha256: markdownSha256(markdown),
  };

  // Metadata is the commit marker. Remove it first, publish markdown atomically,
  // then publish matching metadata. Any interruption or race becomes a miss.
  rmSync(sourcePath, { force: true });
  try {
    writeFileSync(markdownTemp, markdown, { flag: "wx" });
    writeFileSync(sourceTemp, `${JSON.stringify(metadata, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(markdownTemp, markdownPath);
    renameSync(sourceTemp, sourcePath);
  } finally {
    rmSync(markdownTemp, { force: true });
    rmSync(sourceTemp, { force: true });
  }
}
