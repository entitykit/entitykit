import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../packages/core/src';
import { DbContext, OperationCanceledError, valueConverter } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class GeneratedToken {
    constructor(public readonly value: string) {}
}

const tokenConverter = valueConverter<GeneratedToken, string>({
    toProvider: value => value.value,
    fromProvider: value => new GeneratedToken(value),
});

class GeneratedDetails {
    public generatedAt?: Date;
}

class GeneratedShapeRow {
    public id = 0;
    public sku = '';
    public label = '';
    public generatedAt?: Date;
    public generatedBytes?: Uint8Array;
    public generatedJson?: { readonly source: string; readonly values: number[] };
    public generatedToken?: GeneratedToken;
    public details: GeneratedDetails | null = null;
}

class GeneratedShapeContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(GeneratedShapeRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(GeneratedShapeContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedShapeRow, entity => {
            entity.toTable('generated_shape_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.generatedAt).hasColumnName('generated_at')
                .hasColumnType('timestamp').isOptional().valueGeneratedOnAdd();
            entity.property(row => row.generatedBytes)
                .hasColumnName('generated_bytes').hasColumnType('bytea')
                .isOptional().valueGeneratedOnAdd();
            entity.property(row => row.generatedJson)
                .hasColumnName('generated_json').hasColumnType('jsonb')
                .isOptional().valueGeneratedOnAdd();
            entity.property(row => row.generatedToken)
                .hasColumnName('generated_token').hasColumnType('text')
                .hasConversion(tokenConverter).isOptional().valueGeneratedOnAdd();
            entity.complexProperty(
                row => row.details,
                { constructor: GeneratedDetails },
                details => details.property(value => value.generatedAt)
                    .hasColumnName('nested_generated_at')
                    .hasColumnType('timestamp').isOptional()
                    .valueGeneratedOnAdd(),
            );
            entity.hasIndex(row => row.sku).isUnique();
        });
    }
}

class DelayedSecondQueryConnection extends RecordingDatabaseConnection {
    private queryCount = 0;
    private releaseSecond!: () => void;
    private markSecondStarted!: () => void;
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseSecond = resolve;
    });
    public readonly secondStarted: Promise<void> = new Promise(resolve => {
        this.markSecondStarted = resolve;
    });

    public release(): void {
        this.releaseSecond();
    }

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        if (this.queryCount === 2) {
            this.markSecondStarted();
            await this.released;
        }
        return super.query<TRow>(statement, options);
    }
}

const upsertOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['label'] as const,
};
const generatedAt = new Date('2026-08-10T12:00:00.000Z');
const nestedAt = new Date('2026-08-10T13:00:00.000Z');

function generatedResult(id = 41): DatabaseQueryResult {
    return {
        rows: [{
            id,
            generated_at: generatedAt,
            generated_bytes: new Uint8Array([1, 2, 3]),
            generated_json: { source: 'provider', values: [1, 2] },
            generated_token: 'provider-token',
            nested_generated_at: nestedAt,
        }],
        rowCount: 1,
    };
}

function row(sku: string): GeneratedShapeRow {
    return Object.assign(new GeneratedShapeRow(), { sku, label: sku });
}

function open(connection: RecordingDatabaseConnection): GeneratedShapeContext {
    GeneratedShapeContext.connection = connection;
    return GeneratedShapeContext.create();
}

describe('bulk upsert generated-value rollback', () => {
    it('preserves newer caller values after a later provider failure', async () => {
        const connection = new DelayedSecondQueryConnection();
        const db = open(connection);
        const first = row('first');
        const second = row('second');
        connection.queueResult(generatedResult());
        connection.queueError(new Error('later batch failed'));

        const pending = db.rows.executeUpsert([first, second], upsertOptions);
        await connection.secondStarted;
        first.id = 999;
        first.generatedAt = new Date('2030-01-01T00:00:00.000Z');
        first.generatedBytes = new Uint8Array([9, 9]);
        first.generatedJson = { source: 'caller', values: [9] };
        first.generatedToken = new GeneratedToken('caller-token');
        first.details = Object.assign(new GeneratedDetails(), {
            generatedAt: new Date('2030-01-02T00:00:00.000Z'),
        });
        connection.release();

        await expect(pending).rejects.toThrow('later batch failed');
        expect(first).toEqual(expect.objectContaining({
            id: 999,
            generatedAt: new Date('2030-01-01T00:00:00.000Z'),
            generatedBytes: new Uint8Array([9, 9]),
            generatedJson: { source: 'caller', values: [9] },
            generatedToken: new GeneratedToken('caller-token'),
        }));
        expect(first.details).toEqual({
            generatedAt: new Date('2030-01-02T00:00:00.000Z'),
        });
    });

    it('restores equal-by-value replacements after a later failure', async () => {
        const connection = new DelayedSecondQueryConnection();
        const db = open(connection);
        const first = row('first');
        connection.queueResult(generatedResult());
        connection.queueError(new Error('later batch failed'));

        const pending = db.rows.executeUpsert([first, row('second')], upsertOptions);
        await connection.secondStarted;
        first.generatedAt = new Date(generatedAt);
        first.generatedBytes = new Uint8Array([1, 2, 3]);
        first.generatedJson = { source: 'provider', values: [1, 2] };
        first.generatedToken = new GeneratedToken('provider-token');
        connection.release();

        await expect(pending).rejects.toThrow('later batch failed');
        expect(first.id).toBe(0);
        expect(first.generatedAt).toBeUndefined();
        expect(first.generatedBytes).toBeUndefined();
        expect(first.generatedJson).toBeUndefined();
        expect(first.generatedToken).toBeUndefined();
        expect(first.details).toBeNull();
    });

    it('preserves a caller replacement when a later batch is canceled', async () => {
        const connection = new DelayedSecondQueryConnection();
        const db = open(connection);
        const first = row('first');
        const controller = new AbortController();
        connection.queueResult(generatedResult());

        const pending = db.rows.executeUpsert([first, row('second')], {
            ...upsertOptions,
            signal: controller.signal,
        });
        await connection.secondStarted;
        first.id = 999;
        controller.abort('cancel later batch');
        connection.release();

        await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
        expect(first.id).toBe(999);
    });

    it('preserves edits made after upsert when the outer transaction rolls back', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = open(connection);
        const first = row('first');
        connection.queueResult(generatedResult());

        await expect(db.transaction(async transaction => {
            await transaction.rows.executeUpsert([first], upsertOptions);
            first.id = 999;
            first.generatedJson = { source: 'caller', values: [9] };
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(first.id).toBe(999);
        expect(first.generatedJson).toEqual({ source: 'caller', values: [9] });
        expect(first.generatedAt).toBeUndefined();
        expect(first.generatedBytes).toBeUndefined();
        expect(first.generatedToken).toBeUndefined();
        expect(first.details).toBeNull();
    });
});
