import { execFileSync } from 'node:child_process';

describe('mutation range qualification', () => {
    it('generates mutation candidates for every source selected through line ranges', () => {
        // Use the installed Stryker instrumenter so comments and declarations
        // cannot masquerade as tested executable code after a source edit.
        const script = `
            import fs from 'node:fs';
            import { Instrumenter } from '@stryker-mutator/instrumenter';
            import { mutationCampaigns } from './scripts/mutation-campaigns.js';
            const logger = { debug() {}, info() {}, warn() {}, isDebugEnabled() { return false; } };
            const empty = [];
            for (const campaign of mutationCampaigns()) {
                const files = new Map();
                for (const pattern of campaign.mutate) {
                    const range = /^(.*):(\\d+)-(\\d+)$/u.exec(pattern);
                    if (!range) continue;
                    const [, name, start, end] = range;
                    const ranges = files.get(name) ?? [];
                    ranges.push({
                        start: { line: Number(start) - 1, column: 0 },
                        end: { line: Number(end) - 1, column: Number.MAX_SAFE_INTEGER },
                    });
                    files.set(name, ranges);
                }
                for (const [name, mutate] of files) {
                    const result = await new Instrumenter(logger).instrument([{
                        name, content: fs.readFileSync(name, 'utf8'), mutate,
                    }], { plugins: null, ignorers: [], excludedMutations: [] });
                    if (!result.mutants.length) empty.push(name);
                }
            }
            console.log(JSON.stringify(empty));
        `;
        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
        expect(JSON.parse(output)).toEqual([]);
    });
});
