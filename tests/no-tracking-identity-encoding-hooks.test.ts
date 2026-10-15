import { DbContext, compileModel, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';

describe('no-tracking identity encoding across constructor callbacks', () => {
    it.each([false, true])('keeps repeated SQLite rows identical after array JSON changes, compiled=%p', async compiled => {
        await checkIdentity(compiled, 'array');
    });
    it.each([false, true])('keeps repeated SQLite rows identical after object JSON changes, compiled=%p', async compiled => {
        await checkIdentity(compiled, 'object');
    });
    it.each([false, true])('keeps repeated SQLite rows identical after name coercion changes, compiled=%p', async compiled => {
        await checkIdentity(compiled, 'prefix');
    });
    it.each([false, true])('keeps ordinary repeated SQLite rows identical, compiled=%p', async compiled => {
        await checkIdentity(compiled, 'none');
    });
});

async function checkIdentity(compiled: boolean, change: 'array' | 'object' | 'prefix' | 'none'): Promise<void> {
    const prototype = change === 'array' ? Array.prototype : Object.prototype;
    const member = change === 'prefix' ? 'toString' : 'toJSON';
    const original = Object.getOwnPropertyDescriptor(prototype, member);
    const restore = (): void => {
        if (original) Object.defineProperty(prototype, member, original);
        else Reflect.deleteProperty(prototype, member);
    };
    let constructed = 0;
    class Row {
        public id = 0;
        public name = '';
        constructor() {
            if (++constructed === 2 && change !== 'none') {
                Object.defineProperty(prototype, member, {
                    configurable: true, value: () => 'changed-identity',
                });
            }
        }
    }
    // Exercise the public builder with a configurable constructor name; no
    // private metadata mutation or replacement of ModelBuilder.build is needed.
    if (change === 'prefix') Object.defineProperty(Row, 'name', { configurable: true, value: {} });
    const mapping = (model: ModelBuilder): void => {
        model.entity(Row, entity => {
            entity.toTable('encoding_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    };
    const handle = compiled ? compileModel(mapping, { provider: 'sqlite' }) : undefined;
    class Context extends DbContext {
        public rows = this.set(Row);
        protected override configure(options: DbContextOptionsBuilder): void {
            if (handle) options.useCompiledModel(handle);
        }
        protected override model(model: ModelBuilder): void {
            mapping(model);
        }
    }
    const source = createSqliteDataSource(':memory:'), db = source.createContext(Context);
    const sql = async (text: string): Promise<void> => {
        await db.database.connection.query({ text, values: [] });
    };
    const read = async (): Promise<Row[]> => {
        constructed = 0;
        try {
            return await db.rows.asNoTracking().orderBy(row => row.id).toArray();
        } finally {
            restore();
        }
    };
    try {
        // Deliberate repeated physical rows exercise query-local identity.
        await sql('create table encoding_rows (id integer not null, name text not null)');
        await sql('insert into encoding_rows values (1,\'one\'),(2,\'two\'),(2,\'two\')');
        const first = await read();
        expect(first.map(row => [row.id, row.name])).toEqual([[1, 'one'], [2, 'two'], [2, 'two']]);
        expect(first[1]).toBe(first[2]);
        expect(constructed).toBe(2);
        expect(db.changeTracker.entries()).toEqual([]);
        expect(materializedPersistenceFacts(first[1])).toEqual({
            values: { id: 2, name: 'two' }, boundValues: { id: 2, name: 'two' },
        });
        const second = await read();
        expect(second[1]).toBe(second[2]);
        expect(second[1]).not.toBe(first[1]);
        expect(constructed).toBe(2);
    } finally {
        restore();
        await db.dispose();await source.dispose();
    }
}
