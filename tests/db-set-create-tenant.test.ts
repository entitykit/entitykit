import { EntityState } from '../packages/core/src';
import { CreationContext, CreationUser } from './support/creation-context';

describe('creation tenant enrollment', () => {
    it('applies tenant defaults to constructor and factory results', async () => {
        await using db = CreationContext.create({ tenant: 'north' });
        const user = db.users.create({ id: 'one', name: 'One' });
        const factory = db.set(CreationUser, {
            create: () => new CreationUser({ id: 'two', name: 'Two' }),
        });
        expect(user.tenantId).toBe('north');
        expect(factory.create().tenantId).toBe('north');
        expect(db.entry(user)?.state).toBe(EntityState.Added);
    });

    it('rejects a mismatched tenant without enrolling the constructed entity', async () => {
        await using db = CreationContext.create({ tenant: 'north' });
        const candidate = new CreationUser({ id: 'wrong', name: 'Wrong', tenantId: 'south' });
        expect(() => db.set(CreationUser, { create: () => candidate }).create()).toThrow();
        expect(candidate.tenantId).toBe('south');
        expect(db.entry(candidate)).toBeUndefined();
        expect(db.changeTracker.entries()).toEqual([]);
    });

    it('restores an accessor-backed tenant value after an identity collision', async () => {
        await using db = CreationContext.create({ tenant: 'north' });
        const accepted = db.users.create({ id: 'same', name: 'Accepted' });
        const rejected = new CreationUser({ id: 'same', name: 'Rejected' });
        expect(() => db.set(CreationUser, { create: () => rejected }).create()).toThrow('already tracked');
        expect(rejected.tenantId).toBeUndefined();
        expect(Object.hasOwn(rejected, 'tenantId')).toBe(false);
        expect(db.entry(rejected)).toBeUndefined();
        expect(db.entry(accepted)?.state).toBe(EntityState.Added);
        expect(db.changeTracker.entries()).toHaveLength(1);
    });
});
