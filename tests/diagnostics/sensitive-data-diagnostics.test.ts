import {
    type RuntimeDiagnosticEvent,
} from '../../packages/core/src';
import { DbContextOptionsBuilder } from '../../packages/core/src/core/context-options/db-context-options-builder';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import {
    DiagnosticsContext,
    resetDiagnosticsContext,
    User,
} from './diagnostics-test-support';

describe('sensitive diagnostic data', () => {
    it('requires an explicit boolean before exposing sensitive data', () => {
        expect(() => new DbContextOptionsBuilder()
            .useConnection(new RecordingDatabaseConnection())
            .useDiagnostics(
                () => undefined,
                { includeSensitiveData: 'false' as never },
            ))
            .toThrow('includeSensitiveData must be a boolean');
    });

    it('redacts values and errors by default', async () => {
        const events: RuntimeDiagnosticEvent[] = [];
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('query failed'));
        const options = new DbContextOptionsBuilder()
            .useConnection(connection)
            .useDiagnostics(event => {
                events.push(event);
            })
            .build();

        await expect(options.connection.query({
            text: 'select * from users where token = $1',
            values: ['secret-token'],
        })).rejects.toThrow('query failed');

        expect(events).toEqual([expect.objectContaining({
            kind: 'query',
            statement: {
                text: 'select * from users where token = $1',
                values: ['[REDACTED]'],
            },
            error: { name: 'Error', message: 'Error details redacted.' },
        })]);
        expect(JSON.stringify(events)).not.toContain('secret-token');
    });

    it('keeps original values and errors only after explicit opt-in', async () => {
        const events: RuntimeDiagnosticEvent[] = [];
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('query failed');
        connection.queueError(failure);
        const options = new DbContextOptionsBuilder()
            .useConnection(connection)
            .useDiagnostics(
                event => {
                    events.push(event);
                },
                { includeSensitiveData: true },
            )
            .build();

        await expect(options.connection.query({
            text: 'select $1',
            values: ['secret-token'],
        })).rejects.toBe(failure);

        expect(events[0]).toEqual(expect.objectContaining({
            statement: { text: 'select $1', values: ['secret-token'] },
            error: failure,
        }));
    });

    it('detaches asynchronous diagnostic failures from database work', async () => {
        const connection = new RecordingDatabaseConnection();
        let observerFinished = false;
        connection.queueResult({ rows: [{ value: 1 }] });
        const options = new DbContextOptionsBuilder()
            .useConnection(connection)
            .useDiagnostics(async () => {
                await Promise.resolve();
                observerFinished = true;
                throw new Error('async diagnostic failed');
            })
            .build();

        await expect(options.connection.query({
            text: 'select 1 as value',
            values: [],
        })).resolves.toMatchObject({ rows: [{ value: 1 }] });
        await new Promise<void>(resolve => setImmediate(resolve));

        expect(observerFinished).toBe(true);
    });

    it('removes tracked entities, keys, and statement values from save plans', async () => {
        resetDiagnosticsContext();
        DiagnosticsContext.includeSensitiveData = false;
        const db = DiagnosticsContext.create();
        const user = new User();
        user.id = 'secret-user-id';
        db.users.add(user);
        DiagnosticsContext.connection.queueResult({ rowCount: 1 });

        await db.saveChanges();

        const saveEvent = DiagnosticsContext.events.find(event => event.kind === 'saveChanges');
        expect(saveEvent?.kind).toBe('saveChanges');
        if (saveEvent?.kind === 'saveChanges') {
            expect(saveEvent.plan[0]).toEqual(expect.objectContaining({
                entityName: 'User',
            }));
            expect(saveEvent.plan[0]?.statement.values).toEqual(['[REDACTED]']);
            expect(saveEvent.plan[0]?.entity).toBeUndefined();
            expect(saveEvent.plan[0]?.keyValue).toBeUndefined();
        }
        expect(JSON.stringify(saveEvent)).not.toContain('secret-user-id');
    });
});
