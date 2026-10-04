import fs from 'node:fs';
import path from 'node:path';
import { affectedCampaigns, mutationCampaigns, mutationFile, mutationPlan, shardMutationScope } from '../scripts/mutation-campaigns';

describe('mutation qualification planning', () => {
    const root = process.cwd();
    const campaigns = mutationCampaigns(root);

    it('derives all 26 campaigns from the canonical local mutation command', () => {
        expect(campaigns).toHaveLength(26);
        expect(new Set(campaigns.map(campaign => campaign.id)).size).toBe(26);
        expect(campaigns.map(campaign => path.basename(campaign.config)).sort())
            .toEqual(fs.readdirSync(path.join(root, 'config/stryker')).filter(file => file.endsWith('.cjs')).sort());
        expect(campaigns.every(campaign => campaign.threshold === 90)).toBe(true);
    });

    it('keeps every original scope exactly once and every file within one full-run shard', () => {
        const full = mutationPlan(root, 'full');
        expect(full.jobs).toHaveLength(33);
        expect(full.deferred).toEqual([]);
        for (const campaign of campaigns) {
            const jobs = full.jobs.filter(job => job.campaign === campaign.id);
            expect(jobs.flatMap(job => job.mutate).sort()).toEqual([...campaign.mutate].sort());
            const owners: Map<string, string> = new Map();
            for (const job of jobs) {
                expect(job.threshold).toBe(campaign.threshold);
                for (const pattern of job.mutate) {
                    const file = mutationFile(pattern);
                    expect(owners.get(file) ?? job.id).toBe(job.id);
                    owners.set(file, job.id);
                }
            }
        }
        expect(full.jobs.filter(job => job.campaign === 'core').every(job => job.shards === 8)).toBe(true);
    });

    it('balances shards deterministically without separating line ranges of one file', () => {
        const patterns = ['a.ts:1-10', 'b.ts', 'a.ts:20-30', 'c.ts'];
        const read = (file: string): string => '\n'.repeat(file === 'b.ts' ? 50 : 25);
        const shards = shardMutationScope(patterns, 2, read);
        expect(shards).toEqual(shardMutationScope([...patterns].reverse(), 2, read));
        expect(shards.find(shard => shard.includes('a.ts:1-10'))).toContain('a.ts:20-30');
        expect(() => shardMutationScope(patterns, 0, read)).toThrow('positive integer');
    });

    it.each(['packages/core/src/index.ts', 'tests/support/model.ts', 'tests/simple-model.ts',
        'tests/fixtures/example.json', 'package-lock.json', 'tsconfig.json', 'config/jest/jest.config.cjs', 'scripts/run-mutation.js'])(
        'conservatively reruns all scoped campaigns for shared input %s', file => {
            const plan = mutationPlan(root, 'pr', [file]);
            expect(plan.jobs).toHaveLength(25);
            expect(plan.jobs.some(job => job.campaign === 'core')).toBe(false);
            expect(plan.deferred).toEqual(['core']);
        });

    it('selects the campaign for a direct test change and skips docs-only changes', () => {
        expect(affectedCampaigns(campaigns, ['tests/checked-materialization.test.ts']).map(campaign => campaign.id))
            .toContain('checked-scalar');
        expect(mutationPlan(root, 'pr', ['README.md', 'docs/upgrading.md']).jobs).toEqual([]);
    });
});
