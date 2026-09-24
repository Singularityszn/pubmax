#!/usr/bin/env node
/**
 * Split an area AGENTS.md into a short index plus docs/rules/<area>-<section>.md
 * bodies. Preserves every bullet verbatim in the linked doc.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const TARGET_MAX = 20 * 1024;

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function extractTitle(bullet) {
  const m = bullet.match(/^\s*-\s*\*\*([^*]+)\*\*/);
  return m ? m[1].replace(/\.$/, "").trim() : null;
}

function firstInvariantLine(body) {
  const stripped = body.replace(/^\s*-\s*\*\*[^*]+\*\*\.?\s*/, "").trim();
  const sentence = stripped.split(/(?<=[.!?])\s+/)[0] ?? stripped;
  const plain = sentence
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= 100) return plain;
  return `${plain.slice(0, 97).trim()}…`;
}

function parseSections(content) {
  const lines = content.split("\n");
  const preamble = [];
  const sections = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("## ")) {
    preamble.push(lines[i]);
    i++;
  }
  while (i < lines.length) {
    if (!lines[i].startsWith("## ")) {
      i++;
      continue;
    }
    const heading = lines[i].replace(/^## /, "").trim();
    i++;
    const bodyLines = [];
    while (i < lines.length && !lines[i].startsWith("## ")) {
      bodyLines.push(lines[i]);
      i++;
    }
    sections.push({ heading, body: bodyLines.join("\n").trim() });
  }
  return { preamble: preamble.join("\n").trimEnd(), sections };
}

function splitBullets(sectionBody) {
  const bullets = [];
  const chunks = sectionBody.split(/\n(?=- \*\*)/);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith("- **")) continue;
    bullets.push(trimmed);
  }
  return bullets;
}

function processArea(agentsPath, areaPrefix, root) {
  const abs = agentsPath;
  const size = readFileSync(abs, "utf8").length;
  if (size <= TARGET_MAX) {
    console.log(`skip ${agentsPath} (${size} bytes)`);
    return null;
  }

  const content = readFileSync(abs, "utf8");
  const { preamble, sections } = parseSections(content);
    const rulesDir = join(root, "docs/rules");
    mkdirSync(rulesDir, { recursive: true });

  const mapping = [];
  const indexSections = [];

  for (const section of sections) {
    const sectionSlug = slugify(section.heading);
    const docName = `${areaPrefix}-${sectionSlug}.md`;
    const docRel = `../docs/rules/${docName}`;
    const docAbs = join(dirname(abs), docRel);

    const bullets = splitBullets(section.body);
    const areaDir = basename(dirname(abs));
    const docParts = [
      `# ${section.heading}`,
      "",
      `Moved from [\`${areaDir}/AGENTS.md\`](../../${areaDir}/AGENTS.md). Authoritative policy detail lives here; the area index stays short.`,
      "",
    ];

    const indexBullets = [];

    for (const bullet of bullets) {
      const title = extractTitle(bullet);
      if (!title) continue;
      const anchor = slugify(title);
      docParts.push(`<a id="${anchor}"></a>`);
      docParts.push("");
      docParts.push(bullet);
      docParts.push("");

      const summary = firstInvariantLine(bullet);
      indexBullets.push(
        `- **${title}.** ${summary} Detail: [\`${docRel}#${anchor}\`](${docRel}#${anchor}).`,
      );
      mapping.push({
        section: section.heading,
        title,
        doc: docRel,
        anchor,
      });
    }

    writeFileSync(docAbs, `${docParts.join("\n").trimEnd()}\n`, "utf8");

    indexSections.push(
      `## ${section.heading}\n\n${indexBullets.join("\n")}\n`,
    );
  }

  const maintainingIdx = content.indexOf("## Maintaining this file");
  const maintaining =
    maintainingIdx >= 0 ? content.slice(maintainingIdx).trim() : "";

  const indexParts = [
    preamble,
    "",
    "Long-form incident history, measured proof and review finding IDs live under [`docs/rules/`](rules/). The bullets below state each invariant in brief and link to the owning detail.",
    "",
    ...indexSections,
  ];

  if (maintaining && !preamble.includes("## Maintaining this file")) {
    indexParts.push("", maintaining);
  }

  writeFileSync(abs, `${indexParts.join("\n").trimEnd()}\n`, "utf8");

  const after = readFileSync(abs, "utf8").length;
  console.log(
    `${agentsPath}: ${size} → ${after} bytes, ${sections.length} sections → docs/rules/${areaPrefix}-*.md`,
  );

  return { before: size, after, mapping, areaPrefix };
}

const root = process.cwd();
const areas = [
  ["lib/AGENTS.md", "lib"],
  ["components/AGENTS.md", "components"],
  ["app/AGENTS.md", "app"],
  ["perf/AGENTS.md", "perf"],
  ["scripts/AGENTS.md", "scripts"],
];

const results = [];
for (const [path, prefix] of areas) {
  const r = processArea(join(root, path), prefix, root);
  if (r) results.push(r);
}

if (results.length) {
  writeFileSync(
    join(root, "docs/rules/agents-md-slim-mapping.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );
}
