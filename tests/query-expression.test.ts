import { FieldExpression, PredicateExpression } from '../src/experimental';

class User {
    public id!: string;
    public email!: string;
    public createdAt!: Date;
}

describe('query expression AST', () => {
    it('creates binary predicate nodes', () => {
        const email: FieldExpression<User, string> = new FieldExpression('email');

        expect(email.eq('a@example.com').node).toEqual({
            kind: 'binary',
            operator: 'eq',
            propertyName: 'email',
            value: 'a@example.com',
        });
    });

    it('creates null predicate nodes', () => {
        const email: FieldExpression<User, string> = new FieldExpression('email');

        expect(email.isNotNull().node).toEqual({
            kind: 'null',
            operator: 'isNotNull',
            propertyName: 'email',
        });
    });

    it('combines predicates with and/or/not', () => {
        const email: FieldExpression<User, string> = new FieldExpression('email');
        const createdAt: FieldExpression<User, Date> = new FieldExpression('createdAt');

        const expression = email.like('%@example.com')
            .and(createdAt.gte(new Date('2026-01-01T00:00:00.000Z')))
            .or(PredicateExpression.binary<User>('id', 'eq', 'usr_1').not());

        expect(expression.node.kind).toBe('logical');
        expect(expression.node).toMatchObject({
            kind: 'logical',
            operator: 'or',
        });
    });

    it('creates order expressions', () => {
        const createdAt: FieldExpression<User, Date> = new FieldExpression('createdAt');

        expect(createdAt.desc()).toEqual({
            propertyName: 'createdAt',
            direction: 'desc',
        });
    });
});
