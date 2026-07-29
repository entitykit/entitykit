import type {
    DbContextOptionsBuilder,
} from '../src';
import {
    DbContext,
} from '../src';
import { RecordingDatabaseConnection } from '../src/testing';

let connection: RecordingDatabaseConnection;

class ConcurrencyContext extends DbContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(connection);
    }
}

function deferred(): { promise: Promise<void>; resolve: () => void; } {
    let resolve!: () => void;
    const promise: Promise<void> = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('DbContext operation concurrency', () => {
    beforeEach(() => {
        connection = new RecordingDatabaseConnection();
    });

    it('rejects an overlapping root transaction', async () => {
        const db =  ConcurrencyContext.create();
        const entered = deferred();
        const release = deferred();
        const first = db.transaction(async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;

        await expect(db.transaction(() => undefined))
            .rejects.toThrow('already in progress on this DbContext');

        release.resolve();
        await first;
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('does not silently enlist an outside query in an open transaction', async () => {
        const db =  ConcurrencyContext.create();
        const entered = deferred();
        const release = deferred();
        const transaction = db.transaction(async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;

        await expect(db.database.connection.query({
            text: 'select outside',
            values: [],
        })).rejects.toThrow('already in progress on this DbContext');

        release.resolve();
        await transaction;
        expect(connection.statements).toEqual([]);
    });

    it('allows nested work in the owning transaction chain', async () => {
        const db =  ConcurrencyContext.create();
        connection.queueResult({ rows: [{ value: 1 }], rowCount: 1 });

        await db.transaction(async () => {
            await db.transaction(async () => {
                await db.database.connection.query({ text: 'select nested', values: [] });
            });
        });

        expect(connection.statements).toEqual([
            { text: 'select nested', values: [] },
        ]);
    });
});
