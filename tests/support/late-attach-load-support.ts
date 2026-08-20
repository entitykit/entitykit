import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext, DeleteBehavior } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { requireDefined } from './require-defined';

export class LatePrincipal {
    public id = '';
    public dependents: LateDependent[] = [];
}

export class LateDependent {
    public id = '';
    public principalId = '';
    public principal: LatePrincipal | null = null;
}

export class LateHolder {
    public id = '';
    public badge: LateBadge | null = null;
}

export class LateBadge {
    public id = '';
    public holderId = '';
    public holder: LateHolder | null = null;
}

/** SQLite graph whose dependents are required and cascade with their principal. */
export class LateAttachContext extends DbContext {
    public principals = this.set(LatePrincipal);
    public dependents = this.set(LateDependent);
    public holders = this.set(LateHolder);
    public badges = this.set(LateBadge);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(LatePrincipal, entity => {
            entity.toTable('late_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(LateDependent, entity => {
            entity.toTable('late_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId)
                .hasColumnName('principal_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(LatePrincipal, row => row.principal)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.principalId)
                .onDelete(DeleteBehavior.Cascade);
        });
        model.entity(LateHolder, entity => {
            entity.toTable('late_holders');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(LateBadge, entity => {
            entity.toTable('late_badges');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.holderId)
                .hasColumnName('holder_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(LateHolder, row => row.holder)
                .withOne(row => row.badge)
                .hasForeignKey(row => row.holderId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

/** Two principals owning three dependents, plus two one-to-one badges. */
export async function openLateAttachGraph(): Promise<LateAttachContext> {
    const db = LateAttachContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into late_principals (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: `insert into late_dependents (id, principal_id)
            values (?, ?), (?, ?), (?, ?)`,
        values: ['d1', 'p1', 'd2', 'p1', 'd3', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into late_holders (id) values (?), (?)',
        values: ['h1', 'h2'],
    });
    await db.database.connection.query({
        text: `insert into late_badges (id, holder_id)
            values (?, ?), (?, ?)`,
        values: ['b1', 'h1', 'b2', 'h2'],
    });
    return db;
}

/** Read the dependent table directly, in a stable order. */
export async function storedDependentIds(
    db: LateAttachContext,
): Promise<string[]> {
    return storedIds(db, 'late_dependents');
}

/** Read the one-to-one badge table directly, in a stable order. */
export async function storedBadgeIds(
    db: LateAttachContext,
): Promise<string[]> {
    return storedIds(db, 'late_badges');
}

async function storedIds(
    db: LateAttachContext,
    table: string,
): Promise<string[]> {
    const result = await db.database.connection.query<{ id: string }>({
        text: `select id from ${table} order by id`, values: [],
    });
    return result.rows.map(row => row.id);
}

/** Identities the context still tracks, for detach assertions. */
export function trackedIds(db: DbContext): string[] {
    return db.changeTracker.entries()
        .map(entry => (entry.entity as { id: string }).id).sort();
}

/** The message a refused post-stitch read reports. */
export const postStitchRefusal = 'post-stitch read refused';

/** What one late-attach load run left behind. */
export interface LateAttachRun<
    TOwner extends object, TAttached extends object,
> {
    readonly db: LateAttachContext;
    /** The entity whose navigation the load was asked for. */
    readonly owner: TOwner;
    /** The matching instance attached after the load had begun. */
    readonly attached: TAttached;
    readonly reads: number;
    readonly failure: unknown;
}

export interface LateAttachOptions {
    /** Refuse this numbered read of the loaded navigation; 0 refuses none. */
    readonly refuseReadAt?: number;
    /** Fail the refused read with this error instead of a fresh one. */
    readonly refuseReadWith?: Error;
    /** Accept the load's forward write, then refuse to be rolled back. */
    readonly refuseRestoration?: Error;
}

/** Load `p1.dependents` with a matching dependent attached mid-flight. */
export async function loadDependentsWithLateAttach(
    options: LateAttachOptions = {},
): Promise<LateAttachRun<LatePrincipal, LateDependent>> {
    const db = await openLateAttachGraph();
    const owner = requireDefined(await db.principals.find('p1'));
    const entry = requireDefined(db.entry(owner));
    const reads = countNavigationReads(
        owner,
        'dependents',
        options.refuseReadAt ?? 0,
        options.refuseReadWith ?? new Error(postStitchRefusal),
    );
    const loading = entry.collection(row => row.dependents).load();
    const attached = new LateDependent();
    attached.id = 'd1';
    attached.principalId = 'p1';
    db.dependents.attach(attached);
    if (options.refuseRestoration) {
        refuseNavigationRestoration(
            attached, 'principal', options.refuseRestoration,
        );
    }
    const failure = await settled(loading);
    return { db, owner, attached, reads: reads(), failure };
}

/** Load `b1.holder` with a matching one-to-one holder attached mid-flight. */
export async function loadHolderWithLateAttach(
    refuseReadAt = 0,
): Promise<LateAttachRun<LateBadge, LateHolder>> {
    const db = await openLateAttachGraph();
    const owner = requireDefined(await db.badges.find('b1'));
    const entry = requireDefined(db.entry(owner));
    const reads = countNavigationReads(
        owner, 'holder', refuseReadAt, new Error(postStitchRefusal),
    );
    const loading = entry.reference(row => row.holder).load();
    const attached = new LateHolder();
    attached.id = 'h1';
    db.holders.attach(attached);
    const failure = await settled(loading);
    return { db, owner, attached, reads: reads(), failure };
}

/** Await an operation, reporting its rejection reason or `undefined`. */
async function settled(work: Promise<unknown>): Promise<unknown> {
    try {
        await work;
        return undefined;
    } catch (error) {
        return error;
    }
}

/** Count every read of one navigation, refusing exactly the numbered one. */
function countNavigationReads(
    owner: object,
    property: string,
    refuseAt: number,
    boom: Error,
): () => number {
    let reads = 0;
    let stored: unknown = (owner as Record<string, unknown>)[property];
    Object.defineProperty(owner, property, {
        configurable: true,
        enumerable: true,
        get: (): unknown => {
            reads += 1;
            if (reads === refuseAt) throw boom;
            return stored;
        },
        set: (value: unknown): void => {
            stored = value;
        },
    });
    return (): number => reads;
}

/** Accept the first write to one navigation and refuse every later one. */
function refuseNavigationRestoration(
    owner: object,
    property: string,
    boom: Error,
): void {
    let writes = 0;
    let stored: unknown = (owner as Record<string, unknown>)[property];
    Object.defineProperty(owner, property, {
        configurable: true,
        enumerable: true,
        get: (): unknown => stored,
        set: (value: unknown): void => {
            writes += 1;
            if (writes > 1) throw boom;
            stored = value;
        },
    });
}
