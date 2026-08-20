import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';

class User {
    public id!: string;
    public email!: string;
    public name!: string;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
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
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

describe('ChangeTracker', () => {
    it('tracks added entities from DbSet.add', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        const entry = db.users.add(user);

        expect(entry.state).toBe(EntityState.Added);
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.changeTracker.debugView()).toContain('User { id: "usr_1" } Added');
    });

    it('tracks attached entities and detects modified properties', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        const entry = db.users.attach(user);
        user.name = 'B';

        db.changeTracker.detectChanges();

        expect(entry.state).toBe(EntityState.Modified);
        expect(entry.modifiedProperties()).toEqual(['name']);
        expect(db.changeTracker.debugView()).toContain('name: "A" -> "B"');
    });

    it('marks removed entities as deleted', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        const entry = db.users.remove(user);

        expect(entry.state).toBe(EntityState.Deleted);
    });

    it('detaches tracked entities', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        db.users.attach(user);
        const detached = db.users.detach(user);

        expect(detached?.state).toBe(EntityState.Detached);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });
});
