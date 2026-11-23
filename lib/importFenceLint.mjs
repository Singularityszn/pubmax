import path from "node:path";
import { fileURLToPath } from "node:url";

// One ESLint rule per fence, built here. `no-restricted-imports` cannot carry a
// separate allow list per pattern, and a later block that sets it replaces the
// options of an earlier one, so two fences on the same file would silently
// drop one. Each fence registers its own rule name instead.

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * A fence with `importNames` refuses only those named exports of a matching
 * module, and any import that can reach them all (a namespace, `export *` or a
 * dynamic import).
 *
 * @param {{ pattern: RegExp, message: string, allowedIn?: string[], onlyIn?: string[], importNames?: string[] }[]} fences
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
      const check = (node, source, names) => {
        if (typeof source !== "string") return;
        for (const fence of active) {
          if (!fence.pattern.test(source)) continue;
          if (fence.importNames && names && !names.some((name) => fence.importNames.includes(name))) continue;
          context.report({ node, messageId: "fenced", data: { message: fence.message } });
        }
      };
      const nameOf = (name) => (name.type === "Identifier" ? name.name : name.value);
      // The named exports an import takes, or null when it can reach them all.
      const importedNames = (node) => {
        const names = [];
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") return null;
          if (specifier.type === "ImportSpecifier") names.push(nameOf(specifier.imported));
        }
        return names;
      };
      return {
        ImportDeclaration: (node) => check(node, node.source.value, importedNames(node)),
        ExportNamedDeclaration: (node) =>
          check(node, node.source?.value, node.specifiers.map((specifier) => nameOf(specifier.local))),
        ExportAllDeclaration: (node) => check(node, node.source.value, null),
        ImportExpression: (node) => check(node, node.source.type === "Literal" ? node.source.value : null, null),
      };
    },
  };
}
