import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { contextModel, contextOptions, setMetadata } from './support/public-api-internals';

class User {
    public id!: string;
    public email!: string;
}

class AppDbContext extends DbContext {
    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.usePostgres('postgres://localhost/ef_ts');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });
    }
}

describe('DbContext', () => {
    it('creates a context through configure and model hooks', () => {
        const db =  AppDbContext.create();

        expect(contextOptions(db).provider).toEqual({ provider: 'postgres' });
        expect(contextModel(db).getEntity(User).tableName).toBe('users');
        expect(setMetadata(db.users).getProperty('email').columnName).toBe('email');
    });

    it('lazily initializes a directly constructed context on first use', () => {
        const db = new AppDbContext();

        expect(contextModel(db).getEntity(User).tableName).toBe('users');
        expect(setMetadata(db.users).getProperty('email').columnName).toBe('email');
    });
});
