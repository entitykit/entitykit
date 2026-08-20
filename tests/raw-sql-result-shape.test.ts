import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, QueryCompilationError } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class ShapeRow {
    public id!: string;
    public label!: string;
    public version!: number;
}

class RawShapeContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(ShapeRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RawShapeContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ShapeRow, entity => {
            entity.toTable('shape_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnName('label').hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnName('version').hasColumnType('integer').isRequired();
        });
    }
}

function createDb(connection: RecordingDatabaseConnection): RawShapeContext {
    RawShapeContext.connection = connection;
    return RawShapeContext.create();
}

describe('raw SQL result shape', () => {
    it('rejects partial rows before tracked materialization', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'row_1' }], rowCount: 1 });
        const db = createDb(connection);

        await expect(db.rows
            .fromSqlUnsafe`select id from shape_rows`
            .asTracking()
            .toArray())
            .rejects.toMatchObject({
                name: QueryCompilationError.name,
                details: {
                    entityName: 'ShapeRow',
                    missingColumns: ['label', 'version'],
                },
            });
        expect(db.changeTracker.entries()).toEqual([]);
    });

    it('allows untracked partial rows without a primary key', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ label: 'partial' }], rowCount: 1 });
        const db = createDb(connection);

        const rows = await db.rows
            .fromSqlUnsafe`select label from shape_rows`
            .toArray();

        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBeUndefined();
        expect(rows[0]?.label).toBe('partial');
        expect(rows[0]?.version).toBeUndefined();
        expect(db.entry(rows[0] ?? {} as ShapeRow)).toBeUndefined();
    });
});
