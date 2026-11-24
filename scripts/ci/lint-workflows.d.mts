export type WorkflowDocument = { file: string; parsed: unknown; source?: string };
export declare function lintWorkflows(workflows: WorkflowDocument[], actions?: WorkflowDocument[]): string[];
export declare function readWorkflows(root: string): WorkflowDocument[];
