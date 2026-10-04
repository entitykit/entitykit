import fs from 'node:fs';
import path from 'node:path';
import { checkMutationReports, mutationScore } from '../scripts/check-mutation-reports';
import type { MutationPlan } from '../scripts/mutation-campaigns';
import { createManagedTempDirectory } from './support/managed-temp-directory';

function fixture(): { directory: string; plan: MutationPlan & { commit: string }; write: (id: string, file: string, statuses: string[]) => void } {
    const directory = createManagedTempDirectory('entitykit-mutation-report-');
    const plan: MutationPlan & { commit: string } = {
        mode: 'full', commit: 'reviewed-commit', deferred: [],
        jobs: ['a', 'b'].map((id, index) => ({
            id, campaign: 'core', config: 'config/stryker/stryker.config.cjs', mutate: [`${id}.ts`],
            shard: index + 1, shards: 2, threshold: 90,
        })),
    };
    const write = (id: string, file: string, statuses: string[]): void => {
        const job = plan.jobs.find(item => item.id === id);
        fs.writeFileSync(path.join(directory, `${id}.result.json`), JSON.stringify({ ...job, commit: plan.commit, mode: plan.mode }));
        fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({ files: {
            [file]: { mutants: statuses.map(status => ({ status })) },
        } }));
    };
    write('a', 'a.ts', ['Killed']);
    write('b', 'b.ts', ['Killed']);
    return { directory, plan, write };
}

describe('complete mutation report qualification', () => {
    it('weights the original campaign score by mutants across every shard', () => {
        const { directory, plan, write } = fixture();
        write('a', 'a.ts', ['Survived']);
        write('b', 'b.ts', Array<string>(9).fill('Killed'));
        const [result] = checkMutationReports(plan, directory);
        expect(result.score).toBe(90);
        expect(result.eligible).toBe(10);
        write('b', 'b.ts', Array<string>(8).fill('Killed'));
        expect(() => checkMutationReports(plan, directory)).toThrow('below 90%');
    });

    it('uses Stryker detection semantics, including timeouts and uncovered survivors', () => {
        const metrics = mutationScore({ file: { mutants: ['Killed', 'Timeout', 'NoCoverage', 'Survived', 'Ignored', 'RuntimeError', 'CompileError']
            .map(status => ({ status })) } });
        expect(metrics.score).toBe(50);
        expect(metrics.eligible).toBe(4);
        expect(() => mutationScore({ file: { mutants: [{ status: 'Pending' }] } })).toThrow('Unfinished');
        expect(() => mutationScore({ file: { mutants: [{ status: 'Ignored' }] } })).toThrow('no eligible');
    });

    it('refuses missing shards, source omissions and unexpected source files', () => {
        const { directory, plan, write } = fixture();
        fs.unlinkSync(path.join(directory, 'b.result.json'));
        expect(() => checkMutationReports(plan, directory)).toThrow();
        write('b', 'wrong.ts', ['Killed']);
        expect(() => checkMutationReports(plan, directory)).toThrow('Missing or unexpected');
        fs.writeFileSync(path.join(directory, 'b.json'), JSON.stringify({ files: {} }));
        expect(() => checkMutationReports(plan, directory)).toThrow('Missing or unexpected');
    });

    it.each(['commit', 'mode', 'threshold', 'shard', 'mutate'])('refuses stale or mismatched %s evidence', field => {
        const { directory, plan } = fixture();
        const file = path.join(directory, 'a.result.json');
        const result = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        result[field] = 'different';
        fs.writeFileSync(file, JSON.stringify(result));
        expect(() => checkMutationReports(plan, directory)).toThrow();
    });

    it('rejects overlapping shard ownership and permits a planned docs-only PR', () => {
        const { directory, plan, write } = fixture();
        plan.jobs[1].mutate = ['a.ts'];
        write('b', 'a.ts', ['Killed']);
        expect(() => checkMutationReports(plan, directory)).toThrow('Duplicate mutation source');
        expect(checkMutationReports({ mode: 'pr', commit: 'docs-commit', jobs: [], deferred: ['core'] }, directory)).toEqual([]);
    });
});
