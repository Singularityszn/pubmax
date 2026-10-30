// The repository can stop GITHUB_TOKEN from opening pull requests even when a
// workflow asks for pull-requests: write. A scheduled refresh that hits that
// wall has still pushed its review branch, so callers hand the branch to a
// human instead of failing the run. Any other gh error stays a hard error.

function commandOutput(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

export function isPullRequestPermissionError(error) {
  const text = [error?.message, error?.stdout, error?.stderr].map(commandOutput).join("\n");
  return /github actions is not permitted to create or approve pull requests/i.test(text);
}
