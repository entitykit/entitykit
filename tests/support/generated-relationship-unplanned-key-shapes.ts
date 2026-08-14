import {
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
} from './generated-relationship-transaction-model';
import type {
    GeneratedRelationshipTransactionContext,
} from './generated-relationship-transaction-model';

export interface UnplannedKeyShapeFixture {
    readonly principal: object;
    readonly dependent: object;
    readonly firstRow: Readonly<Record<string, unknown>>;
    readonly secondRow: Readonly<Record<string, unknown>>;
    readonly addPrincipal: () => void;
    readonly addDependent: () => void;
    readonly attachDependent: () => void;
    readonly assignGeneratedForeignKey: () => void;
    readonly assertRetargeted: () => void;
    readonly assertTargetsPrincipal: () => void;
}

export interface UnplannedKeyShape {
    readonly name: string;
    readonly create: (
        db: GeneratedRelationshipTransactionContext,
    ) => UnplannedKeyShapeFixture;
}

function numberShape(
    name: string,
    dependent: 'required' | 'optional' | 'one-to-one',
): UnplannedKeyShape {
    return { name, create: db => {
        const principal = new TransactionNumberPrincipal();
        const child = dependent === 'required'
            ? Object.assign(new TransactionNumberDependent(), {
                id: name, principalId: 7,
            })
            : dependent === 'optional'
                ? Object.assign(new TransactionOptionalNumberDependent(), {
                    id: name,
                })
                : Object.assign(new TransactionNumberProfile(), {
                    id: name, principalId: 7,
                });
        const set = dependent === 'required'
            ? db.numberDependents
            : dependent === 'optional'
                ? db.optionalNumberDependents
                : db.numberProfiles;
        return {
            principal, dependent: child,
            firstRow: { id: 201 }, secondRow: { id: 202 },
            addPrincipal: () => {
                db.numberPrincipals.add(principal);
            },
            addDependent: () => {
                set.add(child as never);
            },
            attachDependent: () => {
                set.attach(child as never);
            },
            assignGeneratedForeignKey: () => {
                child.principalId = principal.id;
            },
            assertRetargeted: () => {
                expect(child).toMatchObject({
                    principalId: 202, principal,
                });
            },
            assertTargetsPrincipal: () => {
                expect(child).toMatchObject({
                    principalId: principal.id, principal,
                });
            },
        };
    } };
}

export const unplannedKeyShapes: readonly UnplannedKeyShape[] = [
    numberShape('required numeric primary key', 'required'),
    numberShape('optional numeric primary key', 'optional'),
    numberShape('one-to-one numeric primary key', 'one-to-one'),
    { name: 'bigint primary key', create: (
        db: GeneratedRelationshipTransactionContext,
    ): UnplannedKeyShapeFixture => {
        const principal = new TransactionBigIntPrincipal();
        const child = Object.assign(new TransactionBigIntDependent(), {
            id: 'bigint', principalId: 7n,
        });
        return {
            principal, dependent: child,
            firstRow: { id: 203n }, secondRow: { id: 204n },
            addPrincipal: () => {
                db.bigintPrincipals.add(principal);
            },
            addDependent: () => {
                db.bigintDependents.add(child);
            },
            attachDependent: () => {
                db.bigintDependents.attach(child);
            },
            assignGeneratedForeignKey: () => {
                child.principalId = principal.id;
            },
            assertRetargeted: () => {
                expect(child).toMatchObject({
                    principalId: 204n, principal,
                });
            },
            assertTargetsPrincipal: () => {
                expect(child).toMatchObject({
                    principalId: principal.id, principal,
                });
            },
        };
    } },
    { name: 'converter-backed primary key', create: (
        db: GeneratedRelationshipTransactionContext,
    ): UnplannedKeyShapeFixture => {
        const principal = new TransactionConvertedPrincipal();
        const child = Object.assign(new TransactionConvertedDependent(), {
            id: 'converted', principalId: '7',
        });
        return {
            principal, dependent: child,
            firstRow: { id: 205 }, secondRow: { id: 206 },
            addPrincipal: () => {
                db.convertedPrincipals.add(principal);
            },
            addDependent: () => {
                db.convertedDependents.add(child);
            },
            attachDependent: () => {
                db.convertedDependents.attach(child);
            },
            assignGeneratedForeignKey: () => {
                child.principalId = principal.id;
            },
            assertRetargeted: () => {
                expect(child).toMatchObject({
                    principalId: '206', principal,
                });
            },
            assertTargetsPrincipal: () => {
                expect(child).toMatchObject({
                    principalId: principal.id, principal,
                });
            },
        };
    } },
    { name: 'composite generated component', create: (
        db: GeneratedRelationshipTransactionContext,
    ): UnplannedKeyShapeFixture => {
        const principal = Object.assign(new TransactionCompositePrincipal(), {
            region: 'north',
        });
        const child = Object.assign(new TransactionCompositeDependent(), {
            id: 'composite', principalRegion: 'north', principalId: 7,
        });
        return {
            principal, dependent: child,
            firstRow: { id: 207 }, secondRow: { id: 208 },
            addPrincipal: () => {
                db.compositePrincipals.add(principal);
            },
            addDependent: () => {
                db.compositeDependents.add(child);
            },
            attachDependent: () => {
                db.compositeDependents.attach(child);
            },
            assignGeneratedForeignKey: () => {
                child.principalId = principal.id;
            },
            assertRetargeted: () => {
                expect(child).toMatchObject({
                    principalRegion: 'north', principalId: 208, principal,
                });
            },
            assertTargetsPrincipal: () => {
                expect(child).toMatchObject({
                    principalRegion: principal.region,
                    principalId: principal.id,
                    principal,
                });
            },
        };
    } },
    { name: 'generated alternate key', create: (
        db: GeneratedRelationshipTransactionContext,
    ): UnplannedKeyShapeFixture => {
        const principal = Object.assign(new TransactionAlternatePrincipal(), {
            id: 'alternate-parent',
        });
        const child = Object.assign(new TransactionAlternateDependent(), {
            id: 'alternate-child', principalCode: 'stable-code',
        });
        return {
            principal, dependent: child,
            firstRow: { code: 'old-code' }, secondRow: { code: 'new-code' },
            addPrincipal: () => {
                db.alternatePrincipals.add(principal);
            },
            addDependent: () => {
                db.alternateDependents.add(child);
            },
            attachDependent: () => {
                db.alternateDependents.attach(child);
            },
            assignGeneratedForeignKey: () => {
                child.principalCode = principal.code;
            },
            assertRetargeted: () => {
                expect(child).toMatchObject({
                    principalCode: 'new-code', principal,
                });
            },
            assertTargetsPrincipal: () => {
                expect(child).toMatchObject({
                    principalCode: principal.code, principal,
                });
            },
        };
    } },
];
