import {
    TransactionAlternateDependent,
    TransactionAlternatePrincipal,
    TransactionCompositeDependent,
    TransactionCompositePrincipal,
    TransactionNullDependent,
    TransactionNullPrincipal,
    TransactionOptionalUndefinedDependent,
    TransactionUndefinedDependent,
    TransactionUndefinedPrincipal,
} from './support/generated-relationship-transaction-model';
import type { GeneratedRelationshipTransactionContext } from './support/generated-relationship-transaction-model';
import type { TrackedRelationshipMetadata } from '../src/tracking/tracked-relationship-metadata';
import { generatedRelationshipTarget } from '../src/tracking/generated-relationship-target-store';
import { internalEntityEntry } from './support/public-api-internals';
import {
    establishGeneratedRelationshipProvenance,
    generatedRelationshipContext,
    retryGeneratedRelationship,
} from './support/generated-relationship-provenance-test-support';

function provenanceFor(
    db: GeneratedRelationshipTransactionContext,
    dependent: object,
): ReturnType<typeof generatedRelationshipTarget> {
    const publicEntry = db.entry(dependent);
    if (!publicEntry) throw new Error('Expected tracked dependent.');
    const entry = internalEntityEntry(publicEntry);
    const relationship = entry.metadata.relationships[0] as
        TrackedRelationshipMetadata;
    return generatedRelationshipTarget(entry, relationship);
}

describe('generated relationship rollback ownership', () => {
    it.each([
        ['required', false],
        ['optional', true],
    ] as const)(
        'preserves an undefined %s FK through two rollbacks',
        async (_name, optional) => {
            const { db, connection } = generatedRelationshipContext();
            const parent = new TransactionUndefinedPrincipal();
            const child = optional
                ? Object.assign(new TransactionOptionalUndefinedDependent(), {
                    id: 'optional-undefined',
                })
                : Object.assign(new TransactionUndefinedDependent(), {
                    id: 'required-undefined',
                });
            await establishGeneratedRelationshipProvenance({
                db, connection,
                addPrincipal: () => db.undefinedPrincipals.add(parent),
                addDependent: () => optional
                    ? db.optionalUndefinedDependents.add(
                        child,
                    )
                    : db.undefinedDependents.add(
                        child as TransactionUndefinedDependent,
                    ),
                assignGeneratedForeignKey: () => {
                    child.principalId = parent.id;
                },
                generatedRow: { id: 101 },
            });

            await expect(db.transaction(async tx => {
                connection.queueResult({ rows: [{ id: 102 }], rowCount: 1 });
                connection.queueResult({ rowCount: 1 });
                await tx.saveChanges();
                expect(child.principalId).toBe(102);
                throw new Error('abort second attempt');
            })).rejects.toThrow('abort second attempt');

            expect(parent.id).toBeUndefined();
            expect(child.principalId).toBeUndefined();
            expect(provenanceFor(db, child)).toMatchObject({
                kind: 'active',
                currentExpectedProviderValues: [undefined],
                currentValueIsFrameworkOwned: true,
            });
            connection.queueResult({ rows: [{ id: 103 }], rowCount: 1 });
            connection.queueResult({ rowCount: 1 });
            await expect(db.saveChanges()).resolves.toBe(2);
            expect(child).toMatchObject({
                principalId: 103, principal: parent,
            });
        },
    );

    it('preserves a null optional FK through two rollbacks', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = new TransactionNullPrincipal();
        const child = Object.assign(new TransactionNullDependent(), {
            id: 'optional-null-placeholder',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.nullPrincipals.add(parent),
            addDependent: () => db.nullDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 104 },
        });
        await expect(db.transaction(async tx => {
            connection.queueResult({ rows: [{ id: 105 }], rowCount: 1 });
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort null retry');
        })).rejects.toThrow('abort null retry');

        expect(parent.id).toBeNull();
        expect(child.principalId).toBeNull();
        expect(provenanceFor(db, child)).toMatchObject({
            kind: 'active',
            currentExpectedProviderValues: [null],
            currentValueIsFrameworkOwned: true,
        });
        await retryGeneratedRelationship(db, connection, { id: 106 });
        expect(child).toMatchObject({ principalId: 106, principal: parent });
    });

    it('preserves an undefined composite component through two rollbacks', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = Object.assign(new TransactionCompositePrincipal(), {
            region: 'north',
        });
        const child = Object.assign(new TransactionCompositeDependent(), {
            id: 'undefined-composite', principalRegion: 'north',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.compositePrincipals.add(parent),
            addDependent: () => db.compositeDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalId = parent.id;
            },
            generatedRow: { id: 107 },
        });
        await expect(db.transaction(async tx => {
            connection.queueResult({ rows: [{ id: 108 }], rowCount: 1 });
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort composite retry');
        })).rejects.toThrow('abort composite retry');

        expect(child).toMatchObject({ principalRegion: 'north' });
        expect(child.principalId).toBeUndefined();
        await retryGeneratedRelationship(db, connection, { id: 109 });
        expect(child).toMatchObject({
            principalRegion: 'north', principalId: 109, principal: parent,
        });
    });

    it('preserves an undefined alternate key through two rollbacks', async () => {
        const { db, connection } = generatedRelationshipContext();
        const parent = Object.assign(new TransactionAlternatePrincipal(), {
            id: 'undefined-alternate-parent',
        });
        const child = Object.assign(new TransactionAlternateDependent(), {
            id: 'undefined-alternate-child',
        });
        await establishGeneratedRelationshipProvenance({
            db, connection,
            addPrincipal: () => db.alternatePrincipals.add(parent),
            addDependent: () => db.alternateDependents.add(child),
            assignGeneratedForeignKey: () => {
                child.principalCode = parent.code;
            },
            generatedRow: { code: 'first-code' },
        });
        await expect(db.transaction(async tx => {
            connection.queueResult({
                rows: [{ code: 'second-code' }], rowCount: 1,
            });
            connection.queueResult({ rowCount: 1 });
            await tx.saveChanges();
            throw new Error('abort alternate retry');
        })).rejects.toThrow('abort alternate retry');

        expect(parent.code).toBeUndefined();
        expect(child.principalCode).toBeUndefined();
        await retryGeneratedRelationship(db, connection, {
            code: 'third-code',
        });
        expect(child).toMatchObject({
            principalCode: 'third-code', principal: parent,
        });
    });

});
