import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import type { DatabaseRuntimeProviderServices } from '../../packages/core/src/adapter';
import { sqliteProviderServices } from '../../packages/sqlite/src';

export class SparseArrayRow {
    public id = '';
    private stored: string[] = [];

    constructor(private readonly refusedIndex?: number) {}

    public get items(): string[] {
        return this.stored;
    }

    public set items(value: string[]) {
        this.stored = value.slice();
        if (this.refusedIndex !== undefined) Reflect.deleteProperty(this.stored, this.refusedIndex);
    }
}

export class SparseArrayContext extends DbContext {
    public rows = this.set(SparseArrayRow);

    constructor(
        private readonly refusedIndex?: number,
        private readonly provider: DatabaseRuntimeProviderServices = sqliteProviderServices,
        private readonly target = ':memory:',
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(this.provider, this.target);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SparseArrayRow, entity => {
            entity.toTable('sparse_array_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.items).hasColumnType('json').isRequired();
            entity.materialize(() => new SparseArrayRow(this.refusedIndex));
        });
    }
}

export async function seedSparseArrayRows(context: SparseArrayContext, providerName = 'sqlite'): Promise<void> {
    const query = async (text: string, values: unknown[] = []): Promise<void> => {
        await context.database.connection.query({ text, values });
    };
    await query(context.database.createScript());
    const placeholders = providerName === 'postgres' ? '$1, $2' : '?, ?';
    for (const [id, items] of [['a-safe', []], ['b-refused', ['first', 'middle', 'last']]] as const) {
        await query(`insert into sparse_array_rows values (${placeholders})`, [id, JSON.stringify(items)]);
    }
}
