export function publishStagedDirectory(options: {
  stagedDir: string;
  targetDir: string;
  requiredFiles?: string[];
  manifestBudgetBytes?: number;
  totalBudgetBytes?: number;
}): Promise<{
  generation: string;
  manifestBytes: number;
  shardBytes: number;
  totalBytes: number;
}>;
