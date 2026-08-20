import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

type HydrationFailure = 'identity setter' | 'later setter' | 'later getter' |
    'complex constructor' | 'nested setter' | 'identity restoration';

class AtomicGeneratedToken {
    constructor(public readonly value: string) {}
}

let tokenConversionFailure = false;
const tokenConverter = valueConverter<AtomicGeneratedToken, string>({
    toProvider: value => value.value,
    fromProvider: value => {
        if (tokenConversionFailure) {
            throw new Error('generated converter failed');
        }
        return new AtomicGeneratedToken(value);
    },
});

class AtomicGeneratedDetails {
    public static failure?: HydrationFailure;
    private storedStamp?: string;
    constructor() {
        if (AtomicGeneratedDetails.failure === 'complex constructor') {
            throw new Error('generated complex constructor failed');
        }
    }
    public get stamp(): string | undefined {
        return this.storedStamp;
    }
    public set stamp(value: string | undefined) {
        if (value && AtomicGeneratedDetails.failure === 'nested setter') {
            throw new Error('generated nested setter failed');
        }
        this.storedStamp = value;
    }
}

class AtomicGeneratedParent {
    private storedId = 0;
    private storedGeneratedAt?: Date;
    public sku = '';
    public name = '';
    public generatedToken?: AtomicGeneratedToken;
    public details: AtomicGeneratedDetails | null = null;
    public childToMutate?: AtomicGeneratedChild;
    public failure?: HydrationFailure;
    public restorationFailure?: Error;

    public get id(): number {
        return this.storedId;
    }
    public set id(value: number) {
        if (value === 0 && this.storedId > 0 &&
            this.failure === 'identity restoration') {
            throw this.restorationFailure ??
                new Error('Expected an identity restoration failure.');
        }
        this.storedId = value;
        if (value > 0) {
            if (this.childToMutate) this.childToMutate.parentId = value;
            if (this.failure === 'identity setter' ||
                this.failure === 'identity restoration') {
                throw new Error('generated identity setter failed');
            }
        }
    }
    public get generatedAt(): Date | undefined {
        if (this.storedGeneratedAt && this.failure === 'later getter') {
            throw new Error('generated value getter failed');
        }
        return this.storedGeneratedAt;
    }
    public set generatedAt(value: Date | undefined) {
        if (value && this.failure === 'later setter') {
            throw new Error('generated value setter failed');
        }
        this.storedGeneratedAt = value;
    }
}

class AtomicGeneratedChild {
    public id = '';
    public parentId = 0;
    public parent: AtomicGeneratedParent | null = null;
}

class AtomicGeneratedContext extends DbContext {
    public parents = this.set(AtomicGeneratedParent);
    public children = this.set(AtomicGeneratedChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AtomicGeneratedParent, entity => {
            entity.toTable('atomic_generated_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId({ preventReuse: true });
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.generatedAt)
                .hasColumnName('generated_at').hasColumnType('timestamp')
                .isRequired().hasDefaultSql('current_timestamp')
                .valueGeneratedOnAdd();
            entity.property(row => row.generatedToken)
                .hasColumnName('generated_token').hasColumnType('text')
                .hasConversion(tokenConverter).isOptional()
                .hasDefaultSql('\'generated-token\'').valueGeneratedOnAdd();
            entity.complexProperty(
                row => row.details,
                { constructor: AtomicGeneratedDetails },
                details => details.property(value => value.stamp)
                    .hasColumnName('generated_stamp').hasColumnType('text')
                    .isOptional().hasDefaultSql('\'generated-stamp\'')
                    .valueGeneratedOnAdd(),
            );
            entity.hasIndex(row => row.sku).isUnique();
        });
        model.entity(AtomicGeneratedChild, entity => {
            entity.toTable('atomic_generated_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(AtomicGeneratedParent, row => row.parent)
                .withMany().hasForeignKey(row => row.parentId);
        });
    }
}

const upsertOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['name'] as const,
};

