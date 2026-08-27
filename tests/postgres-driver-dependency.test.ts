import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as PostgresDriver from '../packages/postgres/src/postgres-driver';

function driverWithPgFailure(error: Error): typeof PostgresDriver {
    jest.resetModules();
    jest.doMock('pg', () => {
        throw error;
    });
    return jest.requireActual<typeof PostgresDriver>(
        '../packages/postgres/src/postgres-driver',
    );
}

describe('missing pg driver', () => {
    afterEach(() => {
        jest.dontMock('pg');
        jest.resetModules();
    });

    it('names the package and the command to install it', () => {
        // A consumer can omit the `pg` peer, so it genuinely may not be there.
        // The bare module-not-found this produced was a stack trace pointing into a
        // hashed file inside `dist`, which tells the reader nothing.
        const source = readFileSync(
            join(process.cwd(), 'packages', 'postgres', 'src', 'postgres-driver.ts'),
            'utf8',
        );

        expect(source).toContain('if (!isMissingModule(error, \'pg\'))');
        expect(source).toContain('Postgres provider needs');
        expect(source).toContain('peer dependency');
        expect(source).toContain('npm install pg');
    });

    it('turns a missing pg peer into installation guidance', () => {
        const missing = Object.assign(new Error('Cannot find module \'pg\''), {
            code: 'MODULE_NOT_FOUND',
        });
        const driver = driverWithPgFailure(missing);

        expect(() => driver.createPostgresPool('postgres://localhost/entitykit'))
            .toThrow('npm install pg');
    });

    it('preserves a missing transitive dependency for accurate diagnosis', () => {
        const nested = Object.assign(
            new Error('Cannot find module \'pg-protocol\''),
            { code: 'MODULE_NOT_FOUND' },
        );
        const driver = driverWithPgFailure(nested);
        let thrown: unknown;

        try {
            driver.createPostgresPool('postgres://localhost/entitykit');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBe(nested);
    });
});
