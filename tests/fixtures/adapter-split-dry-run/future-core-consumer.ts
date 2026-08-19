import type {
    DbContextOptionsBuilder,
    ModelBuilder } from './future-core-package';
import {
    DbContext,
    Migration,
    MigrationBuilder,
    type DatabaseConnection,
    type DatabaseProviderConnectionConfig,
    type DatabaseProviderServices,
    type DatabaseSchemaIntrospector,
    type DatabaseSchemaSnapshot,
    type MigrationSqlDialect,
    type RuntimeDiagnosticEvent,
    type SqlDialect,
    type SqlStatement,
} from './future-core-package';
// The test doubles ship as their own package, so a consumer names them
// separately from core. Core itself never imports them.
import { RecordingDatabaseConnection } from './future-testing-package';

class FutureCoreUser {
    public id!: string;
}

class FutureCoreContext extends DbContext {
    public users = this.set(FutureCoreUser);

    constructor(private readonly provider: DatabaseProviderServices) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useProvider(this.provider, {
                connectionString: 'adapter-split://core',
                connection: new RecordingDatabaseConnection(),
            })
            .useDiagnostics((event: RuntimeDiagnosticEvent) => {
                void event;
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FutureCoreUser, entity => {
            entity.toTable('future_core_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        });
    }
}

class FutureCoreMigration extends Migration {
    public readonly id = '20260624120000_FutureCore';
    public readonly name = 'FutureCore';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('future_core_users', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }
}

export const futureCoreSqlDialect: SqlDialect = {
    name: 'future-core-sql',
    quoteIdentifier(identifier: string): string {
        return `"${identifier.replace(/"/g, '""')}"`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers
            .filter((identifier): identifier is string => identifier !== undefined)
            .map(identifier => this.quoteIdentifier(identifier))
            .join('.');
    },
    parameter(index: number): string {
        return `$${String(index)}`;
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return 'false';
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
};

export const futureCoreMigrationDialect: MigrationSqlDialect = {
    name: 'future-core-migrations',
    sql: futureCoreSqlDialect,
    createMigrationHistoryTableStatement(): SqlStatement {
        return {
            text: 'create table if not exists "future_core_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null)',
            values: [],
        };
    },
    selectMigrationHistoryStatement(): SqlStatement {
        return {
            text: 'select "id", "name", "checksum", "entitykit_version" from "future_core_migrations" order by "id"',
            values: [],
        };
    },
    insertMigrationHistoryStatement(
        migration: Migration,
        checksum: string,
    ): SqlStatement {
        return {
            text: 'insert into "future_core_migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)',
            values: [migration.id, migration.name, checksum, 'future-core'],
        };
    },
    deleteMigrationHistoryStatement(migration: Migration): SqlStatement {
        return {
            text: 'delete from "future_core_migrations" where "id" = $1',
            values: [migration.id],
        };
    },
};

export function createFutureCoreProvider(
    connection: RecordingDatabaseConnection = new RecordingDatabaseConnection(),
    introspector?: DatabaseSchemaIntrospector,
): DatabaseProviderServices {
    return {
        name: 'future-core-provider',
        dialect: futureCoreSqlDialect,
        migrationDialect: futureCoreMigrationDialect,
        createMigrationBuilder: () => new MigrationBuilder(futureCoreSqlDialect),
        createConnection(config: DatabaseProviderConnectionConfig): DatabaseConnection {
            const configured = typeof config === 'string' ? undefined : config.connection;
            return configured instanceof RecordingDatabaseConnection ? configured : connection;
        },
        createSchemaIntrospector: introspector ? () => introspector : undefined,
    };
}

export function createFutureCoreContext(provider: DatabaseProviderServices = createFutureCoreProvider()): FutureCoreContext {
    return new FutureCoreContext(provider);
}

export function createFutureCoreMigration(): Migration {
    return new FutureCoreMigration();
}

export const futureCoreEmptySchema: DatabaseSchemaSnapshot = {
    schemas: [],
};
