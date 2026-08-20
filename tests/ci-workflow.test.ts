import fs from 'node:fs';
import path from 'node:path';

const workflowDirectory = path.join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
    return fs.readFileSync(path.join(workflowDirectory, name), 'utf8');
}

function pinnedActions(workflow: string): string[] {
    return [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(match => match[1]);
}

const packageNames = ['core', 'sqlite', 'postgres', 'mysql', 'testing', 'cli'] as const;

describe('public alpha CI workflow', () => {
    const workflow = readWorkflow('ci.yml');

    it('owns exactly the evidence and release workflows', () => {
        expect(fs.readdirSync(workflowDirectory).sort())
            .toEqual(['ci.yml', 'release.yml']);
    });

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
        const uses = pinnedActions(workflow);
        expect(uses.length).toBeGreaterThan(0);
        expect(uses.every(value => /@[0-9a-f]{40}$/u.test(value)))
            .toBe(true);
        expect(workflow.match(/persist-credentials: false/gu)?.length)
            .toBe(5);
        expect(workflow).toContain('permissions:\n  contents: read');
    });

    it('never publishes from the evidence workflow', () => {
        expect(workflow).not.toContain('npm publish');
    });
});

describe('alpha release workflow', () => {
    const workflow = readWorkflow('release.yml');
    const triggers = workflow.slice(
        workflow.indexOf('\non:'),
        workflow.indexOf('\npermissions:'),
    );

    it('can only be started by a manual dispatch', () => {
        expect(triggers).toContain('workflow_dispatch:');
        for (const trigger of [
            'push:', 'pull_request:', 'pull_request_target:', 'schedule:',
            'workflow_call:', 'workflow_run:', 'repository_dispatch:',
        ]) {
            expect(`${trigger}:${String(triggers.includes(trigger))}`)
                .toBe(`${trigger}:false`);
        }
    });

    it('requires the publish-alpha confirmation phrase before any job runs', () => {
        expect(triggers).toContain('confirm:');
        expect(triggers).toContain('required: true');
        expect(workflow).toContain('CONFIRM: ${{ inputs.confirm }}');
        expect(workflow).toMatch(/if \[ "\$CONFIRM" != "publish-alpha" \]/u);
        // Both working jobs hang off the confirmation gate.
        expect(workflow).toContain('needs: confirm');
        expect(workflow).toContain('needs: evidence');
    });

    it('collects the full evidence matrix before publishing', () => {
        for (const command of [
            'npm ci', 'npm run verify', 'npm run test:coverage',
            'npm run test:integration', 'npm run test:integration:mysql',
        ]) {
            expect(workflow).toContain(`- run: ${command}`);
        }
        expect(workflow).toContain('image: postgres:18');
        expect(workflow).toContain('image: mysql:8.4');
        expect(workflow.indexOf('npm run test:integration:mysql'))
            .toBeLessThan(workflow.indexOf('npm publish'));
    });

    it('guards every publish and only ever publishes the alpha dist-tag', () => {
        const guards = workflow.match(
            /node \.\.\/\.\.\/scripts\/guard-alpha-publish\.js/gu,
        );
        expect(guards?.length).toBe(packageNames.length);

        const publishes = [...workflow.matchAll(/npm publish[^\n]*/gu)]
            .map(match => match[0]);
        expect(publishes).toHaveLength(packageNames.length);
        expect(publishes.every(command =>
            command.includes('--provenance') && command.includes('--tag alpha')))
            .toBe(true);
    });

    it('publishes in dependency order, each behind its own guard', () => {
        const offsets = packageNames.map(name => {
            const guard = workflow.indexOf(`working-directory: packages/${name}`);
            const publish = workflow.indexOf(
                `npm publish --workspace packages/${name} --provenance --tag alpha`,
            );
            expect(`${name}:${String(guard >= 0 && publish > guard)}`)
                .toBe(`${name}:true`);
            return publish;
        });

        expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    });

    it('signs provenance with a scoped OIDC identity and pins its actions', () => {
        expect(workflow).toContain('permissions:\n  contents: read');
        expect(workflow).toContain('id-token: write');
        expect(workflow).toContain('registry-url: https://registry.npmjs.org');

        const uses = pinnedActions(workflow);
        expect(uses.length).toBeGreaterThan(0);
        expect(uses.every(value => /@[0-9a-f]{40}$/u.test(value))).toBe(true);
        expect(workflow.match(/persist-credentials: false/gu)?.length).toBe(2);
    });
});
