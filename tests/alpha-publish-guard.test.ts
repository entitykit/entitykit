import { spawnSync } from 'node:child_process';
import path from 'node:path';

const guard = path.join(process.cwd(), 'scripts', 'guard-alpha-publish.js');

function run(tag?: string): ReturnType<typeof spawnSync> {
    const env = { ...process.env };
    if (tag === undefined) delete env.npm_config_tag;
    else env.npm_config_tag = tag;
    return spawnSync(process.execPath, [guard], {
        cwd: process.cwd(), encoding: 'utf8', env,
    });
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
});
