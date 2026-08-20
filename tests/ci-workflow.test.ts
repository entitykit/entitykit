import fs from 'node:fs';
import path from 'node:path';

const workflowDirectory = path.join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
    return fs.readFileSync(path.join(workflowDirectory, name), 'utf8');
}

function pinnedActions(workflow: string): string[] {
    return [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(match => match[1]);
}

/** One job's body, from its key to the next job key at the same indent. */
function jobBlock(workflow: string, name: string): string {
    const lines = workflow.split('\n');
    const start = lines.indexOf(`  ${name}:`);
    expect(`${name} job:${String(start >= 0)}`).toBe(`${name} job:true`);
    const body = lines.slice(start + 1);
    const end = body.findIndex(line => /^ {2}\S/u.test(line));
    return (end < 0 ? body : body.slice(0, end)).join('\n');
}

function declaredNeeds(job: string): string {
    return /needs: \[([^\]]*)\]/u.exec(job)?.[1] ?? '';
}

const packageNames = ['core', 'sqlite', 'postgres', 'mysql', 'testing', 'cli'] as const;
/** The lanes a release must clear, all of them owned by ci.yml. */
const evidenceCommands = [
    'npm run verify', 'npm run test:coverage', 'npm run test:mutation',
    'npm run test:integration', 'npm run test:integration:mysql',
] as const;

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
        for (const command of evidenceCommands) {
            expect(workflow).toContain(`- run: ${command}`);
        }
        expect(workflow).toContain('node: [22.13.0, 24]');
    });

    it('offers itself as the reusable gate the release workflow calls', () => {
        const triggers = workflow.slice(
            workflow.indexOf('\non:'),
            workflow.indexOf('\npermissions:'),
        );

        // Release alpha calls this file, so the release gate cannot drift into
        // a hand-copied subset of the branch gate.
        expect(triggers).toContain('workflow_call:');
        // ...without giving up the triggers that gate main in the first place.
        expect(triggers).toContain('push:');
        expect(triggers).toContain('pull_request:');
        expect(triggers).toContain('workflow_dispatch:');
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
    const ci = readWorkflow('ci.yml');
    const triggers = workflow.slice(
        workflow.indexOf('\non:'),
        workflow.indexOf('\npermissions:'),
    );
    const evidence = jobBlock(workflow, 'evidence');
    const publish = jobBlock(workflow, 'publish');
    const promote = jobBlock(workflow, 'promote');

    it('can only be started by a manual dispatch', () => {
        expect(triggers).toContain('workflow_dispatch:');
        for (const trigger of [
            'push:', 'pull_request:', 'pull_request_target:', 'schedule:',
            'workflow_call:', 'workflow_run:', 'repository_dispatch:',
        ]) {
            expect(`${trigger}:${String(triggers.includes(trigger))}`)
                .toBe(`${trigger}:false`);
        }
        expect(workflow)
            .toContain('concurrency:\n  group: release-alpha\n  cancel-in-progress: false');
    });

    it('requires the publish-alpha confirmation phrase before any job runs', () => {
        expect(triggers).toContain('confirm:');
        expect(triggers).toContain('required: true');
        expect(workflow).toContain('CONFIRM: ${{ inputs.confirm }}');
        expect(workflow).toMatch(/if \[ "\$CONFIRM" != "publish-alpha" \]/u);
    });

    it('refuses to release from any ref but main', () => {
        const guard = jobBlock(workflow, 'guard');

        // A dispatch can name any branch or tag. Evidence collected somewhere
        // else proves nothing about what would be published.
        expect(guard).toContain('REF: ${{ github.ref }}');
        expect(guard).toMatch(/if \[ "\$REF" != "refs\/heads\/main" \]/u);
        expect(guard).toContain('exit 1');
    });

    it('hangs every working job off both gates', () => {
        for (const name of ['ci', 'evidence', 'publish', 'promote']) {
            const needs = declaredNeeds(jobBlock(workflow, name));

            expect(`${name} needs confirm:${String(needs.includes('confirm'))}`)
                .toBe(`${name} needs confirm:true`);
            expect(`${name} needs guard:${String(needs.includes('guard'))}`)
                .toBe(`${name} needs guard:true`);
        }
    });

    it('runs the complete CI matrix on the ref it is releasing', () => {
        // The release matrix IS the CI matrix: both Node versions, runtime
        // coverage, the mutation score, and both live databases, invoked as a
        // reusable workflow so the caller cannot silently keep a subset.
        expect(jobBlock(workflow, 'ci'))
            .toContain('uses: ./.github/workflows/ci.yml');
        expect(ci).toContain('workflow_call:');
        expect(ci).toContain('node: [22.13.0, 24]');
        for (const command of evidenceCommands) {
            expect(ci).toContain(`- run: ${command}`);
            expect(`${command} restated in release.yml:`
                + String(workflow.includes(command)))
                .toBe(`${command} restated in release.yml:false`);
        }
        expect(ci).toContain('image: postgres:18');
        expect(ci).toContain('image: mysql:8.4');
    });

    it('publishes the exact tarballs the evidence job packed', () => {
        expect(evidence).toContain('npm pack --workspaces --pack-destination tarballs');
        expect(evidence).toContain('uses: actions/upload-artifact@');
        expect(evidence).toContain('name: release-tarballs');
        expect(evidence).toContain('if-no-files-found: error');

        expect(publish).toContain('uses: actions/download-artifact@');
        expect(publish).toContain('name: release-tarballs');
        // The publish job has no working tree at all, so there is nothing for
        // it to rebuild: what it publishes is what the matrix above verified.
        for (const absent of ['actions/checkout', 'npm ci', 'npm run build']) {
            expect(`${absent} in publish:${String(publish.includes(absent))}`)
                .toBe(`${absent} in publish:false`);
        }
        expect(declaredNeeds(publish)).toContain('evidence');
    });

    it('refuses a release whose six tarballs disagree', () => {
        expect(publish).toContain('id: preflight');
        expect(publish).toContain('tar -xzOf "$tarball" package/package.json');
        expect(publish).toContain('Refusing to publish: expected six packages');
        expect(publish).toContain('Refusing to publish: the tarballs carry versions');
        expect(publish).toContain('echo "version=$distinct" >> "$GITHUB_OUTPUT"');
    });

    it('publishes six candidates in dependency order, never the alpha tag', () => {
        const publishes = [...publish.matchAll(/npm publish[^\n]*/gu)]
            .map(match => match[0]);
        expect(publishes).toHaveLength(packageNames.length);
        expect(publishes.every(command =>
            command.includes('--provenance')
            && command.endsWith('--tag alpha-candidate')))
            .toBe(true);

        const offsets = packageNames.map(name => {
            const offset = publish.indexOf(
                `npm publish "tarballs/entitykit-${name}-$VERSION.tgz"`,
            );
            expect(`${name}:${String(offset >= 0)}`).toBe(`${name}:true`);
            return offset;
        });
        expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    });

    it('skips a package that is already on the registry, so a run can resume', () => {
        for (const name of packageNames) {
            expect(publish).toContain(
                `if npm view "@entitykit/${name}@$VERSION" version > /dev/null 2>&1; then`,
            );
        }
        expect(publish.match(
            /echo "Skipping @entitykit\/\w+@\$VERSION: already on the registry\."/gu,
        )?.length).toBe(packageNames.length);
    });

    it('explains why the prepublishOnly guard cannot stand in for the tag', () => {
        // Publishing a tarball skips prepublishOnly, so the guard never runs
        // here; the explicit candidate tag and this workflow's own gates are
        // what replace it. The guard is named only in that explanation.
        expect(workflow).toContain('does not run prepublishOnly');
        expect(publish).not.toContain('node ../../scripts/guard-alpha-publish.js');
    });

    it('moves the alpha dist-tag only after all six candidates exist', () => {
        expect(declaredNeeds(promote)).toContain('publish');
        expect(promote).toContain('Refusing to promote:');
        expect(promote).toContain('npm dist-tag add "@entitykit/$name@$VERSION" alpha');
        expect(promote).not.toContain('npm publish');
        // Stage B strictly follows stage A: the inconsistent window is six tag
        // flips, not six publishes.
        expect(workflow.indexOf('npm dist-tag add'))
            .toBeGreaterThan(workflow.lastIndexOf('npm publish'));
    });

    it('signs provenance with a scoped OIDC identity and pins its actions', () => {
        expect(workflow).toContain('permissions:\n  contents: read');
        expect(workflow).toContain('registry-url: https://registry.npmjs.org');
        // Only the job that publishes may mint an OIDC token; moving a
        // dist-tag signs nothing.
        expect(workflow.match(/id-token: write/gu)?.length).toBe(1);
        expect(publish).toContain('id-token: write');
        expect(promote).not.toContain('id-token');

        const uses = pinnedActions(workflow);
        expect(uses.filter(value => value.startsWith('./')))
            .toEqual(['./.github/workflows/ci.yml']);
        expect(uses.filter(value => !value.startsWith('./'))
            .every(value => /@[0-9a-f]{40}$/u.test(value))).toBe(true);
        // One checkout in the whole release: the job that packs the tarballs.
        expect(workflow.match(/persist-credentials: false/gu)?.length).toBe(1);
        expect(evidence).toContain('persist-credentials: false');
    });
});
