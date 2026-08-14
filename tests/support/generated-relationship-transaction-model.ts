import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext, valueConverter } from '../../src';
import { postgresDialect } from '../../src/providers/postgres';
import type { RecordingDatabaseConnection } from './recording-database-connection';

export class TransactionNumberPrincipal {
    public id = 0;
    public children: TransactionNumberDependent[] = [];
    public profile: TransactionNumberProfile | null = null;
}
export class TransactionNumberDependent {
    public id = '';
    public principalId = 0;
    public principal: TransactionNumberPrincipal | null = null;
}
export class TransactionNumberProfile {
    public id = '';
    public principalId = 0;
    public principal: TransactionNumberPrincipal | null = null;
}
export class TransactionBigIntPrincipal {
    public id = 0n;
    public children: TransactionBigIntDependent[] = [];
}
export class TransactionBigIntDependent {
    public id = '';
    public principalId = 0n;
    public principal: TransactionBigIntPrincipal | null = null;
}
export class TransactionConvertedPrincipal {
    public id = '0';
    public children: TransactionConvertedDependent[] = [];
}
export class TransactionConvertedDependent {
    public id = '';
    public principalId = '0';
    public principal: TransactionConvertedPrincipal | null = null;
}
export class TransactionCompositePrincipal {
    public region = '';
    public id = 0;
    public children: TransactionCompositeDependent[] = [];
}
export class TransactionCompositeDependent {
    public id = '';
    public principalRegion = '';
    public principalId = 0;
    public principal: TransactionCompositePrincipal | null = null;
}
export class TransactionAlternatePrincipal {
    public id = '';
    public code = '';
    public children: TransactionAlternateDependent[] = [];
}
export class TransactionAlternateDependent {
    public id = '';
    public principalCode = '';
    public principal: TransactionAlternatePrincipal | null = null;
}

const stringNumber = valueConverter<string, number>({
    toProvider: value => Number(value),
    fromProvider: value => String(value),
});

export class GeneratedRelationshipTransactionContext extends DbContext {
    public numberPrincipals = this.set(TransactionNumberPrincipal);
    public numberDependents = this.set(TransactionNumberDependent);
    public numberProfiles = this.set(TransactionNumberProfile);
    public bigintPrincipals = this.set(TransactionBigIntPrincipal);
    public bigintDependents = this.set(TransactionBigIntDependent);
    public convertedPrincipals = this.set(TransactionConvertedPrincipal);
    public convertedDependents = this.set(TransactionConvertedDependent);
    public compositePrincipals = this.set(TransactionCompositePrincipal);
    public compositeDependents = this.set(TransactionCompositeDependent);
    public alternatePrincipals = this.set(TransactionAlternatePrincipal);
    public alternateDependents = this.set(TransactionAlternateDependent);

    constructor(public readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TransactionNumberPrincipal, entity => {
            entity.toTable('transaction_number_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(TransactionNumberDependent, entity => {
            entity.toTable('transaction_number_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(TransactionNumberPrincipal, row => row.principal)
                .withMany(row => row.children)
                .hasForeignKey(row => row.principalId);
        });
        model.entity(TransactionNumberProfile, entity => {
            entity.toTable('transaction_number_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(TransactionNumberPrincipal, row => row.principal)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.principalId);
        });
        model.entity(TransactionBigIntPrincipal, entity => {
            entity.toTable('transaction_bigint_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('bigint')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(TransactionBigIntDependent, entity => {
            entity.toTable('transaction_bigint_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId).hasColumnType('bigint')
                .isRequired();
            entity.hasOne(TransactionBigIntPrincipal, row => row.principal)
                .withMany(row => row.children)
                .hasForeignKey(row => row.principalId);
        });
        model.entity(TransactionConvertedPrincipal, entity => {
            entity.toTable('transaction_converted_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .hasConversion(stringNumber).isRequired().valueGeneratedOnAdd();
        });
        model.entity(TransactionConvertedDependent, entity => {
            entity.toTable('transaction_converted_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId).hasColumnType('integer')
                .hasConversion(stringNumber).isRequired();
            entity.hasOne(TransactionConvertedPrincipal, row => row.principal)
                .withMany(row => row.children)
                .hasForeignKey(row => row.principalId);
        });
        model.entity(TransactionCompositePrincipal, entity => {
            entity.toTable('transaction_composite_principals');
            entity.hasKey(row => [row.region, row.id]);
            entity.property(row => row.region).hasColumnType('text').isRequired();
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(TransactionCompositeDependent, entity => {
            entity.toTable('transaction_composite_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalRegion).hasColumnType('text')
                .isRequired();
            entity.property(row => row.principalId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(TransactionCompositePrincipal, row => row.principal)
                .withMany(row => row.children)
                .hasForeignKey(row => [row.principalRegion, row.principalId]);
        });
        model.entity(TransactionAlternatePrincipal, entity => {
            entity.toTable('transaction_alternate_principals');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => row.code);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.code).hasColumnType('text').isRequired()
                .valueGeneratedOnAdd();
        });
        model.entity(TransactionAlternateDependent, entity => {
            entity.toTable('transaction_alternate_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalCode).hasColumnType('text')
                .isRequired();
            entity.hasOne(TransactionAlternatePrincipal, row => row.principal)
                .withMany(row => row.children)
                .hasForeignKey(row => row.principalCode)
                .hasPrincipalKey(row => row.code);
        });
    }
}
