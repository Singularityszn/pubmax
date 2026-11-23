import path from "node:path";
import { fileURLToPath } from "node:url";

// One ESLint rule per fence, built here. `no-restricted-imports` cannot carry a
// separate allow list per pattern, and a later block that sets it replaces the
// options of an earlier one, so two fences on the same file would silently
// drop one. Each fence registers its own rule name instead.

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * @param {{ pattern: RegExp, message: string, allowedIn?: string[], onlyIn?: string[] }[]} fences
 */
export function importFenceRule(fences) {
  return {
    meta: { type: "problem", schema: [], messages: { fenced: "{{message}}" } },
    create(context) {
      const file = path.relative(root, context.filename).split(path.sep).join("/");
      const active = fences.filter(
        (fence) => !fence.allowedIn?.includes(file) && (!fence.onlyIn || fence.onlyIn.includes(file)),
      );
      if (active.length === 0) return {};
      const check = (node, source) => {
        if (typeof source !== "string") return;
        for (const fence of active) {
          if (fence.pattern.test(source)) context.report({ node, messageId: "fenced", data: { message: fence.message } });
        }
      };
      return {
        ImportDeclaration: (node) => check(node, node.source.value),
        ExportNamedDeclaration: (node) => check(node, node.source?.value),
        ExportAllDeclaration: (node) => check(node, node.source.value),
        ImportExpression: (node) => check(node, node.source.type === "Literal" ? node.source.value : null),
      };
    },
  };
}
