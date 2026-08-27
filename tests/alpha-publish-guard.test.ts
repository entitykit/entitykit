import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const guard = path.join(process.cwd(), 'scripts', 'guard-alpha-publish.js');

function run(
    tag?: string,
    cwd = process.cwd(),
    acceptanceDryRun = false,
): ReturnType<typeof spawnSync> {
    const env = { ...process.env };
    if (tag === undefined) delete env.npm_config_tag;
    else env.npm_config_tag = tag;
    if (acceptanceDryRun) {
        env.npm_config_dry_run = 'true';
        env.ENTITYKIT_ALPHA_DRY_RUN = 'accept';
    } else {
        delete env.npm_config_dry_run;
        delete env.ENTITYKIT_ALPHA_DRY_RUN;
    }
    return spawnSync(process.execPath, [guard], {
        cwd, encoding: 'utf8', env,
    });
}

function packageDirectory(publishConfig: unknown): string {
    const directory = createManagedTempDirectory('entitykit-guard-');
    fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: '@entitykit/probe', publishConfig }),
    );
    return directory;
}

describe('alpha publish guard', () => {
    it.each([undefined, 'latest', 'beta'])(
        'rejects non-alpha tag %s',
        tag => {
            const result = run(tag, process.cwd(), true);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('Refusing prerelease publication');
        },
    );

    it('accepts the alpha tag only for the repository dry-run gate', () => {
        const result = run('alpha', process.cwd(), true);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });

    it('rejects a real working-copy alpha publish', () => {
        const result = run('alpha');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('working-copy publication is disabled');
    });

    it.each(['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'])(
        'reads the invoking %s package rather than the repository root',
        name => {
            // npm runs prepublishOnly with the cwd set to the package directory.
            const directory = path.join(process.cwd(), 'packages', name);

            expect(run('alpha', directory, true).status).toBe(0);
            const refused = run('latest', directory, true);
            expect(refused.status).toBe(1);
            expect(refused.stderr).toContain(`@entitykit/${name}`);
            expect(refused.stderr).toContain('dist-tag \'latest\'');
        },
    );

    it('sends a refused publisher to the release workflow, not to a local script', () => {
        const refused = run('latest', path.join(process.cwd(), 'packages', 'core'));

        expect(refused.stderr).toContain('.github/workflows/release.yml');
        expect(refused.stderr)
            .toContain('Publishing from a working copy is not a supported path.');
        // The guard used to recommend `npm run release:alpha`, which published
        // packages one at a time out of whatever the working copy held.
        // Nothing local publishes any more, so nothing local is recommended.
        expect(refused.stderr).not.toContain('release:alpha');
        expect(refused.stderr).not.toContain('npm publish');
    });

    it('refuses a package whose own publishConfig does not pin alpha', () => {
        const result = run('alpha', packageDirectory({ tag: 'latest' }), true);

        expect(result.status).toBe(1);
        expect(result.stderr)
            .toContain('its publishConfig pins dist-tag \'latest\'');
    });

    it('still demands the alpha tag when a package declares none', () => {
        const directory = packageDirectory(undefined);

        expect(run('alpha', directory, true).status).toBe(0);
        expect(run(undefined, directory, true).status).toBe(1);
    });
});
