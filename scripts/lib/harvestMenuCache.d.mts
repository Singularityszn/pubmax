export type HarvestMenuPage = {
  markdown: string;
  finalUrl: string;
};

export function readValidatedMenuPageCache(input: {
  requestedUrl: string;
  markdownPath: string;
  validateResolvedMenuUrl(requestedUrl: string, finalUrl: string): Promise<string>;
}): Promise<HarvestMenuPage | null>;

export function writeMenuPageCache(input: {
  requestedUrl: string;
  markdownPath: string;
  page: HarvestMenuPage;
}): void;
