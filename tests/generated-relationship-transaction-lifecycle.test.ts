import { EntityState } from '../src';
import type { EntityEntry } from '../src/tracking/entity-entry';
import { temporaryGeneratedIdentity } from '../src/tracking/temporary-generated-identity';
import {
    GeneratedRelationshipTransactionContext,
    TransactionAlternateDependent,
    TransactionAlternatePrincipal,
    TransactionBigIntDependent,
    TransactionBigIntPrincipal,
    TransactionCompositeDependent,
    TransactionCompositePrincipal,
    TransactionConvertedDependent,
    TransactionConvertedPrincipal,
    TransactionNumberDependent,
    TransactionNumberPrincipal,
    TransactionNumberProfile,
} from './support/generated-relationship-transaction-model';
import { internalEntityEntry } from './support/public-api-internals';
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

describe('generated relationship identity across explicit transactions', () => {
    it('updates an existing dependent after its principal was saved', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'existing', principalId: 2,
        });
        db.numberDependents.attach(child);

        await db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
            expect(parent.id).toBe(41);
            expect(tx.entry(parent)?.state).toBe(EntityState.Unchanged);

            child.principal = parent;
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(child.principalId).toBe(41);
        expect(db.entry(child)?.originalValues.principalId).toBe(41);
        const parentEntry = db.entry(parent);
        if (!parentEntry) throw new Error('Expected tracked parent.');
        const internal = internalEntityEntry(parentEntry) as unknown as
            EntityEntry<object>;
        expect(temporaryGeneratedIdentity(internal)).toBeUndefined();
    });

    it('adds an explicit dependent after saving the principal', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'explicit', principal: parent,
        });

        await db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 42 }], rowCount: 1 });
            await tx.saveChanges();
            tx.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(child.principalId).toBe(42);
        expect(child.principal).toBe(parent);
    });

    it('adds an FK-only dependent after saving the principal', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'fk-only', principalId: 43,
        });

        await db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 43 }], rowCount: 1 });
            await tx.saveChanges();
            tx.numberDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(child.principal).toBe(parent);
        expect(child.principalId).toBe(43);
    });

    it('uses a generated BigInt key on the second save', async () => {
        const { db, connection } = context();
        const parent = new TransactionBigIntPrincipal();
        const child = Object.assign(new TransactionBigIntDependent(), {
            id: 'bigint', principalId: 44n,
        });

        await db.transaction(async tx => {
            tx.bigintPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 44n }], rowCount: 1 });
            await tx.saveChanges();
            tx.bigintDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(parent.id).toBe(44n);
        expect(child.principal).toBe(parent);
    });

    it('uses a converted generated key on the second save', async () => {
        const { db, connection } = context();
        const parent = new TransactionConvertedPrincipal();
        const child = Object.assign(new TransactionConvertedDependent(), {
            id: 'converted', principalId: '45',
        });

        await db.transaction(async tx => {
            tx.convertedPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 45 }], rowCount: 1 });
            await tx.saveChanges();
            tx.convertedDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(parent.id).toBe('45');
        expect(child.principal).toBe(parent);
    });

    it('uses a generated composite component on the second save', async () => {
        const { db, connection } = context();
        const parent = Object.assign(new TransactionCompositePrincipal(), {
            region: 'north',
        });
        const child = Object.assign(new TransactionCompositeDependent(), {
            id: 'composite', principalRegion: 'north', principalId: 46,
        });

        await db.transaction(async tx => {
            tx.compositePrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 46 }], rowCount: 1 });
            await tx.saveChanges();
            tx.compositeDependents.add(child);
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(parent.id).toBe(46);
        expect(child.principal).toBe(parent);
    });

    it('uses a generated alternate key on the second save', async () => {
        const { db, connection } = context();
        const parent = Object.assign(new TransactionAlternatePrincipal(), {
            id: 'parent',
        });
        const child = Object.assign(new TransactionAlternateDependent(), {
            id: 'existing', principalCode: 'old-code',
        });
        db.alternateDependents.attach(child);

        await db.transaction(async tx => {
            tx.alternatePrincipals.add(parent);
            connection.queueResult({
                rows: [{ code: 'new-code' }], rowCount: 1,
            });
            await tx.saveChanges();
            child.principal = parent;
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(parent.code).toBe('new-code');
        expect(child.principalCode).toBe('new-code');
    });

    it('reassigns one-to-one after saving the principal', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const profile = Object.assign(new TransactionNumberProfile(), {
            id: 'profile', principalId: 2,
        });
        db.numberProfiles.attach(profile);

        await db.transaction(async tx => {
            tx.numberPrincipals.add(parent);
            connection.queueResult({ rows: [{ id: 47 }], rowCount: 1 });
            await tx.saveChanges();
            profile.principal = parent;
            connection.queueResult({ rowCount: 1 });
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(profile.principalId).toBe(47);
        expect(parent.profile).toBe(profile);
    });
});
