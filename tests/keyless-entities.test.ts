import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { ModelBuilder } from '../src';
import { DbContext, type DbContextOptionsBuilder } from '../src';
import { type DatabaseSchemaSnapshot, generateDbPullCodeWithDiagnostics } from '../src/tooling';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { compileGeneratedFiles, createGeneratedModelSnapshot } from './db-pull-codegen/support';
import { diffModelSnapshots } from '../src/migrations/api';

class SalesReport {
    public region!: string;
    public total!: number;
}

class ImportRow {
    public value!: string;
}

class ReportCustomer {
    public id!: string;
    public name!: string;
}

class CustomerTotal {
    public customerId!: string;
    public total!: number;
    public customer!: ReportCustomer;
}

class KeylessContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public reports = this.set(SalesReport);
    public imports = this.set(ImportRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(KeylessContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SalesReport, entity => {
            entity.toView('sales_report');
            entity.property(row => row.region).hasColumnType('text').isRequired();
            entity.property(row => row.total).hasColumnType('integer').isRequired();
        });
        model.entity(ImportRow, entity => {
            entity.toTable('import_rows').hasNoKey();
            entity.property(row => row.value).hasColumnType('text').isRequired();
        });
    }
}

function createContext(): KeylessContext {
    KeylessContext.connection = new RecordingDatabaseConnection();
    return KeylessContext.create();
}

class KeylessRelationshipContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public totals = this.set(CustomerTotal);
    public customers = this.set(ReportCustomer);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(KeylessRelationshipContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ReportCustomer, entity => {
            entity.toTable('customers');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(CustomerTotal, entity => {
            entity.toView('customer_totals');
            entity.property(row => row.customerId)
                .hasColumnName('customer_id').hasColumnType('text').isRequired();
            entity.property(row => row.total).hasColumnType('integer').isRequired();
            entity.hasOne(ReportCustomer, row => row.customer)
                .withMany()
                .hasForeignKey(row => row.customerId);
        });
    }
}

describe('keyless entity mappings', () => {
    it('materializes every row as a distinct untracked entity', async () => {
        const db = createContext();
        KeylessContext.connection.queueResult({
            rows: [
                { region: 'west', total: 10 },
                { region: 'west', total: 10 },
            ],
            rowCount: 2,
        });

        const rows = await db.reports.toArray();

        expect(rows).toHaveLength(2);
        expect(rows[0]).not.toBe(rows[1]);
        expect(rows[0]).toMatchObject({ region: 'west', total: 10 });
        expect(db.changeTracker.entries()).toEqual([]);
    });

    it('rejects tracking, key lookup, and set-based writes', async () => {
        const db = createContext();

        expect(() => db.reports.add(new SalesReport()))
            .toThrow('add() is not supported for keyless entity \'SalesReport\'');
        await expect(db.reports.find('west'))
            .rejects.toThrow('find() is not supported for keyless entity \'SalesReport\'');
        await expect(db.reports.where(row => row.region.eq('west')).executeDelete())
            .rejects.toThrow('executeDelete() is not supported for keyless entity \'SalesReport\'');
    });

    it('excludes views from schema DDL and creates keyless tables without a primary key', () => {
        const db = createContext();
        const model = contextModel(db);
        const sql = db.database.createScript();

        expect(sql).not.toContain('sales_report');
        expect(sql).toContain('create table if not exists "import_rows"');
        expect(sql).not.toContain('primary key');
        expect(model.toSnapshot().entities).toEqual(expect.arrayContaining([
            expect.objectContaining({ entityName: 'SalesReport', isKeyless: true, isView: true }),
            expect.objectContaining({ entityName: 'ImportRow', isKeyless: true }),
        ]));
    });

    it('loads keyed principals for keyless dependent rows', async () => {
        KeylessRelationshipContext.connection =
            new RecordingDatabaseConnection();
        const db = KeylessRelationshipContext.create();
        KeylessRelationshipContext.connection.queueResult({
            rows: [{ customer_id: 'c1', total: 42 }],
            rowCount: 1,
        });
        KeylessRelationshipContext.connection.queueResult({
            rows: [{ id: 'c1', name: 'Ada' }],
            rowCount: 1,
        });

        const totals = await db.totals
            .include(row => row.customer)
            .toArray();

        expect(totals[0]?.customer).toMatchObject({
            id: 'c1',
            name: 'Ada',
        });
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.changeTracker.entries()[0]?.entity)
            .toBeInstanceOf(ReportCustomer);
    });

    it('keeps table/view mapping transitions outside automatic migration ownership', () => {
        const table = contextModel(createContext()).toSnapshot();
        const view = {
            ...table,
            entities: table.entities.map(entity => entity.entityName === 'ImportRow'
                ? { ...entity, isView: true }
                : entity),
        };

        expect(diffModelSnapshots(table, view).operations).toEqual([]);
        expect(diffModelSnapshots(view, table).operations).toEqual([]);
    });

    it('lets a later table mapping undo only view-implied keylessness', () => {
        const tableModel = new ModelBuilderImplementation().entity(SalesReport, entity => {
            entity.toView('sales_report');
            entity.toTable('sales');
            entity.hasKey(row => row.region);
            entity.property(row => row.region).hasColumnType('text');
        }).build();
        expect(tableModel.getEntity(SalesReport)).toMatchObject({
            isView: false,
            isKeyless: false,
            tableName: 'sales',
        });

        const keylessTable = new ModelBuilderImplementation().entity(ImportRow, entity => {
            entity.hasNoKey();
            entity.toView('import_view');
            entity.toTable('import_rows');
            entity.property(row => row.value).hasColumnType('text');
        }).build();
        expect(keylessTable.getEntity(ImportRow)).toMatchObject({
            isView: false,
            isKeyless: true,
        });
    });
});

describe('keyless db pull', () => {
    const snapshot: DatabaseSchemaSnapshot = {
        schemas: [{
            name: 'app',
            tables: [{
                schemaName: 'app',
                tableName: 'audit_log',
                columns: [{ name: 'message', ordinal: 1, storeType: 'text', isNullable: false }],
                indexes: [],
                foreignKeys: [],
            }, {
                schemaName: 'app',
                tableName: 'current_totals',
                objectType: 'view',
                columns: [{ name: 'total', ordinal: 1, storeType: 'integer', isNullable: false }],
                indexes: [],
                foreignKeys: [],
            }],
        }],
    };

    it('emits faithful read-only mappings and flags the keyless table for review', async () => {
        const result = generateDbPullCodeWithDiagnostics(snapshot);
        const context = result.files.find(file => file.path.endsWith('db-context.ts'))?.contents ?? '';

        expect(context).toContain('entity.toTable("audit_log", "app");\n      entity.hasNoKey();');
        expect(context).toContain('entity.toView("current_totals", "app");');
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.category).toBe('table');
        expect(result.diagnostics[0]?.message)
            .toContain('"app"."audit_log" has no primary key');
        expect(compileGeneratedFiles(snapshot)).toEqual([]);

        const generated = await createGeneratedModelSnapshot(snapshot);
        expect(generated.entities).toEqual(expect.arrayContaining([
            expect.objectContaining({ entityName: 'AuditLog', isKeyless: true }),
            expect.objectContaining({ entityName: 'CurrentTotal', isKeyless: true, isView: true }),
        ]));
    });
});
import { contextModel } from './support/public-api-internals';
