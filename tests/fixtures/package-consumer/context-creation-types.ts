import './async-dispose-compat';
import { DbContext, type EntityKitContextFactory, type EntityKitDataSource, type SqliteConnectionConfig } from '@entitykit/core';
import type { DatabaseDataSource } from '@entitykit/core/adapter';
import { createSqliteDataSource } from '@entitykit/sqlite';
import { createPostgresDataSource } from '@entitykit/postgres';
import { createMySqlDataSource } from '@entitykit/mysql';

declare const sqlite: ReturnType<typeof createSqliteDataSource>;
declare const postgres: ReturnType<typeof createPostgresDataSource>;
declare const mysql: ReturnType<typeof createMySqlDataSource>;
class TenantContext extends DbContext {
    constructor(source: DatabaseDataSource, public readonly tenantId: string) { super(source); }
}
class DefaultContext extends DbContext {}
class OptionalContext extends DbContext {
    constructor(source: DatabaseDataSource, public readonly tenantId = 'north') { super(source); }
}
class VariadicContext extends DbContext {
    constructor(source: DatabaseDataSource, public readonly tenantId: string, ..._permissions: boolean[]) { super(source); }
}
class WrongSourceContext extends DbContext {
    constructor(public readonly input: string) { super(); }
}
class PrivateContext extends DbContext {
    private constructor(source: DatabaseDataSource) { super(source); }
}
class SqliteContext extends DbContext {
    constructor(source: EntityKitDataSource<SqliteConnectionConfig>, public readonly tenantId: string) { super(source); }
}

const tenant: TenantContext = sqlite.createContext(TenantContext, 'north');
const tenantId: string = tenant.tenantId;
void tenantId;
// @ts-expect-error the inherited generic static factory must not erase required constructor inputs
sqlite.createContext(TenantContext);
// @ts-expect-error constructor arguments retain their actual types
sqlite.createContext(TenantContext, 123);
// @ts-expect-error the constructor must accept a data source in its first position
sqlite.createContext(WrongSourceContext);
// @ts-expect-error contexts must expose a public constructor
sqlite.createContext(PrivateContext);
// @ts-expect-error undeclared constructor arguments are rejected
sqlite.createContext(TenantContext, 'north', true);
const defaultContext: DefaultContext = sqlite.createContext(DefaultContext);
void defaultContext;
// @ts-expect-error an inherited optional data-source argument does not permit extra arguments
sqlite.createContext(DefaultContext, 'extra');
sqlite.createContext(OptionalContext);
sqlite.createContext(OptionalContext, 'south');
// @ts-expect-error default values do not erase argument types
sqlite.createContext(OptionalContext, 123);
sqlite.createContext(VariadicContext, 'north');
sqlite.createContext(VariadicContext, 'north', true, false);
// @ts-expect-error a required argument preceding rest arguments stays required
sqlite.createContext(VariadicContext);
// @ts-expect-error rest arguments preserve their value types
sqlite.createContext(VariadicContext, 'north', 'wrong');

const sqliteTenant: SqliteContext = sqlite.createContext(SqliteContext, 'north');
void sqliteTenant;
// @ts-expect-error provider-specific source types still enforce trailing constructor arguments
sqlite.createContext(SqliteContext);
const postgresTenant: TenantContext = postgres.createContext(TenantContext, 'north');
const mysqlTenant: TenantContext = mysql.createContext(TenantContext, 'north');
void postgresTenant;
void mysqlTenant;
// @ts-expect-error Postgres shares the constructor-anchored contract
postgres.createContext(TenantContext, 123);
// @ts-expect-error MySQL shares the constructor-anchored contract
mysql.createContext(TenantContext);
const annotated: EntityKitContextFactory<SqliteConnectionConfig, TenantContext, [tenantId: string]> = TenantContext;
sqlite.createContext(annotated, 'north');
// @ts-expect-error an explicit context-factory annotation retains required constructor arguments
sqlite.createContext(annotated);
declare const staticOnly: { prototype: TenantContext; create(source: DatabaseDataSource, id: string): TenantContext };
// @ts-expect-error a static create method alone does not establish a constructor contract
sqlite.createContext(staticOnly, 'north');

TenantContext.create(sqlite, 'north');
// @ts-expect-error the direct factory continues to check missing inputs
TenantContext.create(sqlite);
// @ts-expect-error the direct factory continues to check input types
TenantContext.create(sqlite, 123);
