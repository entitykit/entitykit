import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('missing pg driver', () => {
    it('names the package and the command to install it', () => {
        // `pg` is an optional peer dependency, so it genuinely may not be there.
        // The bare module-not-found this produced was a stack trace pointing into a
        // hashed file inside `dist`, which tells the reader nothing.
        const source = readFileSync(
            join(process.cwd(), 'src', 'providers', 'postgres', 'postgres-driver.ts'),
            'utf8',
        );

        expect(source).toMatch(/code !== ['"]MODULE_NOT_FOUND['"]/);
        expect(source).toContain('Postgres provider needs');
        expect(source).toContain('optional peer dependency');
        expect(source).toContain('npm install pg');
    });
});
