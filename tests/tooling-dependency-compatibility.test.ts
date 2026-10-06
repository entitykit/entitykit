import { spawnSync } from 'node:child_process';

describe('development dependency replacements', () => {
    it.each(['globs', 'arguments', 'yaml', 'installer'])('preserves the %s contract', mode => {
        const result = spawnSync(process.execPath, ['tests/fixtures/tooling-compatibility/check.cjs', mode], {
            encoding: 'utf8', timeout: 15_000,
        });
        expect({ status: result.status, error: result.error?.message, stderr: result.stderr })
            .toMatchObject({ status: 0, error: undefined });
        expect(result.stdout).toContain(`TOOLING_CHECK_OK ${mode}`);
    });
});
