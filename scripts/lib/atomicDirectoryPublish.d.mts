export function publishStagedDirectory(options: {
  stagedDir: string;
  targetDir: string;
  requiredFiles?: string[];
}): Promise<void>;
