import {
    compileModel, DbContext, type DbContextOptionsBuilder, type ModelBuilder,
    type RuntimeDiagnosticEvent, type CompiledModel, type DatabaseOperationOptions, type DatabaseQueryResult,
    type SqlStatement,
} from '../packages/core/src';
import type { StoreValueReader } from '../packages/core/src/adapter';
import { createSqliteDataSource, sqliteDialect } from '../packages/sqlite/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { projectionMapping, ProjectionRow } from './support/compiled-projection';
import { requireDefined } from './support/require-defined';
import { ProjectedQueryable as InternalProjectedQueryable } from '../packages/core/src/query/queryable-projected';
import type { ProjectionExpression } from '../packages/core/src/query/projection-expression-types';

let compiled: CompiledModel;
beforeEach(() => {
    compiled = compileModel(projectionMapping, { provider: 'custom', dialect: 'sqlite' });
});
class Connection extends RecordingDatabaseConnection {
    public beforeReturn?: () => void | Promise<void>;
    public override async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement, options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        const result = await super.query<TRow>(statement, options);
        await this.beforeReturn?.();return result;
    }
}
class Context extends DbContext {
    public rows = this.set(ProjectionRow);
    public readonly events: RuntimeDiagnosticEvent[] = [];
    public onDiagnostic?: (event: RuntimeDiagnosticEvent) => void;
    constructor(
        private readonly connection: Connection,
        private readonly compiledMode = true,
        private readonly reader?: StoreValueReader,
    ) {
        super();
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, { provider: 'custom', dialect: sqliteDialect, valueReader: this.reader });
        if (this.compiledMode) options.useCompiledModel(compiled);
        options.useDiagnostics(event => {
            this.events.push(event);this.onDiagnostic?.(event);
        });
    }
    protected override model(model: ModelBuilder): void {
        projectionMapping(model);
    }
}
const typedReader: StoreValueReader = { readValue: (value, type) => `${type}:${String(value)}` };

// Inspect the internal snapshot whose item references experimental callers can retain.
function retainedItem(query: object): ProjectionExpression {
    if (!(query instanceof InternalProjectedQueryable)) throw new Error('Expected an internal projected query');
    return requireDefined(query.toQueryModel().projection)[0];
}

