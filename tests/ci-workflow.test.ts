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

/** One step's body, from its `- name:` line to the next step beside it. */
function stepBlock(job: string, name: string): string {
    const start = job.indexOf(`      - name: ${name}\n`);
    expect(`${name} step:${String(start >= 0)}`).toBe(`${name} step:true`);
    const body = job.slice(start + 1);
    const end = body.indexOf('\n      - ');
    return end < 0 ? body : body.slice(0, end);
}

const packageNames = [
    'core', 'sqlite', 'postgres', 'mysql', 'nestjs', 'testing', 'cli',
] as const;
/**
 * The one SHA-512 SRI computation, spelled the same in the job that publishes
 * and the job that promotes. `tr -d` is load-bearing: GNU base64 wraps at 76
 * columns, and an 88-character digest would arrive in two lines without it.
 */
const packedIntegrity =
    'packed="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 | tr -d \'\\n\')"';
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
            'verify:', 'coverage:', 'mutation:', 'postgres:', 'mysql:', 'nextjs:',
        ]) {
            expect(workflow).toContain(`  ${lane}`);
        }
        for (const command of evidenceCommands) {
            expect(workflow).toContain(`- run: ${command}`);
        }
        expect(workflow).toContain('npm run test:e2e'
            + ' --workspace @entitykit/example-nextjs-postgres');
        expect(workflow).toContain('image: postgres:18');
        expect(workflow).toContain('npx playwright install --with-deps chromium');
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
            .toBe(6);
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

    it('uploads the tarballs one build-pack-accept operation accepted', () => {
        // check:package builds, packs into tarballs/ and runs every acceptance
        // stage against those files, then leaves them behind — so the artifact
        // uploaded here is the artifact that was accepted, byte for byte.
        expect(evidence).toContain(
            'ENTITYKIT_PACKAGE_OUTPUT_DIR="$PWD/tarballs" npm run check:package',
        );
        // A second build or pack anywhere in this workflow would put untested
        // bytes on the registry, so neither appears in the file at all.
        for (const absent of ['npm run build', 'npm pack']) {
            expect(`${absent} in release.yml:${String(workflow.includes(absent))}`)
                .toBe(`${absent} in release.yml:false`);
        }
        expect(evidence.indexOf('uses: actions/upload-artifact@'))
            .toBeGreaterThan(evidence.indexOf('ENTITYKIT_PACKAGE_OUTPUT_DIR'));
        expect(evidence).toContain('name: release-tarballs');
        expect(evidence).toContain('path: tarballs/*.tgz');
        expect(evidence).toContain('if-no-files-found: error');

        expect(publish).toContain('uses: actions/download-artifact@');
        expect(publish).toContain('name: release-tarballs');
        // The publish job has no working tree at all, so there is nothing for
        // it to rebuild: what it publishes is what the matrix above verified.
        for (const absent of ['actions/checkout', 'npm ci']) {
            expect(`${absent} in publish:${String(publish.includes(absent))}`)
                .toBe(`${absent} in publish:false`);
        }
        expect(declaredNeeds(publish)).toContain('evidence');
    });

    it('refuses a tarball set that is not exactly the seven identities', () => {
        const preflight = stepBlock(publish, 'Preflight the packed tarballs');
        expect(publish).toContain('id: preflight');
        expect(preflight).toContain('tar -xzOf "$tarball" package/package.json');
        // The roster is named rather than counted: seven tarballs missing one
        // package and repeating another still count to seven.
        for (const name of packageNames) {
            expect(`${name} named in the roster:`
                + String(preflight.includes(`"@entitykit/${name}"`)))
                .toBe(`${name} named in the roster:true`);
        }
        expect(preflight).toContain('!= "$roster"');
        expect(preflight)
            .toContain('Refusing to publish: expected exactly the seven @entitykit packages');
        expect(preflight).toContain('Refusing to publish: the tarballs carry versions');
        expect(preflight).toContain('is not an -alpha.N prerelease version');
        expect(preflight).toContain('npm view "@entitykit/core@alpha" version');
        expect(preflight).toContain('is older than current alpha');
        expect(preflight).toContain('Accepting same-version retry');
        expect(preflight).toContain('Accepting forward alpha movement');
        expect(preflight).toContain('echo "version=$distinct" >> "$GITHUB_OUTPUT"');
    });
    it('publishes seven candidates in dependency order, never the alpha tag', () => {
        const publishes = [...publish.matchAll(/npm publish[^\n]*/gu)]
            .map(match => match[0]);
        expect(publishes).toHaveLength(packageNames.length);
        expect(publishes.every(command =>
            command.includes('--provenance')
            && command.endsWith('--tag alpha-candidate')))
            .toBe(true);

        // Each step names its own tarball out of the downloaded artifact, and
        // core is packed and published before anything that peers on it.
        const offsets = packageNames.map(name => {
            const offset = publish.indexOf(
                `tarball="$PWD/tarballs/entitykit-${name}-$VERSION.tgz"`,
            );
            expect(`${name}:${String(offset >= 0)}`).toBe(`${name}:true`);
            return offset;
        });
        expect(offsets).toEqual([...offsets].sort((left, right) => left - right));

        // Every tarball path in the file is absolute. npm reads a publish
        // argument as a package spec, so a relative path carrying a slash but
        // no ./ or file: prefix is GitHub shorthand — owner/repo — and npm
        // goes to git rather than to the file beside it. This assertion is
        // about the text; release-tarball-spec.test.ts hands the real npm the
        // form this file pins and watches which of the two it does.
        expect(workflow).not.toMatch(/tarball="tarballs\//u);
    });

    it('resumes on matching bytes and refuses a version that moved', () => {
        for (const name of packageNames) {
            const step = stepBlock(publish, `Publish @entitykit/${name}`);
            const spec = `@entitykit/${name}@$VERSION`;

            // What the registry holds is compared to what was packed, not to
            // whether the version exists.
            expect(step).toContain(packedIntegrity);
            expect(step).toContain(`if published=$(npm view "${spec}" dist.integrity`);
            // Outcome one: this exact tarball is already up, so a run that
            // died partway can simply be dispatched again.
            expect(step).toContain(`echo "Skipping ${spec}: already on the registry`);
            // Outcome two: the version is taken by other bytes. A published
            // version is immutable, so the release stops rather than
            // assembling a family from two different commits.
            expect(step).toContain('if [ "$published" != "$packed" ]; then');
            expect(step).toContain(
                `Refusing to publish: ${spec} is already on the registry with different bytes.`,
            );
            expect(step).toContain('echo "  registry: $published" >&2');
            expect(step).toContain('echo "  packed:   $packed" >&2');
            expect(step).toContain('Bump the version and dispatch again.');
            // Outcome three: only a clean E404 means absent. A network or auth
            // failure must never be read as an empty version slot.
            expect(step).toContain('if ! grep -q E404 view.err; then');
            expect(step).toContain(
                `Refusing to publish: npm view ${spec} failed for some reason other than`,
            );
            expect(step.match(/exit 1$/gum)?.length).toBe(2);
        }
    });

    it('explains why the prepublishOnly guard cannot stand in for the tag', () => {
        // Publishing a tarball skips prepublishOnly, so the guard never runs
        // here; the explicit candidate tag and this workflow's own gates are
        // what replace it. The guard is named only in that explanation.
        expect(workflow).toContain('does not run prepublishOnly');
        expect(publish).not.toContain('node ../../scripts/guard-alpha-publish.js');
    });

    it('moves the alpha dist-tag only onto the bytes it accepted', () => {
        const verify = stepBlock(promote, 'Require the registry to hold the accepted bytes');
        expect(declaredNeeds(promote)).toContain('publish');
        // The tag users resolve may only land on the accepted tarballs, so
        // this job re-derives every SRI from the same artifact the publish job
        // worked from rather than trusting a version number.
        expect(promote).toContain('uses: actions/download-artifact@');
        expect(promote).toContain('name: release-tarballs');
        expect(verify).toContain(packedIntegrity);
        expect(verify).toContain('npm view "@entitykit/$name@$VERSION" dist.integrity');
        expect(verify).toContain('if [ "$published" != "$packed" ]; then');
        expect(verify).toContain('Refusing to promote:');
        expect(verify)
            .toContain('on the registry is not the accepted tarball');
        expect(verify).toContain('is missing from the release artifact');

        // All seven are verified before the first flip, so a family that fails
        // verification is never half-promoted.
        expect(promote.indexOf('npm dist-tag add'))
            .toBeGreaterThan(promote.lastIndexOf('is not the accepted tarball'));
        expect(promote).toContain('npm dist-tag add "@entitykit/$name@$VERSION" alpha');
        expect(promote).toContain('for attempt in 1 2 3');
        expect(promote).toContain('after three attempts; rerun this release');
        expect(promote).toContain('npm view "@entitykit/$name@alpha" version');
        expect(promote).toContain('Alpha promotion verification failed:');
        expect(promote).toContain('Verified @entitykit/$name@alpha -> $VERSION');
        expect(promote).not.toContain('npm publish');
        // Stage B strictly follows stage A: the inconsistent window is seven tag
        // flips, not seven publishes.
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
