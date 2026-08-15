import fs from 'node:fs';
import path from 'node:path';

describe('public alpha CI workflow', () => {
    const workflow = fs.readFileSync(path.join(
        process.cwd(), '.github', 'workflows', 'ci.yml',
    ), 'utf8');

    it('runs every alpha release evidence lane', () => {
        for (const lane of [
            'verify:', 'coverage:', 'mutation:', 'postgres:', 'mysql:',
        ]) {
            expect(workflow).toContain(`  ${lane}`);
        }
        expect(workflow).toContain('npm run verify');
        expect(workflow).toContain('npm run test:coverage');
        expect(workflow).toContain('npm run test:mutation');
        expect(workflow).toContain('npm run test:integration');
        expect(workflow).toContain('npm run test:integration:mysql');
    });

    it('pins actions immutably and does not persist push credentials', () => {
        const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)]
            .map(match => match[1]);
        expect(uses.length).toBeGreaterThan(0);
        expect(uses.every(value => /@[0-9a-f]{40}$/.test(value)))
            .toBe(true);
        expect(workflow.match(/persist-credentials: false/g)?.length)
            .toBe(5);
        expect(workflow).toContain('permissions:\n  contents: read');
    });
});
