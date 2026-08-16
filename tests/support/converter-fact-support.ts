import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext, valueConverter } from '../../src';
import { sqliteProviderServices } from '../../src/providers/sqlite';
import { requireDefined } from './require-defined';

/** A value object whose state is unreachable through structural cloning. */
export class StrongId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

/** A numeric value object for database-generated key columns. */
export class StrongKey {
    readonly #value: number;

    constructor(value: number) {
        this.#value = value;
    }

    public get value(): number {
        return this.#value;
    }
}

/** A value object whose only state is a non-enumerable own property. */
export class HiddenId {
    constructor(value: string) {
        Object.defineProperty(this, 'value', {
            configurable: true, enumerable: false, value,
        });
    }

    public get text(): string {
        return Reflect.get(this, 'value') as string;
    }
}

/** A numeric value object whose only state is a non-enumerable own property. */
export class HiddenKey {
    constructor(value: number) {
        Object.defineProperty(this, 'value', {
            configurable: true, enumerable: false, value,
        });
    }

    public get number(): number {
        return Reflect.get(this, 'value') as number;
    }
}

export const strongIdConverter = valueConverter<StrongId, string>({
    toProvider: value => {
        if (!(value instanceof StrongId)) {
            throw new TypeError('unconvertible strong identifier');
        }
        return value.value;
    },
    fromProvider: value => new StrongId(value),
});

export const strongKeyConverter = valueConverter<StrongKey, number>({
    toProvider: value => value.value,
    fromProvider: value => new StrongKey(value),
});

export const hiddenIdConverter = valueConverter<HiddenId, string>({
    toProvider: value => value.text,
    fromProvider: value => new HiddenId(value),
});

export const hiddenKeyConverter = valueConverter<HiddenKey, number>({
    toProvider: value => value.number,
    fromProvider: value => new HiddenKey(value),
});

/** A converter whose provider fact ignores surrounding whitespace. */
export const trimmedTextConverter = valueConverter<string, string>({
    toProvider: value => value.trim(),
    fromProvider: value => value,
});

/** Replace one property with an accessor whose store step may be hostile. */
export function interceptProperty<TValue>(
    target: object,
    name: string,
    store: (value: TValue) => TValue,
): void {
    let stored = Reflect.get(target, name) as TValue;
    Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: TValue) => {
            stored = store(value);
        },
    });
}

/** A setter that keeps whatever it was first given and ignores later writes. */
export function retainFirst<TValue>(): (value: TValue) => TValue {
    let remembered: TValue | undefined;
    return (value: TValue): TValue => {
        remembered ??= value;
        return remembered;
    };
}

export class FactParent {
    public id = new StrongId('');
    public children: FactChild[] = [];
    public profile: FactProfile | null = null;
}

export class FactChild {
    public id = '';
    public parentId = new StrongId('');
    public parent: FactParent | null = null;
}

export class FactProfile {
    public id = '';
    public ownerId = new StrongId('');
    public owner: FactParent | null = null;
}

/** SQLite-backed converted-key graph shared by the converter fact matrix. */
export class FactGraphContext extends DbContext {
    public parents = this.set(FactParent);
    public children = this.set(FactChild);
    public profiles = this.set(FactProfile);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FactParent, entity => {
            entity.toTable('fact_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
        });
        model.entity(FactChild, entity => {
            entity.toTable('fact_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').hasConversion(strongIdConverter)
                .isRequired();
            entity.hasOne(FactParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(FactProfile, entity => {
            entity.toTable('fact_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnName('owner_id')
                .hasColumnType('text').hasConversion(strongIdConverter)
                .isRequired();
            entity.hasOne(FactParent, row => row.owner)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId);
        });
    }
}

/** One tracked child and profile whose principals are both materialized. */
export interface FactGraph {
    readonly db: FactGraphContext;
    readonly previous: FactParent;
    readonly next: FactParent;
    readonly child: FactChild;
    readonly profile: FactProfile;
}

/** Create the schema with two parents, one child and one owned profile. */
export async function openFactGraph(): Promise<FactGraphContext> {
    const db = FactGraphContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into fact_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into fact_children (id, parent_id) values (?, ?), (?, ?)',
        values: ['c1', 'p1', 'c2', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into fact_profiles (id, owner_id) values (?, ?)',
        values: ['f1', 'p1'],
    });
    return db;
}

/** Load both parents with their navigations fixed up around the child. */
export async function trackedFactGraph(): Promise<FactGraph> {
    const db = await openFactGraph();
    const parents = await db.parents.orderBy(row => row.id)
        .include(row => row.children).toArray();
    const previous = requireDefined(parents[0]);
    const next = requireDefined(parents[1]);
    const child = requireDefined(await db.children.find('c1'));
    const profile = requireDefined(await db.profiles.find('f1'));
    await requireDefined(db.entry(child)).reference(row => row.parent).load();
    await requireDefined(db.entry(profile)).reference(row => row.owner).load();
    return { db, previous, next, child, profile };
}

/** Read the stored parent identifier of one child row through raw SQL. */
export async function storedParentId(
    db: FactGraphContext,
    childId: string,
): Promise<unknown> {
    const result = await db.database.connection.query({
        text: 'select parent_id from fact_children where id = ?',
        values: [childId],
    });
    return (result.rows[0] as { parent_id?: unknown } | undefined)?.parent_id;
}
