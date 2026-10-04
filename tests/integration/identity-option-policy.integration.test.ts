import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import type { IdentityColumnOptions } from '../../packages/core/src/model/store-generation';
import { postgresProviderServices } from '../../packages/postgres/src';
import { requireDefined } from '../support/require-defined';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const maybe = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(url) ? describe : describe.skip;

class BookNumber {
    public id!: number;
}

class IdentityContext extends DbContext {
    public readonly numbers = this.set(BookNumber);

    constructor(private readonly identity: IdentityColumnOptions) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(url));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BookNumber, entity => {
            entity.toTable('ek_identity_policy');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').useIdentityColumn(this.identity);
        });
    }
}

maybe('native identity option policy', () => {
    it.each(['always', 'byDefault'] as const)('preserves %s insertion policy and inclusive endpoints', async mode => {
        const context = IdentityContext.create({ mode, startValue: 0, minValue: 0, maxValue: 2, cache: 1, isCyclic: false });
        const query = async (text: string): Promise<ReadonlyArray<Record<string, unknown>>> =>
            (await context.database.connection.query({ text, values: [] })).rows;
        try {
            await query('drop table if exists ek_identity_policy');
            await query(context.database.createScript());
            for (const id of [0, 1, 2]) {
                expect(await query('insert into ek_identity_policy default values returning id')).toEqual([{ id }]);
            }
            await expect(query('insert into ek_identity_policy default values')).rejects.toThrow();
            if (mode === 'always') {
                await expect(query('insert into ek_identity_policy (id) values (42)')).rejects.toThrow();
            } else {
                expect(await query('insert into ek_identity_policy (id) values (42) returning id')).toEqual([{ id: 42 }]);
            }
            expect(await context.numbers.count()).toBe(mode === 'always' ? 3 : 4);
        } finally {
            try {
                await query('drop table if exists ek_identity_policy');
            } finally {
                await context.dispose();
            }
        }
    });

    it('preserves explicitly enabled cycling through real database generation', async () => {
        const context = IdentityContext.create({ startValue: 0, minValue: 0, maxValue: 1, isCyclic: true });
        const query = async (text: string): Promise<void> => {
            await context.database.connection.query({ text, values: [] });
        };
        try {
            await query('drop table if exists ek_identity_policy');
            await query(context.database.createScript());
            await query('insert into ek_identity_policy default values');
            await query('insert into ek_identity_policy default values');
            await query('delete from ek_identity_policy where id=0');
            await query('insert into ek_identity_policy default values');
            expect(await context.numbers.orderBy(row => row.id).toArray()).toMatchObject([{ id: 0 }, { id: 1 }]);
        } finally {
            try {
                await query('drop table if exists ek_identity_policy');
            } finally {
                await context.dispose();
            }
        }
    });
});
