import { generateDbPullCode, type DatabaseSchemaSnapshot } from '../../src/tooling';

describe('db pull generated naming', () => {
    it('qualifies generated names when tables from multiple schemas would collide', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [
                {
                    name: 'app',
                    tables: [{
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                        primaryKey: { name: 'pk_app_users', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [],
                    }],
                },
                {
                    name: 'auth',
                    tables: [
                        {
                            schemaName: 'auth',
                            tableName: 'users',
                            columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                            primaryKey: { name: 'pk_auth_users', columns: ['id'] },
                            indexes: [],
                            foreignKeys: [],
                        },
                        {
                            schemaName: 'auth',
                            tableName: 'sessions',
                            columns: [
                                { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                                { name: 'user_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                            ],
                            primaryKey: { name: 'pk_sessions', columns: ['id'] },
                            indexes: [],
                            foreignKeys: [{
                                name: 'fk_sessions_users_user_id',
                                columns: ['user_id'],
                                principalSchemaName: 'auth',
                                principalTableName: 'users',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            }],
                        },
                    ],
                },
            ],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const sessionFile = files.find(file => file.path === 'session.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(files.map(file => file.path)).toEqual(['app-user.ts', 'auth-user.ts', 'session.ts', 'pulled-db-context.ts']);
        expect(sessionFile).toContain('import { AuthUser } from "./auth-user";');
        expect(sessionFile).toContain('user?: AuthUser | null;');
        expect(contextFile).toContain('appUsers = this.set<AppUser, [AppUser["id"]]>(AppUser);');
        expect(contextFile).toContain('authUsers = this.set<AuthUser, [AuthUser["id"]]>(AuthUser);');
        expect(contextFile).toContain('sessions = this.set<Session, [Session["id"]]>(Session);');
        expect(contextFile).toContain('entity.hasOne(AuthUser, row => row.user)');
        expect(contextFile).toContain('entity.toTable("users", "app")');
        expect(contextFile).toContain('entity.toTable("users", "auth")');
    });

    it('sanitizes context names and avoids entity file collisions', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'pulled_db_contexts',
                    columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                    primaryKey: { name: 'pk_pulled_db_contexts', columns: ['id'] },
                    indexes: [],
                    foreignKeys: [],
                }],
            }],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'pulled-db-context' });
        const contextFile = files.find(file => file.path === 'pulled-db-context2.ts')?.contents ?? '';

        expect(files.map(file => file.path)).toEqual(['pulled-db-context.ts', 'pulled-db-context2.ts']);
        expect(files.find(file => file.path === 'pulled-db-context.ts')?.contents).toContain('export class PulledDbContext');
        expect(contextFile).toContain('export class PulledDbContext2 extends DbContext');
        expect(contextFile).toContain('import { PulledDbContext } from "./pulled-db-context";');
        expect(contextFile).toContain('pulledDbContexts = this.set<PulledDbContext, [PulledDbContext["id"]]>(PulledDbContext);');
    });

    it('generates safe unique property identifiers for awkward column names', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'audit_logs',
                    columns: [
                        { name: 'class', ordinal: 1, storeType: 'text', isNullable: false },
                        { name: 'first-name', ordinal: 2, storeType: 'text', isNullable: false },
                        { name: 'first_name', ordinal: 3, storeType: 'text', isNullable: true },
                        { name: '123-value', ordinal: 4, storeType: 'integer', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_audit_logs', columns: ['class'] },
                    indexes: [{
                        name: 'ix_audit_logs_names',
                        columns: ['first-name', 'first_name'],
                        isUnique: false,
                    }],
                    foreignKeys: [],
                }],
            }],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const auditLogFile = files.find(file => file.path === 'audit-log.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(auditLogFile).toContain('_class!: string;');
        expect(auditLogFile).toContain('firstName!: string;');
        expect(auditLogFile).toContain('firstName2?: string | null;');
        expect(auditLogFile).toContain('_123Value!: number;');
        expect(auditLogFile).not.toContain('\n  class!: string;');
        expect(contextFile).toContain('entity.hasKey(row => row._class);');
        expect(contextFile).toContain('entity.property(row => row._class)');
        expect(contextFile).toContain('        .hasColumnName("class")');
        expect(contextFile).toContain('entity.hasIndex(row => [row.firstName, row.firstName2])');
    });

});
