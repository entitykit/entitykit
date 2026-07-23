import type {
    MigrationError } from '../src/migrations/api';
import {
    postgresMigrationDialect,
} from '../src/migrations/api';
import { containing } from './support/jest-asymmetric-matchers';

describe('Postgres migration lock results', () => {
    it('accepts a confirmed advisory unlock', () => {
        expect(() => postgresMigrationDialect.validateMigrationLockReleased?.({
            rows: [{ pg_advisory_unlock: true }],
            rowCount: 1,
        })).not.toThrow();
    });

    it.each([
        [{ pg_advisory_unlock: false }, false],
        [{}, null],
    ])('rejects an unconfirmed advisory unlock', (row, result) => {
        expect(() => postgresMigrationDialect.validateMigrationLockReleased?.({
            rows: [row],
            rowCount: 1,
        })).toThrow(containing<MigrationError>({
            name: 'MigrationError',
            details: {
                lockPhase: 'lockRelease',
                result,
            },
        }));
    });
});
