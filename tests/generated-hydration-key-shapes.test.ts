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
} from './support/generated-relationship-transaction-model';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

interface GeneratedShape {
    readonly parent: object;
    readonly child: object;
    readonly property: string;
    readonly initialValue: unknown;
    readonly returned: Record<string, unknown>;
    readonly addParent: (
        db: GeneratedRelationshipTransactionContext,
    ) => void;
    readonly attachChild: (
        db: GeneratedRelationshipTransactionContext,
    ) => void;
    readonly expose: (value: unknown) => void;
    readonly readDependent: () => unknown;
    readonly expectedDependent: unknown;
}

function installFailingGeneratedSetter(shape: GeneratedShape): void {
    let stored = shape.initialValue;
    Object.defineProperty(shape.parent, shape.property, {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: unknown) => {
            stored = value;
            if (!Object.is(value, shape.initialValue)) {
                shape.expose(value);
                throw new Error(`generated ${shape.property} setter failed`);
            }
        },
    });
}

function shapes(): readonly GeneratedShape[] {
    const bigintParent = new TransactionBigIntPrincipal();
    const bigintChild = Object.assign(new TransactionBigIntDependent(), {
        id: 'bigint-child', principalId: 1n,
    });
    const convertedParent = new TransactionConvertedPrincipal();
    const convertedChild = Object.assign(new TransactionConvertedDependent(), {
        id: 'converted-child', principalId: '1',
    });
    const compositeParent = Object.assign(new TransactionCompositePrincipal(), {
        region: 'north',
    });
    const compositeChild = Object.assign(new TransactionCompositeDependent(), {
        id: 'composite-child', principalRegion: 'north', principalId: 1,
    });
    const alternateParent = Object.assign(new TransactionAlternatePrincipal(), {
        id: 'alternate-parent',
    });
    const alternateChild = Object.assign(new TransactionAlternateDependent(), {
        id: 'alternate-child', principalCode: 'durable-code',
    });
    return [
        {
            parent: bigintParent, child: bigintChild,
            property: 'id', initialValue: 0n, returned: { id: 41n },
            addParent: db => db.bigintPrincipals.add(bigintParent),
            attachChild: db => db.bigintDependents.attach(bigintChild),
            expose: value => {
                bigintChild.principalId = value as bigint;
            },
            readDependent: () => bigintChild.principalId,
            expectedDependent: 41n,
        },
        {
            parent: convertedParent, child: convertedChild,
            property: 'id', initialValue: '0', returned: { id: 42 },
            addParent: db => db.convertedPrincipals.add(convertedParent),
            attachChild: db => db.convertedDependents.attach(convertedChild),
            expose: value => {
                convertedChild.principalId = value as string;
            },
            readDependent: () => convertedChild.principalId,
            expectedDependent: '42',
        },
        {
            parent: compositeParent, child: compositeChild,
            property: 'id', initialValue: undefined, returned: { id: 43 },
            addParent: db => db.compositePrincipals.add(compositeParent),
            attachChild: db => db.compositeDependents.attach(compositeChild),
            expose: value => {
                compositeChild.principalId = value as number;
            },
            readDependent: () => compositeChild.principalId,
            expectedDependent: 43,
        },
        {
            parent: alternateParent, child: alternateChild,
            property: 'code', initialValue: undefined,
            returned: { code: 'generated-code' },
            addParent: db => db.alternatePrincipals.add(alternateParent),
            attachChild: db => db.alternateDependents.attach(alternateChild),
            expose: value => {
                alternateChild.principalCode = value as string;
            },
            readDependent: () => alternateChild.principalCode,
            expectedDependent: 'generated-code',
        },
    ];
}

describe('partial generated hydration key shapes', () => {
    it.each(shapes())(
        'registers $property rollback facts before its setter throws',
        async shape => {
            const connection = new RecordingDatabaseConnection();
            const created = GeneratedRelationshipTransactionContext.create(
                connection,
            );
            installFailingGeneratedSetter(shape);
            shape.attachChild(created);
            shape.addParent(created);
            connection.queueResult({ rows: [shape.returned], rowCount: 1 });

            await expect(created.saveChanges()).rejects.toThrow(
                `generated ${shape.property} setter failed`,
            );
            expect((shape.parent as Record<string, unknown>)[shape.property])
                .toBe(shape.initialValue);
            expect(shape.readDependent()).toBe(shape.expectedDependent);
            expect(() => created.getSavePlan()).toThrow(
                'has not been generated yet',
            );
        },
    );
});
