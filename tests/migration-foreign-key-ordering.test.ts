import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import {
    contextMigrations,
    MigrationBuilder,
    diffModelSnapshots,
    type ModelSnapshot,
} from '../packages/core/src/migrations/api';
import { sqliteDialect, sqliteProviderServices } from '../packages/sqlite/src';

const emptySnapshot: ModelSnapshot = { formatVersion: 1, entities: [] };

describe('migration operation ordering', () => {
    class Principal {
        public id!: string;
        public dependents?: Dependent[];
    }

    // Sorts before its principal, which exposed foreign keys being added before
    // the principal table existed when operations were grouped per entity.
    class Dependent {
        public id!: string;
        public principalId!: string;
        public principal?: Principal;
    }

    class OrderingContext extends DbContext {
        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
        }

        protected override model(model: ModelBuilder): void {
            model.entity(Principal, entity => {
                entity.toTable('principals');
                entity.hasKey(principal => principal.id);
                entity.property(principal => principal.id).hasColumnName('id').hasColumnType('text').isRequired();
            });
            model.entity(Dependent, entity => {
                entity.toTable('dependents');
                entity.hasKey(dependent => dependent.id);
                entity.property(dependent => dependent.id).hasColumnName('id').hasColumnType('text').isRequired();
                entity.property(dependent => dependent.principalId).hasColumnName('principal_id').hasColumnType('text').isRequired();
                entity.hasOne(Principal, dependent => dependent.principal)
                    .withMany(principal => principal.dependents)
                    .hasForeignKey(dependent => dependent.principalId);
            });
        }
    }

    function operations(
        from = emptySnapshot,
        to = contextMigrations(createContext()).createModelSnapshot(),
    ): ReturnType<typeof diffModelSnapshots>['operations'] {
        return diffModelSnapshots(from, to).operations;
    }

    function createContext(): OrderingContext {
        const db = OrderingContext.create();
        return db;
    }

    it('creates every table before adding any foreign key', () => {
        const kinds = operations().map(operation => operation.kind);
        expect(kinds.indexOf('addForeignKey')).toBeGreaterThan(kinds.lastIndexOf('createTable'));
    });

    it('drops every foreign key before dropping any table', () => {
        const current = contextMigrations(createContext()).createModelSnapshot();
        const kinds = operations(current, emptySnapshot).map(operation => operation.kind);
        const lastDropForeignKey = kinds.lastIndexOf('dropForeignKey');
        expect(lastDropForeignKey).toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf('dropTable')).toBeGreaterThan(lastDropForeignKey);
    });
});

describe('foreign key operations on providers that cannot alter constraints', () => {
    it('reports addForeignKey as unsupported by name', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        expect(() => builder.addForeignKey({
            name: 'fk_allocations_order_lines',
            tableName: 'allocations',
            columns: ['order_id', 'line_number'],
            principalTableName: 'order_lines',
            principalColumns: ['order_id', 'line_number'],
        })).toThrow('Migration operation \'addForeignKey\' is not supported by provider \'sqlite\'.');
    });

    it('reports dropForeignKey as unsupported by name', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        expect(() => builder.dropForeignKey('allocations', 'fk_allocations_order_lines'))
            .toThrow('Migration operation \'dropForeignKey\' is not supported by provider \'sqlite\'.');
    });

    it('still allows Postgres to add and drop constraints', () => {
        const builder = new MigrationBuilder(sqliteDialect, { providerName: 'postgres' });
        expect(() => builder.addForeignKey({
            name: 'fk',
            tableName: 'a',
            columns: ['b_id'],
            principalTableName: 'b',
            principalColumns: ['id'],
        })).not.toThrow();
        expect(() => builder.dropForeignKey('a', 'fk')).not.toThrow();
    });
});
