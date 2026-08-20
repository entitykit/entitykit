import { createQueryProxy } from '../packages/core/src/experimental';

class User {
    public id!: string;
    public email!: string;
    public createdAt!: Date;
    public deletedAt!: Date | null;
}

describe('typed query proxy', () => {
    it('creates fields from property access', () => {
        const user = createQueryProxy<User>();

        expect(user.email.eq('a@example.com').node).toEqual({
            kind: 'binary',
            operator: 'eq',
            propertyName: 'email',
            value: 'a@example.com',
        });
    });

    it('supports strongly typed operators at runtime', () => {
        const user = createQueryProxy<User>();

        const expression = user.email.like('%@example.com')
            .and(user.createdAt.gte(new Date('2026-01-01T00:00:00.000Z')))
            .and(user.deletedAt.isNull());

        expect(expression.node.kind).toBe('logical');
    });

    it('supports in and ordering', () => {
        const user = createQueryProxy<User>();

        expect(user.id.in(['usr_1', 'usr_2']).node).toMatchObject({
            kind: 'binary',
            operator: 'in',
            propertyName: 'id',
            value: ['usr_1', 'usr_2'],
        });
        expect(user.createdAt.desc()).toEqual({ propertyName: 'createdAt', direction: 'desc' });
    });
});
