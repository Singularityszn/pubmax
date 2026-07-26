export function publishStagedDirectory(options: {
  stagedDir: string;
  targetDir: string;
  preserveFiles?: string[];
  requiredFiles?: string[];
}): Promise<void>;
