import ts from "typescript";

export type PriceRead = { owner: string; count: number };

/**
 * Intentional A1 source contract: new raw cheapestPrice reads need review.
 * This is a syntax ratchet, not data-flow proof. Aliases, dynamic keys and
 * upstream qualification still require the ranking behaviour tests.
 */
export function cheapestPriceReads(source: string, path: string): PriceRead[] {
  // Escaped property names still need the parser even without the literal spelling.
  if (!source.includes("cheapestPrice") && !source.includes("\\")) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const counts = new Map<string, number>();
  function isPriceBindingName(name: ts.PropertyName): boolean {
    if (ts.isComputedPropertyName(name)) {
      return ts.isStringLiteralLike(name.expression) && name.expression.text === "cheapestPrice";
    }
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === "cheapestPrice";
  }
  function visit(node: ts.Node, owner: string): void {
    if (ts.isFunctionDeclaration(node) && node.name) owner = node.name.text;
    else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      owner = node.parent.name.text;
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) owner = node.name.text;
    const read = (ts.isPropertyAccessExpression(node) && node.name.text === "cheapestPrice") ||
      (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "cheapestPrice") ||
      (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) &&
        ((node.propertyName && isPriceBindingName(node.propertyName)) ||
          (!node.propertyName && ts.isIdentifier(node.name) && node.name.text === "cheapestPrice")));
    if (read) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    ts.forEachChild(node, (child) => visit(child, owner));
  }
  visit(file, "<module>");
  return [...counts].map(([owner, count]) => ({ owner, count }));
}

export type PriceReadAllowance = { owner: string; count: number; reason: string };

export function unreviewedPriceReads(source: string, path: string, allowances: readonly PriceReadAllowance[] = []): PriceRead[] {
  return cheapestPriceReads(source, path).filter((read) => !allowances.some((entry) =>
    entry.owner === read.owner && entry.count === read.count && entry.reason.trim().length > 0));
}
