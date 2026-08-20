import { createAggregateProxy } from '../packages/core/src/query/aggregate';
import { createQueryProxy } from '../packages/core/src/query/query-proxy';

/**
 * A sweep of the query DSL's type gates against what SQL actually supports.
 *
 * Two gates have been found narrower than the database beneath them — string
 * comparisons and aggregates over nullable columns —
 * both of which blocked ordinary application code. This pins the surface so the
 * next narrowing is caught here rather than by someone building on it.
 *
 * These assertions are compile-time; reaching the end of the file is the pass.
 */

class Row {
    public id!: string;
    public name!: string | null;
    public qty!: number;
    public score!: number | null;
    public at!: Date;
    public seenAt!: Date | null;
    public active!: boolean;
    public flagged!: boolean | null;
    public tags!: string[];
}

const query = createQueryProxy<Row>();
const aggregate = createAggregateProxy<Row>();

type HasMember<TValue, TKey extends PropertyKey> =
    TKey extends keyof TValue ? true : false;

describe('query DSL type surface', () => {
    it('permits every operation SQL supports for the column shape', () => {
    // Equality, on every shape including nullable and boolean.
        query.id.eq('x');
        query.name.eq('x');
        query.qty.eq(1);
        query.score.eq(1);
        query.at.eq(new Date());
        query.seenAt.eq(new Date());
        query.active.eq(true);
        query.flagged.eq(true);

        // Null checks.
        query.name.isNull();
        query.score.isNotNull();
        query.seenAt.isNull();

        // Set membership.
        query.id.in(['a']);
        query.qty.in([1]);
        query.at.in([new Date()]);
        query.active.in([true]);

        // Ordering comparisons over every ordered type, nullable included.
        // Strings matter here: keyset pagination breaks ties on an id column.
        query.qty.gt(1);
        query.score.gte(1);
        query.at.lt(new Date());
        query.seenAt.lte(new Date());
        query.id.gt('a');
        query.name.lt('z');

        // Pattern matching on text.
        query.id.like('a%');
        query.name.contains('a');
        query.name.startsWith('a');
        query.name.endsWith('a');

        // Aggregates, including over nullable columns — SQL ignores nulls.
        aggregate.count();
        aggregate.count(row => row.name);
        aggregate.sum(row => row.qty);
        aggregate.sum(row => row.score);
        aggregate.avg(row => row.qty);
        aggregate.avg(row => row.score);
        aggregate.min(row => row.qty);
        aggregate.min(row => row.score);
        aggregate.max(row => row.at);
        aggregate.max(row => row.seenAt);
        aggregate.min(row => row.id);
        aggregate.max(row => row.name);

        expect(true).toBe(true);
    });

    it('still refuses operations that are meaningless for the column shape', () => {
    // Ordering a boolean is legal SQL but essentially always a mistake in
    // application code, and unlike strings has no pattern that needs it.
        const unsupportedOperators: [
            HasMember<typeof query.active, 'gt'>,
            HasMember<typeof query.qty, 'like'>,
            HasMember<typeof query.tags, 'gt'>,
        ] = [false, false, false];
        expect(unsupportedOperators).toEqual([false, false, false]);

        // @ts-expect-error a numeric aggregate cannot take a text column
        aggregate.sum(row => row.name);

        // @ts-expect-error `in` values must match the column type
        query.qty.in(['a']);

        expect(true).toBe(true);
    });
});
