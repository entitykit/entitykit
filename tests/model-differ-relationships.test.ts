import { diffModelSnapshots, MigrationSqlGenerator } from '../packages/core/src/migrations/api';
import {
    emptySnapshot,
    postsSnapshot,
    usersSnapshot,
    usersWithRolesSnapshot,
    usersWithUserRolesSnapshot,
} from './model-differ-support';

describe('model snapshot relationship differ', () => {
    it('detects many-to-many join table additions', () => {
        const diff = diffModelSnapshots(usersWithRolesSnapshot, usersWithUserRolesSnapshot);

        expect(diff.operations).toMatchObject([{
            kind: 'createJoinTable',
            tableName: 'user_roles',
            schemaName: 'app',
            sourceTableName: 'users',
            targetTableName: 'roles',
            sourceForeignKeyColumn: 'user_id',
            targetForeignKeyColumn: 'role_id',
        }]);

        const script = new MigrationSqlGenerator()
            .generateUpScript(diff.toMigration('20260601160000_AddUserRoles', 'AddUserRoles'));

        expect(script).toContain('create table if not exists "app"."user_roles"');
        expect(script).toContain('constraint "fk_user_roles_users_user_id" foreign key ("user_id") references "app"."users" ("id") on delete cascade');
        expect(script).toContain('constraint "fk_user_roles_roles_role_id" foreign key ("role_id") references "app"."roles" ("id") on delete cascade');
    });

    it('detects many-to-many join table removals as destructive', () => {
        const diff = diffModelSnapshots(usersWithUserRolesSnapshot, usersWithRolesSnapshot);

        expect(diff.operations).toMatchObject([
            { kind: 'dropJoinTable', tableName: 'user_roles', schemaName: 'app' },
        ]);
    });

    it('drops join tables before tables they reference', () => {
        const diff = diffModelSnapshots(usersWithUserRolesSnapshot, emptySnapshot);

        expect(diff.operations.map(operation => operation.kind)).toEqual([
            'dropJoinTable',
            'dropIndex',
            'dropTable',
            'dropTable',
        ]);
    });

    it('detects added foreign keys and generates migration SQL', () => {
        const diff = diffModelSnapshots(usersSnapshot, postsSnapshot('cascade'));

        expect(diff.operations).toMatchObject([
            { kind: 'createTable', tableName: 'posts' },
            {
                kind: 'addForeignKey',
                name: 'fk_posts_users_author_id',
                columns: ['author_id'],
                principalTableName: 'users',
                principalColumns: ['id'],
                onDelete: 'cascade',
            },
        ]);

        const script = new MigrationSqlGenerator()
            .generateUpScript(diff.toMigration('20260601140000_AddPosts', 'AddPosts'));

        expect(script).toContain('alter table "app"."posts" add constraint "fk_posts_users_author_id" foreign key ("author_id") references "app"."users" ("id") on delete cascade;');
    });

    it('drops and recreates changed foreign keys', () => {
        const diff = diffModelSnapshots(postsSnapshot('restrict'), postsSnapshot('cascade'));

        expect(diff.operations).toMatchObject([
            { kind: 'dropForeignKey', name: 'fk_posts_users_author_id' },
            { kind: 'addForeignKey', name: 'fk_posts_users_author_id', onDelete: 'cascade' },
        ]);
    });
});
