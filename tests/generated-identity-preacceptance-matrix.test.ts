import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    SqlStatement,
} from '../packages/core/src';
import { OperationCanceledError } from '../packages/core/src';
import {
    GeneratedRelationshipTransactionContext,
    TransactionBigIntDependent,
    TransactionBigIntPrincipal,
    TransactionCompositeDependent,
    TransactionCompositePrincipal,
    TransactionConvertedDependent,
    TransactionConvertedPrincipal,
    TransactionNumberDependent,
    TransactionNumberPrincipal,
} from './support/generated-relationship-transaction-model';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class GeneratedObservationConnection extends RecordingDatabaseConnection {
    private queryCount = 0;
    constructor(private readonly observeFirstResult: () => void) {
        super();
    }
    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        const result = await super.query<TRow>(statement, options);
        this.queryCount += 1;
        if (this.queryCount === 1) this.observeFirstResult();
        return result;
    }
}

interface PreAcceptanceCase {
    readonly name: string;
    readonly parent: object;
    readonly child: object;
    readonly firstResult: Record<string, unknown>;
    readonly retryResult: Record<string, unknown>;
    readonly observe: () => void;
    readonly add: (db: GeneratedRelationshipTransactionContext) => void;
    readonly assertRolledBack: () => void;
    readonly assertRetried: () => void;
}

function cases(): readonly PreAcceptanceCase[] {
    const numberParent = new TransactionNumberPrincipal();
    const numberChild = Object.assign(new TransactionNumberDependent(), {
        id: 'number-matrix', principal: numberParent,
    });
    const bigintParent = new TransactionBigIntPrincipal();
    const bigintChild = Object.assign(new TransactionBigIntDependent(), {
        id: 'bigint-matrix', principal: bigintParent,
    });
    const convertedParent = new TransactionConvertedPrincipal();
    const convertedChild = Object.assign(new TransactionConvertedDependent(), {
        id: 'converted-matrix', principal: convertedParent,
    });
    const compositeParent = Object.assign(
        new TransactionCompositePrincipal(), { region: 'north' },
    );
    const compositeChild = Object.assign(
        new TransactionCompositeDependent(), {
            id: 'composite-matrix', principalRegion: 'north',
            principal: compositeParent,
        },
    );
    return [
        {
            name: 'numeric primary key',
            parent: numberParent, child: numberChild,
            firstResult: { id: 31 }, retryResult: { id: 32 },
            observe: () => {
                numberChild.principalId = 31;
            },
            add: db => {
                db.numberPrincipals.add(numberParent);
                db.numberDependents.add(numberChild);
            },
            assertRolledBack: () => {
                expect(numberChild.principalId).toBe(31);
            },
            assertRetried: () => {
                expect(numberChild).toMatchObject({
                    principalId: 32, principal: numberParent,
                });
            },
        },
        {
            name: 'BigInt primary key',
            parent: bigintParent, child: bigintChild,
            firstResult: { id: 33n }, retryResult: { id: 34n },
            observe: () => {
                bigintChild.principalId = 33n;
            },
            add: db => {
                db.bigintPrincipals.add(bigintParent);
                db.bigintDependents.add(bigintChild);
            },
            assertRolledBack: () => {
                expect(bigintChild.principalId).toBe(33n);
            },
            assertRetried: () => {
                expect(bigintChild).toMatchObject({
                    principalId: 34n, principal: bigintParent,
                });
            },
        },
        {
            name: 'converted primary key',
            parent: convertedParent, child: convertedChild,
            firstResult: { id: 35 }, retryResult: { id: 36 },
            observe: () => {
                convertedChild.principalId = '35';
            },
            add: db => {
                db.convertedPrincipals.add(convertedParent);
                db.convertedDependents.add(convertedChild);
            },
            assertRolledBack: () => {
                expect(convertedChild.principalId).toBe('35');
            },
            assertRetried: () => {
                expect(convertedChild).toMatchObject({
                    principalId: '36', principal: convertedParent,
                });
            },
        },
        {
            name: 'composite generated key',
            parent: compositeParent, child: compositeChild,
            firstResult: { id: 37 }, retryResult: { id: 38 },
            observe: () => {
                compositeChild.principalId = 37;
            },
            add: db => {
                db.compositePrincipals.add(compositeParent);
                db.compositeDependents.add(compositeChild);
            },
            assertRolledBack: () => {
                expect(compositeChild.principalId).toBe(37);
            },
            assertRetried: () => {
                expect(compositeChild).toMatchObject({
                    principalRegion: 'north', principalId: 38,
                    principal: compositeParent,
                });
            },
        },
    ];
}

async function expectPreAcceptanceRetry(
    testCase: PreAcceptanceCase,
): Promise<void> {
    const connection = new GeneratedObservationConnection(testCase.observe);
    const db = GeneratedRelationshipTransactionContext.create(connection);
    testCase.add(db);
    connection.queueResult({ rows: [testCase.firstResult], rowCount: 1 });
    connection.queueError(new Error('later unique constraint failed'));

    await expect(db.saveChanges()).rejects.toThrow(
        'later unique constraint failed',
    );
    testCase.assertRolledBack();
    connection.queueResult({ rows: [testCase.retryResult], rowCount: 1 });
    connection.queueResult({ rowCount: 1 });

    await expect(db.saveChanges()).resolves.toBe(2);
    testCase.assertRetried();
}

describe('generated identity pre-acceptance matrix', () => {
    it.each(cases())('retargets a $name', expectPreAcceptanceRetry);

    it.each([
        ['foreign-key failure', new Error('foreign key failed'), undefined],
        ['concurrency failure', undefined, { rowCount: 0 }],
        ['cancellation', new OperationCanceledError('cancel save'), undefined],
    ] as const)('captures before %s', async (_name, error, result) => {
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: `failure-${_name}`, principal: parent,
        });
        const connection = new GeneratedObservationConnection(() => {
            child.principalId = 41;
        });
        const db = GeneratedRelationshipTransactionContext.create(connection);
        db.numberPrincipals.add(parent);
        db.numberDependents.add(child);
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        if (error) connection.queueError(error);
        else connection.queueResult(result);

        await expect(db.saveChanges()).rejects.toThrow();
        expect(child.principalId).toBe(41);
        connection.queueResult({ rows: [{ id: 42 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child).toMatchObject({ principalId: 42, principal: parent });
    });
});
