import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { requireDefined } from './require-defined';

/** Capture the value an operation rejects with, failing when it succeeds. */
export async function rejection(action: () => unknown): Promise<unknown> {
    let rejected = false;
    let reason: unknown;
    try {
        await action();
    } catch (error) {
        rejected = true;
        reason = error;
    }
    expect(rejected).toBe(true);
    return reason;
}

/** Read the message of a captured refusal without widening its type. */
export function refusalMessage(failure: unknown): string {
    expect(failure).toBeInstanceOf(Error);
    return (failure as Error).message;
}

export class RefusalPrincipal {
    public id = '';
    public dependents: RefusalDependent[] = [];
}

export class RefusalDependent {
    public id = '';
    public principalId = '';
    public principal: RefusalPrincipal | null = null;
}

/** SQLite-backed one-to-many graph shared by the accessor refusal matrix. */
export class RefusalGraphContext extends DbContext {
    public principals = this.set(RefusalPrincipal);
    public dependents = this.set(RefusalDependent);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RefusalPrincipal, entity => {
            entity.toTable('refusal_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(RefusalDependent, entity => {
            entity.toTable('refusal_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId)
                .hasColumnName('principal_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(RefusalPrincipal, row => row.principal)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.principalId);
        });
    }
}

/** Create the graph schema with two principals owning one dependent each. */
export async function openRefusalGraph(): Promise<RefusalGraphContext> {
    const db = RefusalGraphContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into refusal_principals (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: `insert into refusal_dependents (id, principal_id)
            values (?, ?), (?, ?), (?, ?)`,
        values: ['d1', 'p1', 'd2', 'p2', 'd3', 'p2'],
    });
    return db;
}

/** One tracked dependent whose reference and inverse collection are loaded. */
export interface TrackedRefusalGraph {
    readonly db: RefusalGraphContext;
    readonly first: RefusalPrincipal;
    readonly second: RefusalPrincipal;
    readonly dependent: RefusalDependent;
}

/** Load both principals and fix up the first dependent's reference. */
export async function trackedRefusalGraph(): Promise<TrackedRefusalGraph> {
    const db = await openRefusalGraph();
    const first = requireDefined(await db.principals.find('p1'));
    const second = requireDefined(await db.principals.find('p2'));
    const dependent = requireDefined(await db.dependents.find('d1'));
    await requireDefined(db.entry(dependent))
        .reference(row => row.principal).load();
    return { db, first, second, dependent };
}

/** Move one dependent row to another principal behind the change tracker. */
export async function repointStoredPrincipal(
    db: RefusalGraphContext,
    dependentId: string,
    principalId: string,
): Promise<void> {
    await db.database.connection.query({
        text: 'update refusal_dependents set principal_id = ? where id = ?',
        values: [principalId, dependentId],
    });
}
