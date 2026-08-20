import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class PrivateSecret {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

class NonEnumerableSecret {
    constructor(value: string) {
        Object.defineProperty(this, '_value', {
            enumerable: false,
            value,
        });
    }

    public get value(): string {
        return (this as unknown as { readonly _value?: string })._value ??
            'fallback';
    }
}

const privateSecret = valueConverter<PrivateSecret, string>({
    toProvider: value => value.value,
    fromProvider: value => new PrivateSecret(value),
});
const nonEnumerableSecret = valueConverter<NonEnumerableSecret, string>({
    toProvider: value => value.value,
    fromProvider: value => new NonEnumerableSecret(value),
});

class GeneratedSecretRow {
    public id = 0;
    public privateToken!: PrivateSecret;
    public nonEnumerableToken!: NonEnumerableSecret;
}

class GeneratedSecretContext extends DbContext {
    public rows = this.set(GeneratedSecretRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedSecretRow, entity => {
            entity.toTable('generated_secret_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.privateToken)
                .hasColumnName('private_token').hasColumnType('text')
                .hasConversion(privateSecret).isRequired()
                .hasDefaultSql('\'database-private\'').valueGeneratedOnAdd();
            entity.property(row => row.nonEnumerableToken)
                .hasColumnName('non_enumerable_token').hasColumnType('text')
                .hasConversion(nonEnumerableSecret).isRequired()
                .hasDefaultSql('\'database-hidden\'').valueGeneratedOnAdd();
        });
    }
}

class AuditedSecretRow {
    public id = '';
    public createdBy!: PrivateSecret;
}

class AuditedSecretContext extends DbContext {
    public rows = this.set(AuditedSecretRow);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection).useAuditing({
            currentUserId: () => new PrivateSecret('actor'),
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AuditedSecretRow, entity => {
            entity.toTable('audited_secret_rows');
            entity.hasKey(row => row.id);
            entity.audit({ createdBy: row => row.createdBy });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.createdBy).hasColumnName('created_by')
                .hasColumnType('text').hasConversion(privateSecret).isRequired();
        });
    }
}

describe('converter persistence facts', () => {
    it('reconstructs generated class values without structural cloning', async () => {
        const db = GeneratedSecretContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const row = new GeneratedSecretRow();
        db.rows.add(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        const original = db.entry(row)?.originalValues;
        expect(row.privateToken.value).toBe('database-private');
        expect(row.nonEnumerableToken.value).toBe('database-hidden');
        expect((original?.privateToken as PrivateSecret).value)
            .toBe('database-private');
        expect((original?.nonEnumerableToken as NonEnumerableSecret).value)
            .toBe('database-hidden');
        expect(row.privateToken).not.toBe(original?.privateToken);
        expect(row.nonEnumerableToken).not.toBe(original?.nonEnumerableToken);
        expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
        expect(db.getSavePlan()).toEqual([]);
        await db.dispose();
    });

    it('reconstructs converted audit values for persisted and live state', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = AuditedSecretContext.create(connection);
        const row = Object.assign(new AuditedSecretRow(), { id: 'row-1' });
        db.rows.add(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        const original = db.entry(row)?.originalValues.createdBy;
        expect(row.createdBy.value).toBe('actor');
        expect((original as PrivateSecret).value).toBe('actor');
        expect(row.createdBy).not.toBe(original);
        expect(connection.statements[0]?.values).toContain('actor');
        expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
    });
});
