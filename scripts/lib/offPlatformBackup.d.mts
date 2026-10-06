export const DEFAULT_BUCKET: string;
export const PRUNE_AFTER_WEEKS: number;
export const DUMP_SCHEMAS: string[];
export function pgEnvFromUrl(connectionString: string): Record<string, string>;
export function dumpFileName(date: Date): string;
export function pgDumpArgs(outputFile: string): string[];
export function pruneBackupCopy(input: {
  dir: string;
  bucketRoot: string;
  now: number;
}): { dumps: number; files: number; directories: number };
export function isInsideDirectory(candidate: string, directory: string): boolean;
export function listBucketObjects(input: {
  baseUrl: string;
  key: string;
  bucket: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ path: string; size: number | null }>>;
export function safeObjectPath(root: string, objectPath: string): string;
