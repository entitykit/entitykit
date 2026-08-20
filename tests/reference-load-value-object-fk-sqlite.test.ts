import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class PrivateId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public providerValue(): string {
        return this.#value;
    }
}

class HiddenId {
    public readonly value!: string;

    constructor(value: string) {
        Object.defineProperty(this, 'value', { value, enumerable: false });
    }
}

class PrincipalCode {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public providerValue(): string {
        return this.#value;
    }
}

class DependentCode {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public providerValue(): string {
        return this.#value;
    }
}

const privateId = valueConverter<PrivateId, string>({
    toProvider: value => value.providerValue(),
    fromProvider: value => new PrivateId(value),
});
const hiddenId = valueConverter<HiddenId, string>({
    toProvider: value => value.value,
    fromProvider: value => new HiddenId(value),
});
const principalCode = valueConverter<PrincipalCode, string>({
    toProvider: value => value.providerValue(),
    fromProvider: value => new PrincipalCode(value),
});
const dependentCode = valueConverter<DependentCode, string>({
    toProvider: value => value.providerValue(),
    fromProvider: value => new DependentCode(value),
});

class PrivateParent {
    public id = new PrivateId('');
}

class PrivateChild {
    public id = '';
    public parentId = new PrivateId('');
    public parent: PrivateParent | null = null;
}

class HiddenParent {
    public id = new HiddenId('');
}

class HiddenChild {
    public id = '';
    public parentId = new HiddenId('');
    public parent: HiddenParent | null = null;
}

class AlternateParent {
    public id = '';
    public region = '';
    public code = new PrincipalCode('');
}

class AlternateChild {
    public id = '';
    public parentRegion = '';
    public parentCode = new DependentCode('');
    public parent: AlternateParent | null = null;
}

class ValueObjectReferenceContext extends DbContext {
    public privateParents = this.set(PrivateParent);
    public privateChildren = this.set(PrivateChild);
    public hiddenParents = this.set(HiddenParent);
    public hiddenChildren = this.set(HiddenChild);
    public alternateParents = this.set(AlternateParent);
    public alternateChildren = this.set(AlternateChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(PrivateParent, entity => {
            entity.toTable('private_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(privateId).isRequired();
        });
        model.entity(PrivateChild, entity => {
            entity.toTable('private_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').hasConversion(privateId).isRequired();
            entity.hasOne(PrivateParent, row => row.parent).withMany()
                .hasForeignKey(row => row.parentId);
        });
        model.entity(HiddenParent, entity => {
            entity.toTable('hidden_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(hiddenId).isRequired();
        });
        model.entity(HiddenChild, entity => {
            entity.toTable('hidden_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').hasConversion(hiddenId).isRequired();
            entity.hasOne(HiddenParent, row => row.parent).withMany()
                .hasForeignKey(row => row.parentId);
        });
        model.entity(AlternateParent, entity => {
            entity.toTable('value_alternate_parents');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => [row.region, row.code]);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.region).hasColumnType('text').isRequired();
            entity.property(row => row.code).hasColumnType('text')
                .hasConversion(principalCode).isRequired();
        });
        model.entity(AlternateChild, entity => {
            entity.toTable('value_alternate_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentRegion).hasColumnName('parent_region')
                .hasColumnType('text').isRequired();
            entity.property(row => row.parentCode).hasColumnName('parent_code')
                .hasColumnType('text').hasConversion(dependentCode).isRequired();
            entity.hasOne(AlternateParent, row => row.parent).withMany()
                .hasForeignKey(row => [row.parentRegion, row.parentCode])
                .hasPrincipalKey(row => [row.region, row.code]);
        });
    }
}

async function openContext(): Promise<ValueObjectReferenceContext> {
    const db = ValueObjectReferenceContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into private_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into private_children (id, parent_id) values (?, ?)',
        values: ['private-child', 'p1'],
    });
    await db.database.connection.query({
        text: 'insert into hidden_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into hidden_children (id, parent_id) values (?, ?)',
        values: ['hidden-child', 'p1'],
    });
    await db.database.connection.query({
        text: `insert into value_alternate_parents (id, region, code)
            values (?, ?, ?), (?, ?, ?)`,
        values: ['a1', 'north', 'p1', 'a2', 'north', 'p2'],
    });
    await db.database.connection.query({
        text: `insert into value_alternate_children
            (id, parent_region, parent_code) values (?, ?, ?)`,
        values: ['alternate-child', 'north', 'p1'],
    });
    return db;
}

describe('value-object reference loading', () => {
    it('uses a changed private-field FK', async () => {
        const db = await openContext();
        const child = requireDefined(await db.privateChildren.find('private-child'));
        child.parentId = new PrivateId('p2');

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id.providerValue()).toBe('p2');
        expect(child.parent).toBe(parent);
        await db.dispose();
    });

    it('uses a changed non-enumerable FK', async () => {
        const db = await openContext();
        const child = requireDefined(await db.hiddenChildren.find('hidden-child'));
        child.parentId = new HiddenId('p2');

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id.value).toBe('p2');
        expect(child.parent).toBe(parent);
        await db.dispose();
    });

    it('loads a converted composite alternate key across model types', async () => {
        const db = await openContext();
        const child = requireDefined(
            await db.alternateChildren.find('alternate-child'),
        );
        child.parentCode = new DependentCode('p2');

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id).toBe('a2');
        expect(parent?.code.providerValue()).toBe('p2');
        expect(child.parent).toBe(parent);
        await db.dispose();
    });
});
