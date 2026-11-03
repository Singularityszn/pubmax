import ts from "typescript";

/** Follow runtime imports and re-exports, but not type imports or import(). */
export function walkEagerModules(
  entry: string,
  read: (file: string) => string | undefined,
  resolve: (from: string, specifier: string) => string | null,
): Map<string, string | null> {
  const reached = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    const source = read(file);
    if (source === undefined) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      let specifier: string | null = null;
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly));
        if (!onlyTypes) specifier = node.moduleSpecifier.text;
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const bindings = node.exportClause;
        const onlyTypes = node.isTypeOnly || (bindings && ts.isNamedExports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly));
        if (!onlyTypes) specifier = node.moduleSpecifier.text;
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
        specifier = node.arguments[0]!.text;
      }
      if (specifier !== null) {
        const next = resolve(file, specifier);
        if (next && !reached.has(next)) { reached.set(next, file); queue.push(next); }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return reached;
}

/** Refuse an eager path to any implementation reserved for a lazy chunk. */
export function assertNoEagerModules(graph: ReadonlyMap<string, string | null>, forbidden: readonly string[]): void {
  for (const target of forbidden) {
    if (!graph.has(target)) continue;
    const chain: string[] = [];
    for (let current: string | null | undefined = target; current; current = graph.get(current)) chain.unshift(current);
    throw new Error(`Eager widget import: ${chain.join(" -> ")}`);
  }
}
