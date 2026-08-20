import {
    EntityState,
    OperationCanceledError,
    ProviderCapabilityError,
} from '../../../packages/core/src';
import { ProviderContractUser } from './model';
import type { ProviderContractTestContext } from './test-context';

export function defineCoreProviderContractTests(context: ProviderContractTestContext): void {
    it('configures provider services and compiles SQL with the provider dialect', () => {
        const { db, runtime } = context;
        expect(contextOptions(db).provider.provider).toBe(runtime.providerName);
        expect(contextOptions(db).dialect).toBe(runtime.providerServices.dialect);
        expect(contextOptions(db).migrationDialect).toBe(runtime.providerServices.migrationDialect);
        expect(db.users.where(user => user.email.eq('a@example.com')).toSql()).toEqual(runtime.expectedSelectStatement);
    });

    it('binds raw SQL parameters through the provider dialect', () => {
        const { db, runtime } = context;
        expect(db.database.rawSql`select ${'a@example.com'} as email, ${42} as answer`).toEqual(runtime.expectedRawSqlStatement);
    });

    it('runs query save and materialization through the provider', async () => {
        const { db, runtime } = context;
        await runtime.beforeSave?.(db);
        db.users.add(new ProviderContractUser({ id: 'usr_contract', email: 'a@example.com' }));

        await expect(db.saveChanges()).resolves.toBe(1);
        db.changeTracker.clear();

        await runtime.beforeRead?.(db);
        const user = await db.users.where(row => row.email.eq('a@example.com')).single();

        expect(user).toBeInstanceOf(ProviderContractUser);
        expect(user.email).toBe('a@example.com');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
        await runtime.afterSaveAndRead?.(db, user);
    });

    it('uses provider transactions for rollback semantics', async () => {
        const { db, runtime } = context;
        await runtime.beforeRollback?.(db);
        await expect(db.transaction(async tx => {
            tx.users.add(new ProviderContractUser({ id: 'usr_rollback', email: 'rollback@example.com' }));
            await tx.saveChanges();
            throw new Error('rollback contract');
        })).rejects.toThrow('rollback contract');

        await runtime.afterRollback?.(db);
    });

    it('uses provider savepoints for nested transaction semantics', async () => {
        const { db, runtime } = context;
        await runtime.beforeNestedTransaction?.(db);
        await db.transaction(async outer => {
            await outer.transaction(async inner => {
                inner.users.add(new ProviderContractUser({ id: 'usr_nested', email: 'nested@example.com' }));
                await inner.saveChanges();
            });
        });

        await runtime.afterNestedTransaction?.(db);
    });

    it('rejects canceled buffered operations without poisoning the context', async () => {
        const { db } = context;
        const controller = new AbortController();
        controller.abort('provider contract buffered cancellation');

        await expect(db.users.toArray({ signal: controller.signal }))
            .rejects.toBeInstanceOf(OperationCanceledError);

        await expect(db.users.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('streams with cancellation and restores the connection lifecycle', async () => {
        const { db, runtime } = context;
        if (!runtime.expectedSupportsStreaming) {
            await expect(collect(db.users.stream()))
                .rejects.toBeInstanceOf(ProviderCapabilityError);
            return;
        }

        db.users.add(new ProviderContractUser({
            id: 'usr_stream_1',
            email: 'stream-one@example.com',
        }));
        db.users.add(new ProviderContractUser({
            id: 'usr_stream_2',
            email: 'stream-two@example.com',
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        const controller = new AbortController();
        const stream = db.users
            .orderBy(user => user.id)
            .asNoTracking()
            .stream({ batchSize: 1, signal: controller.signal });
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        expect(first.done).toBe(false);
        expect(first.value).toMatchObject({ id: 'usr_stream_1' });
        controller.abort('provider contract cancellation');
        await expect(iterator.next()).rejects.toBeInstanceOf(
            OperationCanceledError,
        );

        await expect(db.users.count()).resolves.toBe(2);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('preserves an explicit transaction after stream cancellation', async () => {
        const { db, runtime } = context;
        if (!runtime.expectedSupportsStreaming) {
            return;
        }

        db.users.add(new ProviderContractUser({
            id: 'usr_tx_stream_1',
            email: 'tx-stream-one@example.com',
        }));
        db.users.add(new ProviderContractUser({
            id: 'usr_tx_stream_2',
            email: 'tx-stream-two@example.com',
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        await db.transaction(async transaction => {
            const controller = new AbortController();
            const stream = transaction.users
                .orderBy(user => user.id)
                .asNoTracking()
                .stream({ batchSize: 1, signal: controller.signal });
            const iterator = stream[Symbol.asyncIterator]();
            const first = await iterator.next();
            expect(first.done).toBe(false);
            expect(first.value).toMatchObject({ id: 'usr_tx_stream_1' });
            controller.abort('transaction stream cancellation');
            await expect(iterator.next()).rejects.toBeInstanceOf(
                OperationCanceledError,
            );
            await expect(transaction.users.count()).resolves.toBe(2);
        });
    });

    it('emits provider names through query save and transaction diagnostics', async () => {
        const { db, runtime } = context;
        await db.database.connection.query({ text: 'select 1', values: [] });

        await runtime.beforeDiagnosticsSave?.(db);
        db.users.add(new ProviderContractUser({ id: 'usr_diagnostics', email: 'diagnostics@example.com' }));
        await db.saveChanges();

        await db.transaction(() => undefined);

        const diagnosticKinds = Array.from(new Set(db.diagnosticEvents.map(event => event.kind)));
        expect(diagnosticKinds).toEqual(expect.arrayContaining(['query', 'saveChanges', 'transaction']));
        expect(db.diagnosticEvents.filter(event => event.kind === 'query')).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'query', provider: runtime.providerName })]),
        );
        expect(db.diagnosticEvents.filter(event => event.kind === 'saveChanges')).toEqual([
            expect.objectContaining({ kind: 'saveChanges', provider: runtime.providerName }),
        ]);
        expect(db.diagnosticEvents.filter(event => event.kind === 'transaction')).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'transaction', provider: runtime.providerName, phase: 'begin' }),
                expect.objectContaining({ kind: 'transaction', provider: runtime.providerName, phase: 'commit' }),
            ]),
        );
    });
}

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}
import { contextOptions } from '../public-api-internals';
