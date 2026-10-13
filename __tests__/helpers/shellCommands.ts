import { execFileSync } from "node:child_process";

export function shellCommands(source: string): string[][] {
  return JSON.parse(execFileSync("python3", ["-c", String.raw`
import json, re, shlex, sys
lines = []
terminator = None
for line in sys.stdin.read().splitlines():
    if terminator is not None:
        if line.strip() == terminator:
            terminator = None
        continue
    lines.append(line)
    heredoc = re.search(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1", line)
    if heredoc:
        terminator = heredoc.group(2)
lexer = shlex.shlex("\n".join(lines), posix=True, punctuation_chars=";&|()<>\n")
lexer.whitespace = " \t\r"
lexer.commenters = "#"
commands, words = [], []
for word in lexer:
    if word and all(char in ";&|()\n" for char in word):
        if words:
            commands.append(words)
            words = []
    elif not words and re.match(r"^[A-Za-z_]\w*=", word):
        continue
    else:
        words.append(word)
if words:
    commands.append(words)
print(json.dumps(commands))
`], { input: source, encoding: "utf8" })) as string[][];
}