describe('compiled projection execution ownership', () => {
    it('keeps SQL and decoding aligned when a compile listener mutates retained fields', async () => {
        const connection = new Connection(), db = new Context(connection, true, typedReader);
        const query = db.rows.select(row => ({ result: row.id }));
        const item = retainedItem(query);
        db.onDiagnostic = event => {
            if (event.kind === 'queryPlan' && event.phase === 'compile') {
                Reflect.set(item, 'alias', 'changed');Reflect.set(item, 'propertyName', 'label');
                Reflect.set(item, 'path', ['nested', 'changed']);
            }
        };
        connection.queueResult({ rows: [{ result: 7, changed: 'wrong' }] });
        try {
            expect(await query.toArray()).toEqual([{ result: 'integer:7' }]);
            expect(connection.statements[0]).toEqual({ text: 'select "id" as "result" from "projection_rows"', values: [] });
            expect(db.changeTracker.entries()).toHaveLength(0);
            expect(db.events.filter(event => event.kind === 'queryPlan').map(event => event.phase)).toEqual(['compile', 'execute']);
        } finally {
            await db.dispose();
        }
    });

    it('owns the projection while awaiting the provider, with fresh plans on subsequent executions', async () => {
        const connection = new Connection(), db = new Context(connection, true, typedReader);
        const query = db.rows.select(row => ({ result: row.id }));
        const item = retainedItem(query);
        let release!: () => void, started!: () => void;
        const waiting: Promise<void> = new Promise(resolve => {
            release = resolve;
        });
        const entered: Promise<void> = new Promise(resolve => {
            started = resolve;
        });
        connection.beforeReturn = async () => {
            started();return waiting;
        };
        connection.queueResult({ rows: [{ result: 1, changed: 'ignored' }] });
        try {
            const pending = query.toArray();await entered;
            Reflect.set(item, 'alias', 'changed');Reflect.set(item, 'propertyName', 'label');release();
            expect(await pending).toEqual([{ result: 'integer:1' }]);
            connection.beforeReturn = undefined;
            connection.queueResult({ rows: [{ changed: 'next' }] });
            expect(await query.toArray()).toEqual([{ changed: 'text:next' }]);
            expect(connection.statements[1].text).toBe('select "label" as "changed" from "projection_rows"');
        } finally {
            release();await db.dispose();
        }
    });

    it('retains the dynamic mapper for mutable mappings without opt-in', async () => {
        const connection = new Connection(), db = new Context(connection, false, typedReader);
        const query = db.rows.select(row => ({ result: row.id }));
        const item = retainedItem(query);
        db.onDiagnostic = event => {
            if (event.kind === 'queryPlan' && event.phase === 'compile') {
                Reflect.set(item, 'propertyName', 'label');
            }
        };
        connection.queueResult({ rows: [{ result: 7 }] });
        try {
            expect(await query.toArray()).toEqual([{ result: 'text:7' }]);
        } finally {
            await db.dispose();
        }
    });

    it('keeps unknown-field failure inside compile diagnostics without executing SQL', async () => {
        const connection = new Connection(), db = new Context(connection);
        const query = db.rows.select(row => ({ result: row.id }));
        Reflect.set(retainedItem(query), 'propertyName', 'missing');
        try {
            await expect(query.toArray()).rejects.toThrow('Property \'missing\' is not configured');
            expect(connection.statements).toEqual([]);
            const events = db.events.filter(event => event.kind === 'queryPlan');
            expect(events).toHaveLength(1);expect(events[0].phase).toBe('compile');
            expect(events[0].error).toEqual({ name: 'Error', message: 'Error details redacted.' });
        } finally {
            await db.dispose();
        }
    });

    it('reports reader failures during execute and leaves the context retryable', async () => {
        const connection = new Connection();let fail = true;
        const error = new Error('conversion failed');
        const db = new Context(connection, true, { readValue: value => {
            if (fail) throw error;return value;
        } });
        const query = db.rows.select(row => ({ id: row.id, label: row.label }));
        connection.queueResult({ rows: [{ id: 1, label: 'before' }] });
        try {
            await expect(query.toArray()).rejects.toBe(error);
            const failures = db.events.filter(event => event.kind === 'queryPlan' && event.phase === 'execute');
            expect(failures).toHaveLength(1);expect(failures[0]).toMatchObject({ error: { name: 'Error', message: 'Error details redacted.' } });
            fail = false;connection.queueResult({ rows: [{ id: 2, label: 'retry' }] });
            expect(await query.toArray()).toEqual([{ id: 2, label: 'retry' }]);
            expect(db.changeTracker.entries()).toHaveLength(0);
        } finally {
            await db.dispose();
        }
    });

    it('leaves nested and computed projections on the qualified legacy path', async () => {
        const connection = new Connection(), db = new Context(connection);
        connection.queueResult({ rows: [{ __entitykit_projection_0: 'value', upper: 'VALUE' }] });
        try {
            const rows = await db.rows.select((row, sql) => ({ nested: { value: row.label }, upper: sql.upper(row.label) })).toArray();
            expect(rows).toEqual([{ nested: { value: 'value' }, upper: 'VALUE' }]);
        } finally {
            await db.dispose();
        }
    });

    it('preserves empty results without invoking the reader', async () => {
        const readValue = jest.fn(), connection = new Connection(), db = new Context(connection, true, { readValue });
        try {
            expect(await db.rows.select(row => ({ id: row.id })).toArray()).toEqual([]);
            expect(readValue).not.toHaveBeenCalled();
        } finally {
            await db.dispose();
        }
    });

    it('executes real SQLite projections with aliases, typed nulls and isolated results', async () => {
        const handle = compileModel(projectionMapping, { provider: 'sqlite' });
        class SqliteContext extends DbContext {
            public rows = this.set(ProjectionRow);
            protected override configure(options: DbContextOptionsBuilder): void {
                options.useCompiledModel(handle);
            }
        }
        const source = createSqliteDataSource(':memory:'), db = source.createContext(SqliteContext);
        try {
            await db.database.connection.query({ text: 'create table projection_rows (id integer primary key, label text not null, timestamp text); insert into projection_rows values (1, \'one\', \'2020-01-02T00:00:00.000Z\'), (2, \'two\', null)', values: [] });
            const query = db.rows.orderBy(row => row.id).select(row => ({ id: row.id, ['__proto__']: row.label, time: row.timestamp }));
            const first = await query.toArray(), second = await query.toArray();
            expect(first).toEqual([{ id: 1, ['__proto__']: 'one', time: new Date('2020-01-02T00:00:00.000Z') }, { id: 2, ['__proto__']: 'two', time: null }]);
            expect(first).toEqual(second);expect(first[0]).not.toBe(second[0]);expect(first[0].time).not.toBe(second[0].time);
            expect(Object.getPrototypeOf(first[0])).toBe(Object.prototype);expect(Object.hasOwn(first[0], '__proto__')).toBe(true);
            expect(db.changeTracker.entries()).toHaveLength(0);
        } finally {
            await db.dispose();await source.dispose();
        }
    });
});
