export const DEFAULT_BUCKET: string;
export const DEFAULT_KEEP: number;
export const DUMP_SCHEMAS: string[];
export function pgEnvFromUrl(connectionString: string): Record<string, string>;
export function dumpFileName(date: Date): string;
export function pgDumpArgs(outputFile: string): string[];
export function dumpTakenAt(file: string): number | null;
export function dumpsToPrune(files: string[], keep?: number): string[];
export function bucketFilesToPrune(
  localFiles: Array<{ path: string; lastSeenMs: number }>,
  directoryFiles: string[],
): string[];
export function isInsideDirectory(candidate: string, directory: string): boolean;
export function listBucketObjects(input: {
  baseUrl: string;
  key: string;
  bucket: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ path: string; size: number | null }>>;
export function safeObjectPath(root: string, objectPath: string): string;
