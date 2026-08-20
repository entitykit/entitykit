import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';
import { contextMigrations } from '../packages/core/src/migrations/api';
import {
    createConcurrencyContext,
    createConcurrencyUser,
    User,
} from './support/optimistic-concurrency-fixture';

describe('optimistic concurrency metadata', () => {
    it('marks concurrency tokens in model metadata and snapshots', () => {
        const db =  createConcurrencyContext();
        const metadata = contextModel(db).getEntity(User);

        expect(metadata.getProperty('version').isVersion).toBe(true);
        expect(metadata.getProperty('version').isConcurrencyToken).toBe(true);
        expect(metadata.getProperty('updatedAt').isConcurrencyToken).toBe(true);
        expect(contextMigrations(db).createModelSnapshot().entities[0]?.properties).toEqual(expect.arrayContaining([
            expect.objectContaining({ propertyName: 'version', isVersion: true, isConcurrencyToken: true }),
            expect.objectContaining({ propertyName: 'updatedAt', isConcurrencyToken: true }),
        ]));
    });

    it('adds original concurrency token values to update predicates and increments versions', () => {
        const db =  createConcurrencyContext();
        const metadata = contextModel(db).getEntity(User);
        const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
        const user = createConcurrencyUser({
            version: 3,
            updatedAt: originalUpdatedAt,
        });
        const entry = db.users.attach(user);
        user.name = 'B';

        const statement = new ModificationSqlBuilder().buildUpdate(
            metadata,
            user,
            entry.modifiedProperties(),
            entry.originalValues,
        );

        expect(statement).toEqual({
            text: 'update "users" set "name" = $1, "version" = "version" + 1 where "id" = $2 and "version" = $3 and "updated_at" = $4',
            values: ['B', 'usr_1', 3, originalUpdatedAt],
        });
    });
});
import { contextModel } from './support/public-api-internals';
