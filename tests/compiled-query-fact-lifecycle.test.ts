import {
    compileModel, DbContext, type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class FactRow {
    public id = 0;
    public version = 0;
    public document = { nested: [0] };
    public timestamp = new Date(0);
    public payload = new Uint8Array([0]);
}

function mapping(model: ModelBuilder): void {
    model.entity(FactRow, entity => {
        entity.toTable('fact_rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
        entity.property(row => row.document).hasColumnType('json').isRequired();
        entity.property(row => row.timestamp).hasColumnType('timestamp').isRequired();
        entity.property(row => row.payload).hasColumnType('blob').isRequired();
    });
}

describe('query facts through public attachment and recovery', () => {
    it.each([false, true])('snapshots attachment-time values and isolates database recovery, compiled=%p', async compiled => {
        const handle = compiled ? compileModel(mapping, { provider: 'sqlite' }) : undefined;
        class Context extends DbContext {
            public rows = this.set(FactRow);
            protected override configure(options: DbContextOptionsBuilder): void {
                if (handle) options.useCompiledModel(handle);
            }
            protected override model(model: ModelBuilder): void {
                mapping(model);
            }
        }
        const source = createSqliteDataSource(':memory:');
        const db = source.createContext(Context);
        try {
            await db.database.connection.query({
                text: 'create table fact_rows (id integer primary key, version integer not null, document text not null, timestamp text not null, payload blob not null)', values: [],
            });
            await db.database.connection.query({
                text: 'insert into fact_rows values (?, ?, ?, ?, ?)',
                values: [1, 1, '{"nested":[1]}', '2020-01-01T00:00:00.000Z', new Uint8Array([1, 2])],
            });
            const row = await db.rows.asNoTracking().single();
            row.document.nested.push(2);
            row.timestamp.setUTCFullYear(2021);
            row.payload[0] = 3;
            db.rows.attach(row);
            const entry = requireDefined(db.entry(row));
            expect(entry.originalValues.document).toEqual({ nested: [1, 2] });
            expect(entry.originalValues.timestamp).toEqual(new Date('2021-01-01T00:00:00.000Z'));
            expect(entry.originalValues.payload).toEqual(new Uint8Array([3, 2]));
            expect(await db.saveChanges()).toBe(0);
            row.document.nested.push(4);
            row.timestamp.setUTCFullYear(2022);
            row.payload[0] = 5;
            expect(entry.originalValues.document).toEqual({ nested: [1, 2] });
            expect(await db.saveChanges()).toBe(1);

            await db.database.connection.query({
                text: 'update fact_rows set version = ?, document = ?, timestamp = ?, payload = ? where id = ?',
                values: [7, '{"nested":[8,9]}', '2030-01-01T00:00:00.000Z', new Uint8Array([6, 7]), 1],
            });
            const databaseValues = requireDefined(await entry.getDatabaseValues());
            expect(databaseValues.get('version')).toBe(7);
            expect(databaseValues.get('document')).toEqual({ nested: [8, 9] });
            databaseValues.get('document').nested.push(99);
            databaseValues.get('timestamp').setUTCFullYear(2040);
            databaseValues.get('payload')[0] = 99;
            expect(databaseValues.get('document')).toEqual({ nested: [8, 9] });
            expect(databaseValues.get('timestamp')).toEqual(new Date('2030-01-01T00:00:00.000Z'));
            expect(databaseValues.get('payload')).toEqual(new Uint8Array([6, 7]));
            expect(row.document).toEqual({ nested: [1, 2, 4] });
            expect(row.timestamp.getUTCFullYear()).toBe(2022);
            expect(row.payload[0]).toBe(5);

            await entry.reload();
            expect(row.version).toBe(7);
            expect(row.document).toEqual({ nested: [8, 9] });
            expect(row.timestamp).toEqual(new Date('2030-01-01T00:00:00.000Z'));
            expect(row.payload).toEqual(new Uint8Array([6, 7]));
            expect(await db.saveChanges()).toBe(0);
        } finally {
            await db.dispose();
            await source.dispose();
        }
    });
});
