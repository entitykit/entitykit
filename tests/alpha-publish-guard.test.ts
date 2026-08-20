import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const guard = path.join(process.cwd(), 'scripts', 'guard-alpha-publish.js');

function run(tag?: string, cwd = process.cwd()): ReturnType<typeof spawnSync> {
    const env = { ...process.env };
    if (tag === undefined) delete env.npm_config_tag;
    else env.npm_config_tag = tag;
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
            const result = run(tag);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('Refusing prerelease publication');
        },
    );

    it('accepts only the alpha tag', () => {
        const result = run('alpha');
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });

    it.each(['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing'])(
        'reads the invoking %s package rather than the repository root',
        name => {
            // npm runs prepublishOnly with the cwd set to the package directory.
            const directory = path.join(process.cwd(), 'packages', name);

            expect(run('alpha', directory).status).toBe(0);
            const refused = run('latest', directory);
            expect(refused.status).toBe(1);
            expect(refused.stderr).toContain(`@entitykit/${name}`);
            expect(refused.stderr).toContain('dist-tag \'latest\'');
        },
    );

    it('refuses a package whose own publishConfig does not pin alpha', () => {
        const result = run('alpha', packageDirectory({ tag: 'latest' }));

        expect(result.status).toBe(1);
        expect(result.stderr)
            .toContain('its publishConfig pins dist-tag \'latest\'');
    });

    it('still demands the alpha tag when a package declares none', () => {
        const directory = packageDirectory(undefined);

        expect(run('alpha', directory).status).toBe(0);
        expect(run(undefined, directory).status).toBe(1);
    });
});
