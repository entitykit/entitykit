import { requireDefined } from '../support/require-defined';
import fs from 'fs';
import path from 'path';
import * as migrations from '../../packages/core/src/migrations/api';
import { runEntityKitCli } from '../../packages/cli/src/api';
import { PostgresDatabaseConnection } from '../../packages/postgres/src';
import {
    compileGeneratedDirectory,
    createGeneratedModelSnapshot,
    createProject,
} from './db-pull-integration-support';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

describePostgres('Postgres db pull integration', () => {
    let connection: PostgresDatabaseConnection;
    let cwd: string | undefined;

    beforeEach(async () => {
        cwd = createProject();
        connection = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull" cascade', values: [] });
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull_edges" cascade', values: [] });
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull_auth" cascade', values: [] });
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull_external" cascade', values: [] });
        await connection.query({ text: 'create schema "entitykit_db_pull"', values: [] });
        await connection.query({
            text: `
        create table "entitykit_db_pull"."users" (
          "id" uuid primary key,
          "email" varchar(255) not null
        );

        create unique index "ux_entitykit_db_pull_users_email"
          on "entitykit_db_pull"."users" ("email");

        create table "entitykit_db_pull"."roles" (
          "id" uuid primary key,
          "name" text not null
        );

        create table "entitykit_db_pull"."user_roles" (
          "user_id" uuid not null,
          "role_id" uuid not null,
          primary key ("user_id", "role_id"),
          constraint "fk_entitykit_db_pull_user_roles_users"
            foreign key ("user_id")
            references "entitykit_db_pull"."users" ("id")
            on delete cascade,
          constraint "fk_entitykit_db_pull_user_roles_roles"
            foreign key ("role_id")
            references "entitykit_db_pull"."roles" ("id")
            on delete cascade
        );
      `,
            values: [],
        });
    });

    afterEach(async () => {
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull" cascade', values: [] });
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull_edges" cascade', values: [] });
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull_auth" cascade', values: [] });
        await connection.query({ text: 'drop schema if exists "entitykit_db_pull_external" cascade', values: [] });
        await connection.dispose();
        if (cwd) {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('introspects live schema and writes many-to-many starter code', async () => {
        const result = await runEntityKitCli([
            'db',
            'pull',
            '--schema',
            'entitykit_db_pull',
            '--output',
            'generated',
            '--context',
            'PulledDbContext',
        ], { cwd: requireDefined(cwd) });

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe('Wrote 3 db pull file(s) to generated.');

        const generatedDir = path.join(requireDefined(cwd), 'generated');
        const userFile = fs.readFileSync(path.join(generatedDir, 'user.ts'), 'utf8');
        const roleFile = fs.readFileSync(path.join(generatedDir, 'role.ts'), 'utf8');
        const contextFile = fs.readFileSync(path.join(generatedDir, 'pulled-db-context.ts'), 'utf8');
        const expectedSnapshot: migrations.ModelSnapshot = {
            formatVersion: 1,
            entities: [
                {
                    entityName: 'Role',
                    tableName: 'roles',
                    schemaName: 'entitykit_db_pull',
                    keyProperty: 'id',
                    keyProperties: ['id'],
                    properties: [
                        { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, maxLength: undefined, defaultValue: undefined, defaultSql: undefined, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'name', columnName: 'name', columnType: 'text', isRequired: true, isPrimaryKey: false, isUnique: false, maxLength: undefined, defaultValue: undefined, defaultSql: undefined, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                    ],
                    ignoredProperties: [],
                    indexes: [],
                    relationships: [],
                    manyToManyRelationships: [],
                    audit: undefined,
                    softDelete: undefined,
                    tenantKeyProperty: undefined,
                },
                {
                    entityName: 'User',
                    tableName: 'users',
                    schemaName: 'entitykit_db_pull',
                    keyProperty: 'id',
                    keyProperties: ['id'],
                    properties: [
                        { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, maxLength: undefined, defaultValue: undefined, defaultSql: undefined, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'email', columnName: 'email', columnType: 'varchar(255)', isRequired: true, isPrimaryKey: false, isUnique: false, maxLength: undefined, defaultValue: undefined, defaultSql: undefined, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                    ],
                    ignoredProperties: [],
                    indexes: [{ propertyNames: ['email'], isUnique: true, databaseName: 'ux_entitykit_db_pull_users_email' }],
                    relationships: [],
                    manyToManyRelationships: [{
                        navigationProperty: 'roles',
                        targetEntityName: 'Role',
                        inverseNavigationProperty: 'users',
                        joinTableName: 'user_roles',
                        joinSchemaName: 'entitykit_db_pull',
                        primaryKeyName: 'user_roles_pkey',
                        sourceForeignKeyColumn: 'user_id',
                        sourceForeignKeyColumns: ['user_id'],
                        targetForeignKeyColumn: 'role_id',
                        targetForeignKeyColumns: ['role_id'],
                        sourceConstraintName: 'fk_entitykit_db_pull_user_roles_users',
                        targetConstraintName: 'fk_entitykit_db_pull_user_roles_roles',
                        deleteBehavior: 'cascade',
                    }],
                    audit: undefined,
                    softDelete: undefined,
                    tenantKeyProperty: undefined,
                },
            ],
        };

        expect(fs.existsSync(path.join(generatedDir, 'user-role.ts'))).toBe(false);
        expect(userFile).toContain('import { Role } from "./role";');
        expect(userFile).toContain('email!: string;');
        expect(userFile).toContain('roles!: Role[];');
        expect(roleFile).toContain('import { User } from "./user";');
        expect(roleFile).toContain('name!: string;');
        expect(roleFile).toContain('users!: User[];');
        expect(contextFile).toContain('entity.toTable("users", "entitykit_db_pull")');
        expect(contextFile).toContain('entity.hasIndex(row => row.email).hasDatabaseName("ux_entitykit_db_pull_users_email").isUnique();');
        expect(contextFile).toContain('entity.hasManyToMany(Role, row => row.roles)');
        expect(contextFile).toContain('.withMany(row => row.users)');
        expect(contextFile).toContain('.usingJoinTable("user_roles", join => {');
        expect(contextFile).toContain('join.hasSchema("entitykit_db_pull");');
        expect(contextFile).toContain('join.sourceForeignKey("user_id");');
        expect(contextFile).toContain('join.targetForeignKey("role_id");');
        expect(contextFile).toContain('join.sourceConstraintName("fk_entitykit_db_pull_user_roles_users");');
        expect(contextFile).toContain('join.targetConstraintName("fk_entitykit_db_pull_user_roles_roles");');
        expect(compileGeneratedDirectory(generatedDir)).toEqual([]);

        const generatedSnapshot = await createGeneratedModelSnapshot(generatedDir, 'pulled-db-context.ts');
        expect(generatedSnapshot).toMatchObject(expectedSnapshot);
        expect(migrations.diffModelSnapshots(expectedSnapshot, generatedSnapshot)).toMatchObject({
            hasChanges: false,
            operations: [],
        });
    });

    it('introspects live edge-case schemas into reviewable starter code', async () => {
        await connection.query({ text: 'create schema "entitykit_db_pull_edges"', values: [] });
        await connection.query({ text: 'create schema "entitykit_db_pull_auth"', values: [] });
        await connection.query({ text: 'create schema "entitykit_db_pull_external"', values: [] });
        await connection.query({
            text: `
        create table "entitykit_db_pull_auth"."users" (
          "id" uuid primary key
        );

        create table "entitykit_db_pull_external"."users" (
          "id" uuid primary key
        );

        create table "entitykit_db_pull_edges"."users" (
          "id" uuid primary key
        );

        create table "entitykit_db_pull_edges"."groups" (
          "id" uuid primary key
        );

        create table "entitykit_db_pull_edges"."user_groups" (
          "user_id" uuid not null,
          "group_id" uuid not null,
          primary key ("user_id", "group_id"),
          constraint "fk_entitykit_db_pull_edges_user_groups_users"
            foreign key ("user_id")
            references "entitykit_db_pull_edges"."users" ("id")
            on delete cascade,
          constraint "fk_entitykit_db_pull_edges_user_groups_groups"
            foreign key ("group_id")
            references "entitykit_db_pull_edges"."groups" ("id")
            on delete cascade
        );

        create table "entitykit_db_pull_edges"."user_managed_groups" (
          "user_id" uuid not null,
          "group_id" uuid not null,
          primary key ("user_id", "group_id"),
          constraint "fk_entitykit_db_pull_edges_user_managed_groups_users"
            foreign key ("user_id")
            references "entitykit_db_pull_edges"."users" ("id")
            on delete cascade,
          constraint "fk_entitykit_db_pull_edges_user_managed_groups_groups"
            foreign key ("group_id")
            references "entitykit_db_pull_edges"."groups" ("id")
            on delete cascade
        );

        create table "entitykit_db_pull_edges"."posts" (
          "id" uuid primary key,
          "author_id" uuid not null,
          constraint "fk_entitykit_db_pull_edges_posts_external_users"
            foreign key ("author_id")
            references "entitykit_db_pull_external"."users" ("id")
            on delete restrict
        );

        create table "entitykit_db_pull_edges"."audit_logs" (
          "class" text primary key,
          "first-name" text not null,
          "first_name" text,
          "123-value" integer not null
        );

        create table "entitykit_db_pull_edges"."tenant_users" (
          "tenant_id" uuid not null,
          "user_id" uuid not null,
          "email" text not null,
          primary key ("tenant_id", "user_id")
        );

        create table "entitykit_db_pull_edges"."pulled_db_contexts" (
          "id" uuid primary key
        );
      `,
            values: [],
        });

        const result = await runEntityKitCli([
            'db',
            'pull',
            '--schema',
            'entitykit_db_pull_edges',
            '--schema',
            'entitykit_db_pull_auth',
            '--output',
            'generated-edges',
            '--context',
            'pulled-db-context',
        ], { cwd: requireDefined(cwd) });

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('Wrote 8 db pull file(s) to generated-edges.');
        expect(result.stdout).toContain('Review required:');
        expect(result.stdout).toContain('Requested DbContext name \'PulledDbContext\' was rewritten to \'PulledDbContext2\'');
        expect(result.stdout).toContain('Foreign key \'fk_entitykit_db_pull_edges_posts_external_users\'');
        // The composite key is generated in full, so it is no longer flagged for review.
        expect(result.stdout).not.toContain('has composite primary key');

        const generatedDir = path.join(requireDefined(cwd), 'generated-edges');
        const edgeUserFile = fs.readFileSync(path.join(generatedDir, 'entitykit-db-pull-edges-user.ts'), 'utf8');
        const auditLogFile = fs.readFileSync(path.join(generatedDir, 'audit-log.ts'), 'utf8');
        const postFile = fs.readFileSync(path.join(generatedDir, 'post.ts'), 'utf8');
        const contextFile = fs.readFileSync(path.join(generatedDir, 'pulled-db-context2.ts'), 'utf8');

        expect(fs.existsSync(path.join(generatedDir, 'entitykit-db-pull-auth-user.ts'))).toBe(true);
        expect(fs.existsSync(path.join(generatedDir, 'user-group.ts'))).toBe(false);
        expect(fs.existsSync(path.join(generatedDir, 'user-managed-group.ts'))).toBe(false);
        expect(edgeUserFile).toContain('groups!: Group[];');
        expect(edgeUserFile).toContain('groupsNavigation!: Group[];');
        expect(auditLogFile).toContain('_class!: string;');
        expect(auditLogFile).toContain('firstName!: string;');
        expect(auditLogFile).toContain('firstName2?: string | null;');
        expect(auditLogFile).toContain('_123Value!: number;');
        expect(postFile).toContain('Foreign key "fk_entitykit_db_pull_edges_posts_external_users" references "entitykit_db_pull_external"."users"');
        expect(contextFile).toContain('export class PulledDbContext2 extends DbContext');
        expect(contextFile).toContain('import { PulledDbContext } from "./pulled-db-context";');
        expect(contextFile).toContain('entity.hasManyToMany(Group, row => row.groupsNavigation)');
        expect(contextFile).toContain('.usingJoinTable("user_managed_groups", join => {');
        // Generated in full rather than truncated to the first key column.
        expect(contextFile).toContain('entity.hasKey(row => [row.tenantId, row.userId]);');
        expect(contextFile).toContain('Skipped relationship "fk_entitykit_db_pull_edges_posts_external_users" because "entitykit_db_pull_external"."users" was not included');
        expect(compileGeneratedDirectory(generatedDir)).toEqual([]);
    });
});
