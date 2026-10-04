import type { MutationPlan } from './mutation-campaigns';
export interface MutationFileReport { mutants: Array<{ status: string }> }
export interface MutationMetrics {
    score: number;
    eligible: number;
    counts: Record<string, number>;
}
export function mutationScore(files: Record<string, MutationFileReport>): MutationMetrics;
export function checkMutationReports(plan: MutationPlan & { commit: string }, directory: string, sourceRoot?: string): Array<MutationMetrics & { id: string; threshold: number }>;
