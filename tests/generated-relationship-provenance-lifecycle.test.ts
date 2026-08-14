import { EntityState } from '../src';
import type { EntityEntry } from '../src/tracking/entity-entry';
import { rolledBackGeneratedRelationshipTarget } from '../src/tracking/generated-relationship-target-provenance';
import type { TrackedRelationshipMetadata } from '../src/tracking/tracked-relationship-metadata';
import {
    GeneratedRelationshipTransactionContext,
    TransactionNumberDependent,
    TransactionNumberPrincipal,
} from './support/generated-relationship-transaction-model';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    internalChangeTracker,
    internalEntityEntry,
} from './support/public-api-internals';

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

function graph(id: string): {
    readonly parent: TransactionNumberPrincipal;
    readonly child: TransactionNumberDependent;
} {
    return {
        parent: new TransactionNumberPrincipal(),
        child: Object.assign(new TransactionNumberDependent(), { id }),
    };
}

function queueGraph(
    connection: RecordingDatabaseConnection,
    generatedId: number,
): void {
    connection.queueResult({ rows: [{ id: generatedId }], rowCount: 1 });
    connection.queueResult({ rowCount: 1 });
}

describe('generated relationship provenance transaction lifecycle', () => {
    it('survives a nested principal commit and outer rollback', async () => {
        const { db, connection } = context();
        const { parent, child } = graph('nested-commit');

        await expect(db.transaction(async outer => {
            await outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 81 }], rowCount: 1 });
                await inner.saveChanges();
            });
            child.principalId = parent.id;
            outer.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await outer.saveChanges();
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(parent.id).toBe(0);
        expect(child).toMatchObject({ principalId: 81, principal: null });
        queueGraph(connection, 82);
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child).toMatchObject({ principalId: 82, principal: parent });
    });

    it('retries inside the outer scope after a nested rollback', async () => {
        const { db, connection } = context();
        const { parent, child } = graph('nested-rollback');

        await db.transaction(async outer => {
            await expect(outer.transaction(async inner => {
                inner.numberPrincipals.add(parent);
                connection.queueResult({ rows: [{ id: 83 }], rowCount: 1 });
                await inner.saveChanges();
                child.principalId = parent.id;
                inner.numberDependents.add(child);
                connection.queueResult({ rowCount: 1 });
                await inner.saveChanges();
                throw new Error('abort nested');
            })).rejects.toThrow('abort nested');

            expect(parent.id).toBe(0);
            expect(child).toMatchObject({ principalId: 83, principal: null });
            queueGraph(connection, 84);
            await expect(outer.saveChanges()).resolves.toBe(2);
        });

        expect(child).toMatchObject({ principalId: 84, principal: parent });
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
    });

    it('survives repeated outer rollbacks before committing', async () => {
        const { db, connection } = context();
        const { parent, child } = graph('repeated');

        await expect(db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 85 }], rowCount: 1 });
            await tx.saveChanges();
            child.principalId = parent.id;
            tx.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort first');
        })).rejects.toThrow('abort first');

        await expect(db.transaction(async tx => {
            queueGraph(connection, 86);
            await tx.saveChanges();
            expect(child.principalId).toBe(86);
            throw new Error('abort second');
        })).rejects.toThrow('abort second');

        expect(parent.id).toBe(0);
        expect(child).toMatchObject({ principalId: 0, principal: null });
        queueGraph(connection, 87);
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child).toMatchObject({ principalId: 87, principal: parent });
    });

    it('fails closed for an existing dependent after rollback', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'existing', principalId: 2,
        });
        db.numberDependents.attach(child);

        await expect(db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 88 }], rowCount: 1 });
            await tx.saveChanges();
            child.principalId = parent.id;
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort existing');
        })).rejects.toThrow('abort existing');

        const statements = connection.statements.length;
        expect(parent.id).toBe(0);
        expect(child).toMatchObject({ principalId: 88, principal: null });
        expect(() => db.getSavePlan()).toThrow('has not been generated yet');
        expect(connection.statements).toHaveLength(statements);
    });

    it('rejects a stale generated FK after its principal is detached', async () => {
        const { db, connection } = context();
        const { parent, child } = graph('detached-principal');

        await expect(db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 91 }], rowCount: 1 });
            await tx.saveChanges();
            child.principalId = parent.id;
            tx.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort detached');
        })).rejects.toThrow('abort detached');

        db.numberPrincipals.detach(parent);
        const statements = connection.statements.length;
        expect(() => db.getSavePlan()).toThrow(
            'retains a rolled-back store-generated FK',
        );
        expect(connection.statements).toHaveLength(statements);
    });

    it('keeps explicit-navigation rollback and retry behavior', async () => {
        const { db, connection } = context();
        const { parent, child } = graph('explicit-navigation');
        child.principal = parent;

        await expect(db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 89 }], rowCount: 1 });
            await tx.saveChanges();
            tx.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort explicit');
        })).rejects.toThrow('abort explicit');

        expect(parent.id).toBe(0);
        expect(child.principal).toBe(parent);
        queueGraph(connection, 90);
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child).toMatchObject({ principalId: 90, principal: parent });
    });

    it('lets an explicit competing navigation override provenance', async () => {
        const { db, connection } = context();
        const { parent, child } = graph('competing-navigation');

        await expect(db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 92 }], rowCount: 1 });
            await tx.saveChanges();
            child.principalId = parent.id;
            tx.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort competing');
        })).rejects.toThrow('abort competing');

        const other = Object.assign(new TransactionNumberPrincipal(), {
            id: 100,
        });
        db.numberPrincipals.attach(other);
        child.principal = other;
        const publicEntry = db.entry(child);
        if (!publicEntry) throw new Error('Expected tracked child.');
        const entry = internalEntityEntry(publicEntry) as unknown as
            EntityEntry<object>;
        const relationship = entry.metadata.relationships[0] as
            TrackedRelationshipMetadata;
        expect(rolledBackGeneratedRelationshipTarget(
            internalChangeTracker(db.changeTracker),
            entry,
            relationship,
            { principalId: 92 },
        )).toBeUndefined();

        const childPlan = db.getSavePlan().find(item => item.entity === child);
        expect(childPlan?.statement.values).toContain(100);
    });
});
