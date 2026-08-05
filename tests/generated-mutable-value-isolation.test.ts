import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { DbContext, EntityState, valueConverter } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class ConvertedPayload {
    constructor(public label: string) {}
}

const payloadConverter = valueConverter<
    ConvertedPayload,
    { label: string }
>({
    toProvider: value => ({ label: value.label }),
    fromProvider: value => new ConvertedPayload(value.label),
});

class GeneratedMutableRow {
    public id = '';
    public generatedAt!: Date;
    public bytes!: Uint8Array;
    public payload!: { label: string };
    public converted!: ConvertedPayload;
}

class GeneratedMutableContext extends DbContext {
    public rows = this.set(GeneratedMutableRow);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedMutableRow, entity => {
            entity.toTable('generated_mutable_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.generatedAt).hasColumnName('generated_at')
                .hasColumnType('timestamptz').isRequired().valueGeneratedOnAdd();
            entity.property(row => row.bytes).hasColumnType('bytea')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.payload).hasColumnType('jsonb')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.converted).hasColumnType('jsonb')
                .hasConversion(payloadConverter).isRequired()
                .valueGeneratedOnAdd();
        });
    }
}

class GeneratedDateParent {
    public id!: Date;
    public children: GeneratedDateChild[] = [];
}

class GeneratedDateChild {
    public id = '';
    public parentId!: Date;
    public parent!: GeneratedDateParent;
}

class GeneratedDateGraphContext extends DbContext {
    public parents = this.set(GeneratedDateParent);
    public children = this.set(GeneratedDateChild);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedDateParent, entity => {
            entity.toTable('generated_date_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('timestamptz')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(GeneratedDateChild, entity => {
            entity.toTable('generated_date_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('timestamptz').isRequired();
            entity.hasOne(GeneratedDateParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
    }
}

class DelayedGeneratedConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private markStarted!: () => void;
    private queryCount = 0;
    public readonly queryStarted: Promise<void> = new Promise(resolve => {
        this.markStarted = resolve;
    });
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });

    public release(): void {
        this.releaseQuery();
    }

    public override async query<TRow extends Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        if (this.queryCount === 2) {
            this.markStarted();
            await this.released;
        }
        return super.query<TRow>(statement, options);
    }
}

const storedTime = new Date('2026-08-05T10:00:00.000Z');
const changedTime = new Date('2026-09-01T00:00:00.000Z');

function generatedRow(id: string): Record<string, unknown> {
    return {
        id,
        generated_at: storedTime,
        bytes: Uint8Array.from([1, 2, 3]),
        payload: { label: 'stored' },
        converted: { label: 'converted' },
    };
}

describe('generated mutable value isolation', () => {
    it('accepts provider facts independently of live in-place mutations', async () => {
        const connection = new DelayedGeneratedConnection();
        connection.queueResult({ rows: [generatedRow('first')], rowCount: 1 });
        connection.queueResult({ rows: [generatedRow('second')], rowCount: 1 });
        const db = GeneratedMutableContext.create(connection);
        const first = Object.assign(new GeneratedMutableRow(), { id: 'first' });
        const second = Object.assign(new GeneratedMutableRow(), { id: 'second' });
        db.rows.add(first);
        db.rows.add(second);

        const saving = db.saveChanges();
        await connection.queryStarted;
        first.generatedAt.setTime(changedTime.getTime());
        first.bytes[0] = 9;
        first.payload.label = 'changed';
        first.converted.label = 'changed';
        connection.release();
        await expect(saving).resolves.toBe(2);

        const original = db.entry(first)?.originalValues;
        expect(original?.generatedAt).toEqual(storedTime);
        expect(original?.bytes).toEqual(Uint8Array.from([1, 2, 3]));
        expect(original?.payload).toEqual({ label: 'stored' });
        expect(original?.converted).toEqual(new ConvertedPayload('converted'));
        expect(first.generatedAt).not.toBe(original?.generatedAt);
        expect(first.bytes).not.toBe(original?.bytes);
        expect(first.payload).not.toBe(original?.payload);
        expect(first.converted).not.toBe(original?.converted);
        expect(db.entry(first)?.state).toBe(EntityState.Modified);
        expect(db.entry(second)?.state).toBe(EntityState.Unchanged);
    });

    it('isolates a propagated mutable foreign key from its live value', async () => {
        const connection = new DelayedGeneratedConnection();
        connection.queueResult({ rows: [{ id: storedTime }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = GeneratedDateGraphContext.create(connection);
        const parent = new GeneratedDateParent();
        const child = Object.assign(new GeneratedDateChild(), {
            id: 'child',
            parent,
        });
        parent.children = [child];
        db.children.add(child);
        db.parents.add(parent);

        const saving = db.saveChanges();
        await connection.queryStarted;
        expect(child.parentId).toEqual(storedTime);
        expect(child.parentId).not.toBe(parent.id);
        child.parentId.setTime(changedTime.getTime());
        connection.release();
        await expect(saving).resolves.toBe(2);

        expect(connection.statements[1]?.values).toEqual(['child', storedTime]);
        expect(db.entry(child)?.originalValues.parentId).toEqual(storedTime);
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
    });
});
