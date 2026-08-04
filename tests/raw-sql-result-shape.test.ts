import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, QueryCompilationError } from '../src';
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

        await expect(db.rows.fromSql`select id from shape_rows`.toArray())
            .rejects.toMatchObject({
                name: QueryCompilationError.name,
                details: {
                    entityName: 'ShapeRow',
                    missingColumns: ['label', 'version'],
                },
            });
        expect(db.changeTracker.entries()).toEqual([]);
    });

    it('allows explicit no-tracking partial rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'row_1' }], rowCount: 1 });
        const db = createDb(connection);

        const row = await db.rows
            .fromSql`select id from shape_rows`
            .asNoTracking()
            .single();

        expect(row.id).toBe('row_1');
        expect(row.label).toBeUndefined();
        expect(row.version).toBeUndefined();
        expect(db.entry(row)).toBeUndefined();
    });
});
