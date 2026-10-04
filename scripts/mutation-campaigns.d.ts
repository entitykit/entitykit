export interface MutationCampaign {
    id: string;
    config: string;
    mutate: string[];
    tests: string[];
    threshold: number;
}
export interface MutationJob {
    id: string;
    campaign: string;
    config: string;
    mutate: string[];
    shard: number;
    shards: number;
    threshold: number;
}
export interface MutationPlan {
    mode: 'full' | 'pr';
    jobs: MutationJob[];
    deferred: string[];
}
export function mutationCampaigns(root?: string): MutationCampaign[];
export function mutationFile(pattern: string): string;
export function shardMutationScope(patterns: string[], count: number, readSource: (file: string) => string): string[][];
export function affectedCampaigns(campaigns: MutationCampaign[], changedFiles: string[]): MutationCampaign[];
export function mutationPlan(root: string, mode: 'full' | 'pr', changedFiles?: string[]): MutationPlan;