async function open(): Promise<AtomicGeneratedContext> {
    const db = AtomicGeneratedContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into atomic_generated_parents (id, sku, name)
            values (?, ?, ?)`,
        values: [1, 'durable', 'durable'],
    });
    await db.database.connection.query({
        text: `insert into atomic_generated_children (id, parent_id)
            values (?, ?)`,
        values: ['existing', 1],
    });
    return db;
}

async function occupyRolledBackIdentity(
    db: AtomicGeneratedContext,
    suffix: string,
): Promise<void> {
    await db.database.connection.query({
        text: `insert into atomic_generated_parents (sku, name)
            values (?, ?)`,
        values: [`unrelated-${suffix}`, 'unrelated'],
    });
}

async function storedParentId(
    db: AtomicGeneratedContext,
): Promise<number> {
    const result = await db.database.connection.query<{ parent_id: number }>({
        text: `select parent_id from atomic_generated_children
            where id = ?`,
        values: ['existing'],
    });
    return result.rows[0]?.parent_id ?? -1;
}

function parentFor(
    child: AtomicGeneratedChild,
    failure: HydrationFailure,
): AtomicGeneratedParent {
    AtomicGeneratedDetails.failure = failure;
    return Object.assign(new AtomicGeneratedParent(), {
        sku: `intended-${failure}`,
        name: 'intended',
        childToMutate: child,
        failure,
    });
}

describe('generated hydration failure atomicity on SQLite', () => {
    afterEach(() => {
        AtomicGeneratedDetails.failure = undefined;
        tokenConversionFailure = false;
    });

    it.each([
        'identity setter', 'later setter', 'later getter',
        'complex constructor', 'nested setter',
    ] as const)('retargets a tracked FK after a failing %s', async failure => {
        const db = await open();
        const child = await db.children.find('existing');
        if (!child) throw new Error('Expected the durable child.');
        const parent = parentFor(child, failure);
        db.parents.add(parent);

        await expect(db.saveChanges()).rejects.toThrow(/generated/i);
        expect(parent.id).toBe(0);
        expect(child.parentId).toBe(2);
        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        parent.failure = undefined;
        AtomicGeneratedDetails.failure = undefined;
        parent.childToMutate = undefined;
        await occupyRolledBackIdentity(db, failure);

        await expect(db.saveChanges()).rejects.toThrow(
            'has not been generated yet',
        );
        await expect(storedParentId(db)).resolves.toBe(1);
        child.parentId = 1;
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(parent.id).toBe(3);
        child.parent = parent;
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(child).toMatchObject({ parentId: 3, parent });
        await expect(storedParentId(db)).resolves.toBe(3);
        await db.dispose();
    });

    it.each([
        'identity setter', 'later setter', 'complex constructor',
        'nested setter',
    ] as const)('blocks an upsert-observed FK after a failing %s', async failure => {
        const db = await open();
        const child = await db.children.find('existing');
        if (!child) throw new Error('Expected the durable child.');
        const parent = parentFor(child, failure);

        await expect(db.parents.upsert([parent], upsertOptions))
            .rejects.toThrow(/generated/i);
        expect(parent.id).toBe(0);
        expect(child.parentId).toBe(2);
        parent.failure = undefined;
        AtomicGeneratedDetails.failure = undefined;
        parent.childToMutate = undefined;
        await occupyRolledBackIdentity(db, `upsert-${failure}`);
        await expect(db.parents.upsert([parent], upsertOptions))
            .resolves.toBe(1);
        expect(parent.id).toBe(3);

        await expect(db.saveChanges()).rejects.toThrow(
            'retains a rolled-back store-generated FK',
        );
        await expect(storedParentId(db)).resolves.toBe(1);
        child.parentId = parent.id;
        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedParentId(db)).resolves.toBe(3);
        await db.dispose();
    });

    it.each(['tracked save', 'upsert'] as const)(
        'prepares every converter before exposing an identity through %s',
        async operation => {
            const db = await open();
            const child = await db.children.find('existing');
            if (!child) throw new Error('Expected the durable child.');
            const parent = parentFor(child, 'later setter');
            parent.failure = undefined;
            AtomicGeneratedDetails.failure = undefined;
            tokenConversionFailure = true;
            if (operation === 'tracked save') db.parents.add(parent);

            const pending = operation === 'tracked save'
                ? db.saveChanges()
                : db.parents.upsert([parent], upsertOptions);
            await expect(pending).rejects.toThrow('generated converter failed');
            expect(parent.id).toBe(0);
            expect(child.parentId).toBe(1);
            tokenConversionFailure = false;
            parent.childToMutate = undefined;
            await occupyRolledBackIdentity(db, `converter-${operation}`);

            const retry = operation === 'tracked save'
                ? db.saveChanges()
                : db.parents.upsert([parent], upsertOptions);
            await expect(retry).resolves.toBe(1);
            expect(parent.id).toBe(3);
            await expect(storedParentId(db)).resolves.toBe(1);
            await db.dispose();
        },
    );

    it.each(['tracked save', 'upsert'] as const)(
        'poisons %s when a failed setter cannot restore its identity',
        async operation => {
            const db = await open();
            const child = await db.children.find('existing');
            if (!child) throw new Error('Expected the durable child.');
            const restorationFailure = new Error(
                'generated identity restoration failed',
            );
            const parent = parentFor(child, 'identity restoration');
            parent.restorationFailure = restorationFailure;
            if (operation === 'tracked save') db.parents.add(parent);

            const pending = operation === 'tracked save'
                ? db.saveChanges()
                : db.parents.upsert([parent], upsertOptions);
            await expect(pending).rejects.toThrow(
                'generated identity setter failed',
            );
            expect(parent.id).toBe(2);
            expect(child.parentId).toBe(2);
            await expect(db.parents.count()).rejects.toMatchObject({
                code: 'CONTEXT_STATE_RESTORATION_FAILED',
                cause: restorationFailure,
            });
            await db.dispose();
        },
    );
});
