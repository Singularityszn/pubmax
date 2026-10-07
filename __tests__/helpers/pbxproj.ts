import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PbxValue = string | PbxValue[] | PbxDict;
export type PbxDict = { [key: string]: PbxValue };

export function pbxprojRoot(path: string): PbxDict {
  const tokens = (
    readFileSync(join(process.cwd(), path), "utf8").match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,"]+/g) ?? []
  ).filter((token) => !token.startsWith("/*") && !token.startsWith("//"));
  let at = 0;
  const expectToken = (want: string) => {
    if (tokens[at++] !== want) throw new Error(`${path}: expected "${want}" at token ${at - 1}`);
  };
  const value = (): PbxValue => {
    const token = tokens[at++];
    if (token === undefined) throw new Error(`${path}: ended early`);
    if (token === "{") {
      const dict: PbxDict = {};
      while (tokens[at] !== "}") {
        const key = value() as string;
        expectToken("=");
        dict[key] = value();
        expectToken(";");
      }
      at++;
      return dict;
    }
    if (token === "(") {
      const list: PbxValue[] = [];
      while (tokens[at] !== ")") {
        list.push(value());
        if (tokens[at] === ",") at++;
      }
      at++;
      return list;
    }
    return token.startsWith('"') ? (JSON.parse(token) as string) : token;
  };
  return value() as PbxDict;
}
