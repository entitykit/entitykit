import {
    TransactionAlternateDependent,
    TransactionAlternatePrincipal,
    TransactionBigIntDependent,
    TransactionBigIntPrincipal,
    TransactionConvertedDependent,
    TransactionConvertedPrincipal,
    TransactionNumberDependent,
    TransactionNumberPrincipal,
    TransactionOptionalNumberDependent,
} from './support/generated-relationship-transaction-model';
import {
    establishGeneratedRelationshipProvenance,
    generatedRelationshipContext,
    retryGeneratedRelationship,
} from './support/generated-relationship-provenance-test-support';

describe('generated relationship rollback caller intent', () => {
    it('rejects an ambiguous numeric zero before SQL', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'number-zero',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.numberPrincipals.add(parent),
            addDependent: () => db.numberDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 111 },
        });
        child.principalId = 0;
        const statements = connection.statements.length;
        await expect(db.saveChanges()).rejects.toThrow(
            'unresolved store-generated FK value',
        );
        expect(connection.statements).toHaveLength(statements);
        expect(child).toMatchObject({ principalId: 0, principal: null });
    });

    it('rejects an ambiguous bigint zero before SQL', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = new TransactionBigIntPrincipal();
        const child = Object.assign(new TransactionBigIntDependent(), {
            id: 'bigint-zero',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.bigintPrincipals.add(parent),
            addDependent: () => db.bigintDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 112n },
        });
        child.principalId = 0n;
        const statements = connection.statements.length;
        await expect(db.saveChanges()).rejects.toThrow(
            'unresolved store-generated FK value',
        );
        expect(connection.statements).toHaveLength(statements);
        expect(child).toMatchObject({ principalId: 0n, principal: null });
    });

    it('respects an empty alternate key assigned after rollback', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = Object.assign(new TransactionAlternatePrincipal(), {
            id: 'alternate-parent-override',
        });
        const child = Object.assign(new TransactionAlternateDependent(), {
            id: 'alternate-child-override',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.alternatePrincipals.add(parent),
            addDependent: () => db.alternateDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalCode = parent.code;
            },
            generatedRow: { code: 'rolled-back-code' },
        });
        child.principalCode = '';
        await retryGeneratedRelationship(db, connection, {
            code: 'new-code',
        });
        expect(child).toMatchObject({ principalCode: '', principal: null });
    });

    it('respects another stable generated-key value', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = new TransactionNumberPrincipal();
        const stable = Object.assign(new TransactionNumberPrincipal(), {
            id: 77,
        });
        const child = Object.assign(new TransactionNumberDependent(), {
            id: 'stable-scalar',
        });
        db.numberPrincipals.attach(stable);
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.numberPrincipals.add(parent),
            addDependent: () => db.numberDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 113 },
        });
        child.principalId = 77;
        await retryGeneratedRelationship(db, connection, { id: 123 });
        expect(child).toMatchObject({ principalId: 77, principal: stable });
    });

    it('respects null assigned to an optional FK', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = new TransactionNumberPrincipal();
        const child = Object.assign(new TransactionOptionalNumberDependent(), {
            id: 'optional-null',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.numberPrincipals.add(parent),
            addDependent: () => db.optionalNumberDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 114 },
        });
        child.principalId = null;
        await retryGeneratedRelationship(db, connection, { id: 124 });
        expect(child).toMatchObject({ principalId: null, principal: null });
    });

    it('rejects an ambiguous converted strong ID before SQL', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = new TransactionConvertedPrincipal();
        const child = Object.assign(new TransactionConvertedDependent(), {
            id: 'converted-zero',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.convertedPrincipals.add(parent),
            addDependent: () => db.convertedDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 115 },
        });
        child.principalId = '0';
        const statements = connection.statements.length;
        await expect(db.saveChanges()).rejects.toThrow(
            'unresolved store-generated FK value',
        );
        expect(connection.statements).toHaveLength(statements);
        expect(child).toMatchObject({ principalId: '0', principal: null });
    });
});
