import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createManagedSuiteTempDirectory } from './support/managed-temp-directory';

const releaseWorkflow = path.join(
    process.cwd(), '.github', 'workflows', 'release.yml',
);

/**
 * The path form the release hands npm, read out of the step that publishes
 * core so the probe below can only ever exercise the spelling the workflow
 * actually uses. Reading it rather than restating it is the point: a test that
 * carried its own copy of the path would keep passing after the workflow's
 * copy changed.
 */
function tarballPathForm(): string {
    const workflow = fs.readFileSync(releaseWorkflow, 'utf8');
    const form = /- name: Publish @entitykit\/core\n[\s\S]*?\n\s*tarball="([^"]+)"/u
        .exec(workflow)?.[1];

    expect(`tarball assignment in the core publish step:${String(form !== undefined)}`)
        .toBe('tarball assignment in the core publish step:true');
    return form ?? '';
}

/**
 * One publish attempt, spelled and quoted the way the workflow's shell spells
 * and quotes it, reported as `exit <status>` followed by everything npm said —
 * so a failure carries npm's own account of what it did with the path.
 */
function dryRunPublish(form: string, root: string): string {
    const result = spawnSync(
        'bash',
        ['-c', `set -euo pipefail\ntarball="${form}"\nnpm publish "$tarball" --dry-run\n`],
        {
            cwd: root,
            encoding: 'utf8',
            // A spec npm mistakes for a repository must not outlive the test.
            timeout: 60_000,
            env: {
                ...process.env,
                // Neither the developer's credentials nor their cache are in
                // scope, so nothing here could reach the registry with an
                // identity even if --dry-run were dropped.
                npm_config_userconfig: path.join(root, '.npmrc'),
                npm_config_cache: path.join(root, 'npm-cache'),
                // ...and a git resolution fails fast rather than prompting for
                // a password or hanging on a dial that will never answer.
                GIT_TERMINAL_PROMPT: '0',
                GIT_ASKPASS: '/bin/echo',
                GIT_SSH_COMMAND:
                    'ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no',
            },
        },
    );
    return `exit ${String(result.status)}\n${result.stdout}${result.stderr}`;
}

/**
 * npm reads a publish argument as a package spec rather than as a filename, so
 * whether a release reaches the registry at all turns on a detail of npm's own
 * parsing: `tarballs/x.tgz` carries a slash with no ./ or file: prefix, which
 * is GitHub shorthand, so npm resolves it with git ls-remote and never opens
 * the file sitting right there. Asserting on the text of release.yml cannot
 * catch that, and neither can a fake npm on PATH — a shim agrees with whatever
 * it is handed. So this suite reads the form out of release.yml, hands it to
 * the real npm with a throwaway package standing in for a release, and watches
 * which of the two things npm does with it.
 */
describe('release tarball path form', () => {
    const probeName = 'entitykit-path-form-probe';
    const probeVersion = '0.0.0';
    const probeTarball = `${probeName}-${probeVersion}.tgz`;
    /** e.g. `$PWD/tarballs/entitykit-core-$VERSION.tgz`. */
    const workflowForm = tarballPathForm();
    /** That form carrying the probe's identity in place of a release's. */
    const probeForm = workflowForm.replace(
        /entitykit-[a-z]+-\$VERSION\.tgz$/u,
        probeTarball,
    );
    let root = '';

    beforeAll(() => {
        root = createManagedSuiteTempDirectory('entitykit-path-form-');
        const source = path.join(root, 'source');
        fs.mkdirSync(source);
        fs.mkdirSync(path.join(root, 'tarballs'));
        fs.writeFileSync(
            path.join(root, '.npmrc'),
            '//registry.npmjs.org/:_authToken=not-a-real-token\n',
        );
        fs.writeFileSync(
            path.join(source, 'package.json'),
            JSON.stringify({
                name: probeName, version: probeVersion, license: 'MIT',
            }),
        );
        // The tarball lands in a subdirectory of the run root, exactly as the
        // downloaded release artifact does.
        const packed = spawnSync(
            'npm',
            ['pack', '--pack-destination', path.join(root, 'tarballs')],
            { cwd: source, encoding: 'utf8', timeout: 60_000 },
        );

        expect(`exit ${String(packed.status)}\n${packed.stderr}`)
            .toMatch(/^exit 0\n/u);
        expect(fs.existsSync(path.join(root, 'tarballs', probeTarball))).toBe(true);
        // The substitution replaced the identity and kept the prefix and the
        // directory segment that are under test, so neither run below can pass
        // against a path the workflow would never produce.
        expect(probeForm.endsWith(`/${probeTarball}`)).toBe(true);
    }, 60_000);

    it('resolves to the packed tarball when npm is handed it', () => {
        const run = dryRunPublish(probeForm, root);

        // Whatever release.yml says today, npm opened it as a local file.
        expect(run).toMatch(/^exit 0\n/u);
        expect(run).toContain(probeTarball);
        expect(run).toContain(`+ ${probeName}@${probeVersion}`);
    }, 60_000);

    it('is refused by npm the moment the same path loses its prefix', () => {
        // The discriminator. Without it the test above would pass against a
        // bare path too, and so prove nothing about why the prefix is there.
        const bare = probeForm.replace(/^\$PWD\//u, '');
        expect(bare).toBe(`tarballs/${probeTarball}`);

        const run = dryRunPublish(bare, root);

        expect(run).not.toMatch(/^exit 0\n/u);
        expect(run).not.toContain(`+ ${probeName}@${probeVersion}`);
        // npm went looking for a repository named tarballs/…tgz instead of for
        // the file. A run killed at the timeout — `exit null` — says the same
        // thing: it was still dialling something that is not the disk.
        expect(run).toMatch(/git|ls-remote|repository|ENOENT|exit null/iu);
    }, 60_000);
});
