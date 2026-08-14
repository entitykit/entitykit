import { EntityState } from '../src';
import type { EntityEntry } from '../src/tracking/entity-entry';
import {
    activeTemporaryGeneratedIdentity,
    temporaryGeneratedIdentity,
} from '../src/tracking/temporary-generated-identity';
import {
    GeneratedRelationshipTransactionContext,
    TransactionNumberDependent,
    TransactionNumberPrincipal,
} from './support/generated-relationship-transaction-model';
import {
    internalChangeTracker,
    internalEntityEntry,
    setMetadata,
} from './support/public-api-internals';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

function context(): {
    readonly db: GeneratedRelationshipTransactionContext;
    readonly connection: RecordingDatabaseConnection;
} {
    const connection = new RecordingDatabaseConnection();
    return {
        db: GeneratedRelationshipTransactionContext.create(connection),
        connection,
    };
}

function internal(
    db: GeneratedRelationshipTransactionContext,
    parent: TransactionNumberPrincipal,
): EntityEntry<object> {
    const entry = db.entry(parent);
    if (!entry) throw new Error('Expected tracked parent.');
    return internalEntityEntry(entry) as unknown as
        EntityEntry<object>;
}

describe('generated relationship identity transaction rollback', () => {
    it('reactivates temporary identity after an outer rollback', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'existing', principalId: 2,
        });
        db.numberDependents.attach(child);

        await expect(db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 51 }], rowCount: 1 });
            await tx.saveChanges();
            expect(temporaryGeneratedIdentity(internal(db, parent)))
                .toBeDefined();
            expect(activeTemporaryGeneratedIdentity(internal(db, parent)))
                .toBeUndefined();

            child.principal = parent;
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(parent.id).toBe(0);
        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(child).toMatchObject({ principalId: 2, principal: parent });
        expect(db.entry(child)?.originalValues.principalId).toBe(2);
        expect(activeTemporaryGeneratedIdentity(internal(db, parent)))
            .toBeDefined();
        const tracker = internalChangeTracker(db.changeTracker);
        expect(tracker.tryGetByIdentity(
            setMetadata(db.numberPrincipals), 51,
        )).toBeUndefined();
        expect(tracker.entries().filter(entry => entry.entity === parent))
            .toHaveLength(1);
    });

    it('uses a principal saved inside a committed nested transaction', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'existing', principalId: 2,
        });
        db.numberDependents.attach(child);

        await db.transaction(async outer => {
            await outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 52 }], rowCount: 1 });
                await inner.saveChanges();
            });
            expect(outer.entry(parent)?.state).toBe(EntityState.Unchanged);
            child.principal = parent;
            connection.queueResult({ rowCount: 1 });
            await expect(outer.saveChanges()).resolves.toBe(1);
        });

        expect(parent.id).toBe(52);
        expect(child.principalId).toBe(52);
        expect(temporaryGeneratedIdentity(internal(db, parent)))
            .toBeUndefined();
    });

    it('restores persisted baseline when a nested transaction rolls back', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'existing', principalId: 2,
        });
        db.numberDependents.attach(child);

        await db.transaction(async outer => {
            await expect(outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 53 }], rowCount: 1 });
                await inner.saveChanges();
                child.principal = parent;
                connection.queueResult({ rowCount: 1 });
                await inner.saveChanges();
                throw new Error('abort nested');
            })).rejects.toThrow('abort nested');

            expect(parent.id).toBe(0);
            expect(outer.entry(parent)?.state).toBe(EntityState.Added);
            expect(child).toMatchObject({ principalId: 2, principal: parent });
            expect(outer.entry(child)?.originalValues.principalId).toBe(2);
            expect(activeTemporaryGeneratedIdentity(internal(db, parent)))
                .toBeDefined();
            expect(() => outer.getSavePlan()).toThrow(
                'has not been generated yet',
            );
        });

        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
    });

    it('restores a nested save after the outer transaction rolls back', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'existing', principalId: 2,
        });
        db.numberDependents.attach(child);

        await expect(db.transaction(async outer => {
            await outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 54 }], rowCount: 1 });
                await inner.saveChanges();
            });
            child.principal = parent;
            connection.queueResult({ rowCount: 1 });
            await outer.saveChanges();
            throw new Error('abort root');
        })).rejects.toThrow('abort root');

        expect(parent.id).toBe(0);
        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(child).toMatchObject({ principalId: 2, principal: parent });
        expect(db.entry(child)?.originalValues.principalId).toBe(2);
        expect(activeTemporaryGeneratedIdentity(internal(db, parent)))
            .toBeDefined();
    });

    it('captures an unplanned dependent after a nested commit', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'unplanned-nested-commit',
        });

        await expect(db.transaction(async outer => {
            await outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 55 }], rowCount: 1 });
                await inner.saveChanges();
            });
            child.principalId = parent.id;
            outer.numberDependents.add(child);
            throw new Error('abort unplanned outer');
        })).rejects.toThrow('abort unplanned outer');

        expect(parent.id).toBe(0);
        expect(child).toMatchObject({ principalId: 55, principal: null });
        connection.queueResult({ rows: [{ id: 56 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child).toMatchObject({ principalId: 56, principal: parent });
    });

    it('captures an unplanned dependent during a nested rollback', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'unplanned-nested-rollback',
        });

        await db.transaction(async outer => {
            await expect(outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 57 }], rowCount: 1 });
                await inner.saveChanges();
                child.principalId = parent.id;
                inner.numberDependents.add(child);
                throw new Error('abort unplanned nested');
            })).rejects.toThrow('abort unplanned nested');

            expect(parent.id).toBe(0);
            expect(child).toMatchObject({ principalId: 57, principal: null });
            connection.queueResult({ rows: [{ id: 58 }], rowCount: 1 });
            connection.queueResult({ rowCount: 1 });
            await expect(outer.saveChanges()).resolves.toBe(2);
        });

        expect(child).toMatchObject({ principalId: 58, principal: parent });
    });
});
