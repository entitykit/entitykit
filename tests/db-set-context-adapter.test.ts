import { EntityState } from '../packages/core/src';
import { DbContextOptionsBuilder } from '../packages/core/src/core/context-options/db-context-options-builder';
import { createDbSetContextAdapter } from '../packages/core/src/core/db-set-context-adapter';
import { createQueryFilterOperation } from '../packages/core/src/core/query-filter-operation';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { createQueryModel } from '../packages/core/src/query/query-model';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class Row {
    public id = 1;
}

type Services = Parameters<typeof createDbSetContextAdapter>[0];
type MutableServices = { -readonly [Key in keyof Services]: Services[Key] };

function fixture(tenant: string): {
    services: MutableServices;
    database: RecordingDatabaseConnection;
    reader: { readValue: (value: unknown) => unknown };
    options: ReturnType<Services['options']>;
    model: ReturnType<Services['model']>;
    operation: ReturnType<Services['beginQueryOperation']>;
} {
    const database = new RecordingDatabaseConnection();
    const reader = { readValue: (value: unknown) => value };
    const options = new DbContextOptionsBuilder()
        .useConnection(database, { valueReader: reader }).build();
    const model = new ModelBuilder().entity(Row, entity => {
        entity.toTable('rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
    }).build();
    const operation = createQueryFilterOperation(() => tenant, false, (_tenant, _bound, _metadata, query) => query);
    const services: MutableServices = {
        options: jest.fn(() => options),
        database: jest.fn(() => database),
        model: jest.fn(() => model),
        changeTracker: new ChangeTracker(),
        assertCanQuery: jest.fn(),
        assertStateUsable: jest.fn(),
        applyQueryFilters: (_metadata, query) => query,
        beginQueryOperation: jest.fn(() => operation),
        currentTenantIdForWrites: jest.fn(() => tenant),
        allowsCrossTenantAccess: jest.fn(() => false),
        registerTransactionState: jest.fn(),
        markStateRestorationFailure: jest.fn(),
        loadNavigation: jest.fn(async () => Promise.resolve(tenant)),
    };
    return { services, database, reader, options, model, operation };
}

describe('DbSet context adapter ownership', () => {
    it('resolves live runtime services lazily with their original callback receiver', () => {
        const first = fixture('first');
        const adapter = createDbSetContextAdapter(first.services);
        expect(first.services.options).not.toHaveBeenCalled();
        expect(first.services.database).not.toHaveBeenCalled();
        expect(first.services.model).not.toHaveBeenCalled();
        expect(adapter.options).toBe(first.options);
        expect(adapter.dialect).toBe(first.options.dialect);
        expect(adapter.valueReader).toBe(first.reader);
        expect(adapter.database).toBe(first.database);
        expect(adapter.modelMetadata).toBe(first.model);

        const second = fixture('second');
        first.services.options = function () {
            expect(this).toBe(first.services);
            return second.options;
        };
        first.services.database = function () {
            expect(this).toBe(first.services);
            return second.database;
        };
        first.services.model = function () {
            expect(this).toBe(first.services);
            return second.model;
        };
        expect(adapter.options).toBe(second.options);
        expect(adapter.dialect).toBe(second.options.dialect);
        expect(adapter.valueReader).toBe(second.reader);
        expect(adapter.database).toBe(second.database);
        expect(adapter.modelMetadata).toBe(second.model);
    });

    it('captures function slots and tracker independently for each set', async () => {
        const first = fixture('first');
        const second = fixture('second');
        const adapter = createDbSetContextAdapter(first.services);
        const captured = { ...first.services };
        const keys = [
            'changeTracker', 'assertCanQuery', 'assertStateUsable', 'applyQueryFilters',
            'beginQueryOperation', 'currentTenantIdForWrites', 'allowsCrossTenantAccess',
            'registerTransactionState', 'markStateRestorationFailure', 'loadNavigation',
        ] as const;
        for (const key of keys) {
            Object.defineProperty(first.services, key, { value: second.services[key] });
            expect(Object.getOwnPropertyDescriptor(adapter, key)?.value).toBe(captured[key]);
        }
        const later = createDbSetContextAdapter(first.services);
        for (const key of keys) expect(Object.getOwnPropertyDescriptor(later, key)?.value).toBe(second.services[key]);
        expect(adapter.currentTenantIdForWrites()).toBe('first');
        expect(later.currentTenantIdForWrites()).toBe('second');
        expect(adapter.allowsCrossTenantAccess()).toBe(false);
        expect(adapter.beginQueryOperation()).toBe(first.operation);
        const query = createQueryModel(Row);
        const metadata = first.model.getEntity(Row);
        expect(adapter.applyQueryFilters(metadata, query)).toBe(query);
        const entry = adapter.changeTracker.track(new Row(), metadata, EntityState.Unchanged);
        expect(later.changeTracker.entry(entry.entity)).toBeUndefined();
        await expect(adapter.loadNavigation(entry, 'owner')).resolves.toBe('first');
        expect(captured.loadNavigation).toHaveBeenCalledWith(entry, 'owner');
        adapter.assertCanQuery('query');
        adapter.assertStateUsable?.('state');
        expect(captured.assertCanQuery).toHaveBeenCalledWith('query');
        expect(captured.assertStateUsable).toHaveBeenCalledWith('state');
        const commit = jest.fn();
        const rollback = jest.fn();
        adapter.registerTransactionState(commit, rollback);
        expect(captured.registerTransactionState).toHaveBeenCalledWith(commit, rollback);
        const error = new Error('restore');
        adapter.markStateRestorationFailure(error);
        expect(captured.markStateRestorationFailure).toHaveBeenCalledWith(error);
    });

    it('preserves runtime service failures and context isolation', () => {
        const first = fixture('first');
        const second = fixture('second');
        const adapter = createDbSetContextAdapter(first.services);
        const other = createDbSetContextAdapter(second.services);
        const error = new Error('disposed');
        first.services.database = () => {
            throw error;
        };
        first.services.options = () => {
            throw error;
        };
        first.services.model = () => {
            throw error;
        };
        expect(() => adapter.database).toThrow(error);
        expect(() => adapter.options).toThrow(error);
        expect(() => adapter.dialect).toThrow(error);
        expect(() => adapter.valueReader).toThrow(error);
        expect(() => adapter.modelMetadata).toThrow(error);
        expect(other.database).toBe(second.database);
        expect(other.options).toBe(second.options);
        expect(other.modelMetadata).toBe(second.model);
    });
});
