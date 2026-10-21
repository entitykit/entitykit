import { join } from 'node:path';
import {
    compileModel, DbContext,
    type CompiledModel, type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import type { DatabaseDataSource } from '../packages/core/src/adapter';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { DbContextOptionsBuilder as InternalOptionsBuilder } from '../packages/core/src/core/context-options/db-context-options-builder';
import { createManagedTempDirectory } from './support/managed-temp-directory';

class Row {
    public id = 0; public tenantId = ''; public label = ''; public version = 1;
}
function mapping(model: ModelBuilder): void {
    model.entity(Row, entity => {
        entity.toTable('rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.tenantId).hasColumnType('text').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
        entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
        entity.tenantKey(row => row.tenantId);
    });
}

class Context extends DbContext {
    public rows = this.set(Row);
    public configurations = 0;
    public modelCalls = 0;
    public saves = 0;
    public rejectConfiguration = false;
    constructor(source: DatabaseDataSource, private readonly compiled: CompiledModel, public tenant: string) {
        super(source);
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        this.configurations++;
        options.useCompiledModel(this.compiled).useTenantScope(() => this.tenant);
        options.useSaveInterceptor({ savedChanges: () => {
            this.saves++;
        } });
        if (this.rejectConfiguration) throw new Error('configuration refused');
    }
    protected override model(model: ModelBuilder): void {
        this.modelCalls++;mapping(model);
    }
}

describe('compiled context initialization', () => {
    it('shares mapping while keeping entities, tenant callbacks, trackers, saves and leases independent', async () => {
        const compiled = compileModel(mapping, { provider: 'sqlite' });
        const source = createSqliteDataSource(join(createManagedTempDirectory('compiled-model-'), 'rows.db'), { maxIdleConnections: 2 });
        const first = source.createContext(Context, compiled, 'a');
        const second = source.createContext(Context, compiled, 'b');
        try {
            await first.database.connection.query({ text: 'create table rows (id integer primary key, tenantId text not null, label text not null, version integer not null)', values: [] });
            await first.database.connection.query({ text: 'insert into rows values (1, \'a\', \'first\', 1), (2, \'b\', \'second\', 1)', values: [] });
            const [a] = await first.rows.asNoTracking().toArray();
            const [b] = await second.rows.asNoTracking().toArray();
            expect([a.id, b.id]).toEqual([1, 2]);expect(a).not.toBe(b);
            expect(first.changeTracker.entries()).toHaveLength(0);expect(second.changeTracker.entries()).toHaveLength(0);
            first.rows.attach(a);a.label = 'saved';
            expect(await first.saveChanges()).toBe(1);expect(a.version).toBe(2);
            expect(first.saves).toBe(1);expect(second.saves).toBe(0);
            expect(second.changeTracker.entries()).toHaveLength(0);
            second.tenant = 'a';
            const fresh = await second.rows.asNoTracking().single();
            expect(fresh).not.toBe(a);expect(fresh.label).toBe('saved');
            const failure = new Error('rollback');
            await expect(first.transaction(async () => {
                a.label = 'retry';expect(await first.saveChanges()).toBe(1);throw failure;
            })).rejects.toBe(failure);
            expect(a.version).toBe(2);
            expect((await second.rows.asNoTracking().single()).label).toBe('saved');
            expect(await first.saveChanges()).toBe(1);expect(a.version).toBe(3);
            expect((await second.rows.asNoTracking().single()).label).toBe('retry');
            expect(first.configurations).toBe(1);expect(second.configurations).toBe(1);
            expect(first.modelCalls).toBe(0);expect(second.modelCalls).toBe(0);
            await expect(source.dispose()).rejects.toThrow('lease');
        } finally {
            await first.dispose();await second.dispose();await source.dispose();
        }
    });

    it.each([
        { provider: 'postgres', dialect: 'sqlite' },
        { provider: 'sqlite', dialect: 'postgres' },
    ])('refuses incompatible handles before acquiring a lease: %p', async options => {
        const compiled = compileModel(mapping, options);
        const source = createSqliteDataSource(':memory:');
        const acquire = jest.spyOn(source, 'createConnection');
        expect(() => source.createContext(Context, compiled, 'a')).toThrow('Compiled model requires');
        expect(acquire).not.toHaveBeenCalled();
        return source.dispose();
    });

    it('still requires a tenant provider for a shared tenant mapping', async () => {
        const compiled = compileModel(mapping, { provider: 'sqlite' });
        class MissingTenant extends DbContext {
            protected override configure(options: DbContextOptionsBuilder): void {
                options.useCompiledModel(compiled);
            }
        }
        const source = createSqliteDataSource(':memory:');
        const acquire = jest.spyOn(source, 'createConnection');
        expect(() => source.createContext(MissingTenant)).toThrow('no tenant scope');
        expect(acquire).not.toHaveBeenCalled();await source.dispose();
    });

    it('retries failed configuration without corrupting a handle or leaking a lease', async () => {
        const compiled = compileModel(mapping, { provider: 'sqlite' });
        const source = createSqliteDataSource(':memory:');
        const acquire = jest.spyOn(source, 'createConnection');
        const context = new Context(source, compiled, 'a');context.rejectConfiguration = true;
        expect(() => context.rows.asNoTracking()).toThrow('configuration refused');
        expect(acquire).not.toHaveBeenCalled();
        context.rejectConfiguration = false;
        context.rows.asNoTracking();
        expect(context.changeTracker.entries()).toHaveLength(0);
        expect(acquire).toHaveBeenCalledTimes(1);expect(context.configurations).toBe(2);expect(context.modelCalls).toBe(0);
        await context.dispose();await source.dispose();
    });

    it('refuses duplicate selection before connection acquisition', () => {
        const handle = compileModel(mapping, { provider: 'sqlite' });
        const options = new InternalOptionsBuilder().useCompiledModel(handle);
        expect(() => options.useCompiledModel(handle)).toThrow('already selected');
    });

    it('preserves dynamic instance-dependent mappings without opt-in', async () => {
        class Dynamic extends DbContext {
            public rows = this.set(Row);
            constructor(source: DatabaseDataSource, private readonly table: string) {
                super(source);
            }
            protected override model(model: ModelBuilder): void {
                model.entity(Row, entity => {
                    entity.toTable(this.table).hasKey(row => row.id);
                    entity.property(row => row.id).hasColumnType('integer').isRequired();
                });
            }
        }
        const source = createSqliteDataSource(':memory:');
        const first = source.createContext(Dynamic, 'first'), second = source.createContext(Dynamic, 'second');
        try {
            expect(first.rows.asNoTracking().toSql().text).toContain('"first"');
            expect(second.rows.asNoTracking().toSql().text).toContain('"second"');
        } finally {
            await first.dispose();await second.dispose();await source.dispose();
        }
    });
});
