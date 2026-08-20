import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../../packages/core/src';
import { DbContext, type RuntimeDiagnosticEvent } from '../../../packages/core/src';
import type {
    DatabaseConnection,
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
    DatabaseSchemaIntrospector,
    SqlDialect,
} from '../../../packages/core/src/adapter';
import { type DatabaseSchemaSnapshot } from '../../../packages/core/src/tooling';
import {
    Migration,
    MigrationBuilder,
    type MigrationSqlDialect,
} from '../../../packages/core/src/migrations/api';
import { RecordingDatabaseConnection } from '../../../packages/testing/src';

class AdapterBoundaryUser {
    public id!: string;
}

class AdapterBoundaryContext extends DbContext {
    public users = this.set(AdapterBoundaryUser);

    constructor(private readonly provider: DatabaseProviderServices) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useProvider(this.provider, {
                connectionString: 'adapter-boundary://core',
                connection: new RecordingDatabaseConnection(),
            })
            .useDiagnostics((event: RuntimeDiagnosticEvent) => {
                void event;
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AdapterBoundaryUser, entity => {
            entity.toTable('adapter_boundary_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        });
    }
}

class AdapterBoundaryMigration extends Migration {
    public readonly id = '20260601170000_AdapterBoundary';
    public readonly name = 'AdapterBoundary';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('adapter_boundary_users', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }
}

export function createCoreOnlyBoundaryContext(provider: DatabaseProviderServices): AdapterBoundaryContext {
    return new AdapterBoundaryContext(provider);
}

export function createCoreOnlyMigration(): Migration {
    return new AdapterBoundaryMigration();
}

export function createCoreOnlyProvider(
    dialect: SqlDialect,
    migrationDialect: MigrationSqlDialect,
    introspector?: DatabaseSchemaIntrospector,
): DatabaseProviderServices {
    return {
        name: 'adapter-boundary-core',
        dialect,
        migrationDialect,
        createMigrationBuilder: () => new MigrationBuilder(dialect),
        createConnection(config: DatabaseProviderConnectionConfig): DatabaseConnection {
            if (typeof config !== 'string' && config.connection instanceof RecordingDatabaseConnection) {
                return config.connection;
            }

            return new RecordingDatabaseConnection();
        },
        createSchemaIntrospector: introspector ? () => introspector : undefined,
    };
}

export const emptyAdapterBoundarySchema: DatabaseSchemaSnapshot = {
    schemas: [],
};
