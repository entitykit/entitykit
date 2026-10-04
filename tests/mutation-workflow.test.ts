import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/mutation.yml'), 'utf8');
const ci = fs.readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

function jobBlock(text: string, name: string): string {
    const body = text.split(`\n  ${name}:\n`).at(1);
    if (body === undefined) throw new Error(`Missing workflow job: ${name}`);
    return body.split(/\n {2}\S/u)[0];
}

describe('nightly and reusable mutation qualification', () => {
    it('runs full nightly qualification and offers a reusable matrix without publishing', () => {
        expect(workflow).toContain('schedule:');
        expect(workflow).toContain('workflow_dispatch:');
        expect(workflow).toContain('workflow_call:');
        expect(workflow).toContain('github.event_name == \'schedule\' || inputs.full');
        expect(workflow).toContain('max-parallel: 8');
        expect(workflow).not.toContain('npm publish');
        const actions = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(match => match[1]);
        expect(actions.every(value => /@[0-9a-f]{40}$/u.test(value))).toBe(true);
        expect(workflow.match(/persist-credentials: false/gu)?.length).toBe(3);
    });

    it('requires every planned report and only writes trusted main-branch caches', () => {
        const campaign = jobBlock(workflow, 'campaign');
        const summary = jobBlock(workflow, 'summary');
        expect(campaign).toContain('github.ref == \'refs/heads/main\' && github.event_name != \'pull_request\'');
        expect(campaign).toContain('actions/cache/restore@');
        expect(campaign).toContain('actions/cache/save@');
        expect(campaign).toContain('\'packages/**/src/**\', \'tests/**\', \'scripts/**\', \'config/**\'');
        expect(campaign).not.toContain('restore-keys:');
        expect(summary).toContain('test "$HAS_WORK" = false || test "$RESULT" = success');
        expect(summary).toContain('node scripts/check-mutation-reports.js');
        expect(summary).toContain('if-no-files-found: error');
    });

    it('keeps the existing PR mutation check name and propagates focused qualification failures', () => {
        const gate = jobBlock(ci, 'mutation');
        expect(gate).toContain('name: Critical-path mutation score');
        expect(gate).toContain('needs: [mutation-campaigns]');
        expect(gate).toContain('if: always()');
        expect(gate).toContain('test "$RESULT" = success');
        expect(jobBlock(ci, 'mutation-campaigns')).toContain('full: ${{ inputs.full-mutation || false }}');
        expect(ci).not.toContain('- run: npm run test:mutation');
    });
});
