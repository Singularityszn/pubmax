import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalRuntime = process.env.NEXT_RUNTIME;

afterEach(() => {
  if (originalRuntime === undefined) {
    delete process.env.NEXT_RUNTIME;
  } else {
    process.env.NEXT_RUNTIME = originalRuntime;
  }
  vi.doUnmock("@/lib/observability/arize");
  vi.resetModules();
});

describe("instrumentation runtime boundary", () => {
  it("keeps the Arize import inside Next's Node.js compile-time branch", () => {
    const file = join(process.cwd(), "instrumentation.ts");
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let arizeImport: ts.CallExpression | undefined;

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === "@/lib/observability/arize"
      ) {
        arizeImport = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    let parent = arizeImport?.parent;
    while (parent && !ts.isIfStatement(parent)) parent = parent.parent;
    const runtimeGuard = parent && ts.isIfStatement(parent) ? parent : undefined;

    expect(arizeImport).toBeDefined();
    expect(runtimeGuard).toBeDefined();
    expect(runtimeGuard!.expression.getText(sourceFile)).toBe(
      'process.env.NEXT_RUNTIME === "nodejs"',
    );
  });

  it("loads Arize tracing only for the Node.js instrumentation runtime", async () => {
    const moduleLoaded = vi.fn();
    const registerArizeTracing = vi.fn(async () => {});

    vi.doMock("@/lib/observability/arize", () => {
      moduleLoaded();
      return { registerArizeTracing };
    });

    process.env.NEXT_RUNTIME = "edge";
    const edgeInstrumentation = await import("../instrumentation");
    await edgeInstrumentation.register();

    expect(moduleLoaded).not.toHaveBeenCalled();
    expect(registerArizeTracing).not.toHaveBeenCalled();

    vi.resetModules();
    process.env.NEXT_RUNTIME = "nodejs";
    const nodeInstrumentation = await import("../instrumentation");
    await nodeInstrumentation.register();

    expect(moduleLoaded).toHaveBeenCalledTimes(1);
    expect(registerArizeTracing).toHaveBeenCalledTimes(1);
  });
});
