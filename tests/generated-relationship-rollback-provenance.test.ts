import { EntityState } from '../src';
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
    TransactionOptionalNumberDependent,
} from './support/generated-relationship-transaction-model';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

interface RetryCase {
    readonly db: GeneratedRelationshipTransactionContext;
    readonly connection: RecordingDatabaseConnection;
    readonly parent: object;
    readonly child: object;
    readonly addParent: () => void;
    readonly addChild: () => void;
    readonly assignRolledBackForeignKey: () => void;
    readonly rolledBackResult: Record<string, unknown>;
    readonly retriedResult: Record<string, unknown>;
    readonly assertRolledBack: () => void;
    readonly assertRetried: () => void;
}

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

async function expectRetryRetargets(testCase: RetryCase): Promise<void> {
    const {
        db, connection, parent, child, addParent, addChild,
        assignRolledBackForeignKey, rolledBackResult, retriedResult,
        assertRolledBack, assertRetried,
    } = testCase;
    await expect(db.transaction(async tx => {
        addParent();
        connection.queueResult({ rows: [rolledBackResult], rowCount: 1 });
        await tx.saveChanges();
        assignRolledBackForeignKey();
        addChild();
        connection.queueResult({ rowCount: 1 });
        await tx.saveChanges();
        throw new Error('abort generated relationship');
    })).rejects.toThrow('abort generated relationship');

    expect(db.entry(parent)?.state).toBe(EntityState.Added);
    expect(db.entry(child)?.state).toBe(EntityState.Added);
    assertRolledBack();

    connection.queueResult({ rows: [retriedResult], rowCount: 1 });
    connection.queueResult({ rowCount: 1 });
    await expect(db.saveChanges()).resolves.toBe(2);

    assertRetried();
    expect(db.entry(parent)?.state).toBe(EntityState.Unchanged);
    expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
}

describe('generated relationship target provenance after rollback', () => {
    it('retargets a generated numeric primary key', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'number',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.numberPrincipals.add(parent),
            addChild: () => db.numberDependents.add(child),
            assignRolledBackForeignKey: () => {
                child.principalId = parent.id;
            },
            rolledBackResult: { id: 61 }, retriedResult: { id: 62 },
            assertRolledBack: () => {
                expect(child).toMatchObject({
                    principalId: 61, principal: null,
                });
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalId: 62, principal: parent,
                });
            },
        });
    });

    it('retargets a generated bigint primary key', async () => {
        const { db, connection } = context();
        const parent = new TransactionBigIntPrincipal();
        const child = Object.assign(new TransactionBigIntDependent(), {
            id: 'bigint',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.bigintPrincipals.add(parent),
            addChild: () => db.bigintDependents.add(child),
            assignRolledBackForeignKey: () => {
                child.principalId = parent.id;
            },
            rolledBackResult: { id: 63n }, retriedResult: { id: 64n },
            assertRolledBack: () => {
                expect(child.principalId).toBe(63n);
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalId: 64n, principal: parent,
                });
            },
        });
    });

    it('retargets a converter-backed generated primary key', async () => {
        const { db, connection } = context();
        const parent = new TransactionConvertedPrincipal();
        const child = Object.assign(new TransactionConvertedDependent(), {
            id: 'converted',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.convertedPrincipals.add(parent),
            addChild: () => db.convertedDependents.add(child),
            assignRolledBackForeignKey: () => {
                child.principalId = parent.id;
            },
            rolledBackResult: { id: 65 }, retriedResult: { id: 66 },
            assertRolledBack: () => {
                expect(child.principalId).toBe('65');
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalId: '66', principal: parent,
                });
            },
        });
    });

    it('retargets a generated composite key component', async () => {
        const { db, connection } = context();
        const parent = Object.assign(new TransactionCompositePrincipal(), {
            region: 'north',
        });
        const child = Object.assign(new TransactionCompositeDependent(), {
            id: 'composite', principalRegion: 'north',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.compositePrincipals.add(parent),
            addChild: () => db.compositeDependents.add(child),
            assignRolledBackForeignKey: () => {
                child.principalId = parent.id;
            },
            rolledBackResult: { id: 67 }, retriedResult: { id: 68 },
            assertRolledBack: () => {
                expect(child.principalId).toBe(67);
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalRegion: 'north', principalId: 68, principal: parent,
                });
            },
        });
    });

    it('retargets a generated alternate key', async () => {
        const { db, connection } = context();
        const parent = Object.assign(new TransactionAlternatePrincipal(), {
            id: 'alternate-parent',
        });
        const child = Object.assign(new TransactionAlternateDependent(), {
            id: 'alternate-child',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.alternatePrincipals.add(parent),
            addChild: () => db.alternateDependents.add(child),
            assignRolledBackForeignKey: () => {
                child.principalCode = parent.code;
            },
            rolledBackResult: { code: 'old-code' },
            retriedResult: { code: 'new-code' },
            assertRolledBack: () => {
                expect(child.principalCode).toBe('old-code');
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalCode: 'new-code', principal: parent,
                });
            },
        });
    });

    it('retargets an optional generated relationship', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionOptionalNumberDependent(), {
            id: 'optional',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.numberPrincipals.add(parent),
            addChild: () => db.optionalNumberDependents.add(child),
            assignRolledBackForeignKey: () => {
                child.principalId = parent.id;
            },
            rolledBackResult: { id: 69 }, retriedResult: { id: 70 },
            assertRolledBack: () => {
                expect(child.principalId).toBe(69);
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalId: 70, principal: parent,
                });
            },
        });
    });

    it('retargets a generated one-to-one relationship', async () => {
        const { db, connection } = context();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberProfile(), {
            id: 'profile',
        });
        await expectRetryRetargets({
            db, connection, parent, child,
            addParent: () => db.numberPrincipals.add(parent),
            addChild: () => db.numberProfiles.add(child),
            assignRolledBackForeignKey: () => {
                child.principalId = parent.id;
            },
            rolledBackResult: { id: 71 }, retriedResult: { id: 72 },
            assertRolledBack: () => {
                expect(child.principalId).toBe(71);
            },
            assertRetried: () => {
                expect(child).toMatchObject({
                    principalId: 72, principal: parent,
                });
            },
        });
    });
});
