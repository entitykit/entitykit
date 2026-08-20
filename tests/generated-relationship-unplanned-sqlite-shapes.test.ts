import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import {
    GeneratedRelationshipTransactionContext,
    TransactionAlternatePrincipal,
    TransactionBigIntPrincipal,
    TransactionCompositePrincipal,
    TransactionConvertedPrincipal,
} from './support/generated-relationship-transaction-model';
import { unplannedKeyShapes } from './support/generated-relationship-unplanned-key-shapes';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class UnplannedSqliteShapeContext extends
    GeneratedRelationshipTransactionContext {
    constructor() {
        super(new RecordingDatabaseConnection());
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        super.model(model);
        model.entity(TransactionBigIntPrincipal, entity => {
            entity.property(row => row.id)
                .hasDefaultSql('(abs(random() % 1000000000) + 1000)');
        });
        model.entity(TransactionCompositePrincipal, entity => {
            entity.property(row => row.id)
                .hasDefaultSql('(abs(random() % 1000000000) + 1000)');
        });
        model.entity(TransactionAlternatePrincipal, entity => {
            entity.property(row => row.code)
                .hasDefaultSql('(lower(hex(randomblob(8))))');
        });
    }
}

function generatedRelationshipValue(principal: object): unknown {
    if (principal instanceof TransactionAlternatePrincipal) {
        return principal.code;
    }
    return (principal as { id: unknown }).id;
}

async function occupyRolledBackTarget(
    db: UnplannedSqliteShapeContext,
    principal: object,
    generatedValue: unknown,
): Promise<void> {
    if (principal instanceof TransactionAlternatePrincipal) {
        await db.database.connection.query({
            text: `insert into transaction_alternate_principals (id, code)
                values (?, ?)`,
            values: ['unrelated-alternate', generatedValue],
        });
        return;
    }
    if (principal instanceof TransactionCompositePrincipal) {
        await db.database.connection.query({
            text: `insert into transaction_composite_principals (region, id)
                values (?, ?)`,
            values: [principal.region, generatedValue],
        });
        return;
    }
    const table = principal instanceof TransactionBigIntPrincipal
        ? 'transaction_bigint_principals'
        : principal instanceof TransactionConvertedPrincipal
            ? 'transaction_converted_principals'
            : 'transaction_number_principals';
    await db.database.connection.query({
        text: `insert into ${table} (id) values (?)`,
        values: [generatedValue],
    });
}

describe('unplanned generated relationship key shapes on SQLite', () => {
    it.each(unplannedKeyShapes)(
        'retargets an added $name after the old key is occupied',
        async shape => {
            const db = UnplannedSqliteShapeContext.create();
            await db.database.connection.query({
                text: db.database.createScript(), values: [],
            });
            const fixture = shape.create(db);
            let rolledBackValue: unknown;
            await expect(db.transaction(async tx => {
                fixture.addPrincipal();
                await tx.saveChanges();
                rolledBackValue = generatedRelationshipValue(
                    fixture.principal,
                );
                fixture.assignGeneratedForeignKey();
                fixture.addDependent();
                throw new Error('abort before dependent plan');
            })).rejects.toThrow('abort before dependent plan');
            await occupyRolledBackTarget(
                db, fixture.principal, rolledBackValue,
            );

            await expect(db.saveChanges()).resolves.toBe(2);
            expect(generatedRelationshipValue(fixture.principal))
                .not.toBe(rolledBackValue);
            fixture.assertTargetsPrincipal();
            await db.dispose();
        },
    );
});
