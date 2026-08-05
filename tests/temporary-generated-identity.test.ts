import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class NumberItem {
    public id = 0;
    public name = '';
}

class BigIntItem {
    public id = 0n;
    public name = '';
}

class ConvertedItem {
    public id = '0';
    public name = '';
}

class CompositeItem {
    public tenantId = '';
    public id = 0;
    public name = '';
}

const stringNumber = valueConverter<string, number>({
    toProvider: value => Number(value),
    fromProvider: value => String(value),
});

class TemporaryIdentityContext extends DbContext {
    public numbers = this.set(NumberItem);
    public bigints = this.set(BigIntItem);
    public converted = this.set(ConvertedItem);
    public composites = this.set(CompositeItem);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(NumberItem, entity => {
            entity.toTable('number_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(BigIntItem, entity => {
            entity.toTable('bigint_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('bigint').isRequired()
                .valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(ConvertedItem, entity => {
            entity.toTable('converted_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('integer').isRequired()
                .hasConversion(stringNumber).valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(CompositeItem, entity => {
            entity.toTable('composite_items');
            entity.hasKey(item => [item.tenantId, item.id]);
            entity.property(item => item.tenantId).hasColumnType('text').isRequired();
            entity.property(item => item.id).hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
    }
}

describe('temporary generated identity', () => {
    it.each([
        ['number zero', (db: TemporaryIdentityContext) => db.numbers, () =>
            Object.assign(new NumberItem(), { name: 'number' })],
        ['bigint zero', (db: TemporaryIdentityContext) => db.bigints, () =>
            Object.assign(new BigIntItem(), { name: 'bigint' })],
        ['converted zero', (db: TemporaryIdentityContext) => db.converted, () =>
            Object.assign(new ConvertedItem(), { name: 'converted' })],
    ] as const)('tracks repeated %s placeholders independently', (
        _label,
        selectSet,
        create,
    ) => {
        const db = TemporaryIdentityContext.create(
            new RecordingDatabaseConnection(),
        );

        expect(() => {
            selectSet(db).add(create() as never);
            selectSet(db).add(create() as never);
        }).not.toThrow();
        expect(db.changeTracker.entries()).toHaveLength(2);
    });

    it('tracks repeated composite placeholders independently', () => {
        const db = TemporaryIdentityContext.create(
            new RecordingDatabaseConnection(),
        );
        db.composites.add(Object.assign(new CompositeItem(), {
            tenantId: 'tenant-a', name: 'first',
        }));
        db.composites.add(Object.assign(new CompositeItem(), {
            tenantId: 'tenant-a', name: 'second',
        }));

        expect(db.changeTracker.entries()).toHaveLength(2);
    });

    it('keeps a tracked real zero distinct from a new generated placeholder', () => {
        const db = TemporaryIdentityContext.create(
            new RecordingDatabaseConnection(),
        );
        const existing = Object.assign(new NumberItem(), {
            id: 0, name: 'existing',
        });
        const added = Object.assign(new NumberItem(), { name: 'new' });

        db.numbers.attach(existing);
        db.numbers.add(added);

        expect(db.entry(existing)).toBeDefined();
        expect(db.entry(added)).toBeDefined();
        expect(db.changeTracker.entries()).toHaveLength(2);
    });
});
