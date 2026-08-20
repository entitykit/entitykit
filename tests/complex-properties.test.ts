import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../packages/core/src';
import {
    DbContext,
    EntityState,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class Coordinates {
    public latitude!: number;
    public longitude!: number;

    public label(): string {
        return `${String(this.latitude)},${String(this.longitude)}`;
    }
}

class Address {
    public line1!: string;
    public city!: string;
    public countryCode!: string;
    public coordinates?: Coordinates | null;

    public label(): string {
        return `${this.line1}, ${this.city}`;
    }
}

class BillingAddress {
    public city?: string | null;
    public reference?: string | null;
}

class ServerInfo {
    public slug?: string;
}

class Customer {
    public id!: string;
    public name!: string;
    public address!: Address;
    public billing?: BillingAddress | null;
    public server?: ServerInfo | null;

    constructor(data?: Partial<Customer>) {
        Object.assign(this, data);
    }
}

const countryCodeConverter: ValueConverter<string, string> = {
    fromProvider: value => value.toUpperCase(),
    toProvider: value => value.toLowerCase(),
};

function defineCustomer(model: ModelBuilder): void {
    model.entity(Customer, entity => {
        entity.toTable('customers');
        entity.hasKey(customer => customer.id);
        entity.property(customer => customer.id).hasColumnType('text').isRequired();
        entity.property(customer => customer.name).hasColumnType('text').isRequired();
        entity.complexProperty(
            customer => customer.address,
            { constructor: Address, required: true },
            address => {
                address.property(value => value.line1)
                    .hasColumnName('address_line1').hasColumnType('text').isRequired();
                address.property(value => value.city)
                    .hasColumnName('address_city').hasColumnType('text').isRequired();
                address.property(value => value.countryCode)
                    .hasColumnName('address_country').hasColumnType('text').isRequired()
                    .hasConversion(countryCodeConverter);
                address.complexProperty(
                    value => value.coordinates,
                    { constructor: Coordinates },
                    coordinates => {
                        coordinates.property(value => value.latitude)
                            .hasColumnName('address_latitude').hasColumnType('real').isOptional();
                        coordinates.property(value => value.longitude)
                            .hasColumnName('address_longitude').hasColumnType('real').isOptional();
                    },
                );
            },
        );
        entity.complexProperty(
            customer => customer.billing,
            { constructor: BillingAddress },
            billing => {
                billing.property(value => value.city)
                    .hasColumnName('billing_city').hasColumnType('text').isOptional();
                billing.property(value => value.reference)
                    .hasColumnName('billing_reference').hasColumnType('text').isOptional();
            },
        );
        entity.complexProperty(
            customer => customer.server,
            { constructor: ServerInfo },
            server => {
                server.property(value => value.slug)
                    .hasColumnName('server_slug').hasColumnType('text')
                    .hasDefaultSql('\'assigned\'').valueGeneratedOnAdd();
            },
        );
    });
}

class CustomerContext extends DbContext {
    public customers = this.set(Customer);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        defineCustomer(model);
    }
}

async function openContext(): Promise<CustomerContext> {
    const db = CustomerContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

function customer(
    id: string,
    billing: BillingAddress | null = null,
): Customer {
    return new Customer({
        id,
        name: `Customer ${id}`,
        address: Object.assign(new Address(), {
            line1: '1 Main Street',
            city: 'Paris',
            countryCode: 'FR',
            coordinates: Object.assign(new Coordinates(), {
                latitude: 48.8566,
                longitude: 2.3522,
            }),
        }),
        billing,
    });
}

describe('complex value objects', () => {
    it('flattens writes and restores nested constructors on reads', async () => {
        const db = await openContext();
        const inserted = customer('one');
        db.customers.add(inserted);
        await db.saveChanges();
        expect(inserted.server).toBeInstanceOf(ServerInfo);
        expect(inserted.server?.slug).toBe('assigned');
        db.changeTracker.clear();

        const loaded = requireDefined(await db.customers.find('one'));

        expect(loaded.address).toBeInstanceOf(Address);
        expect(loaded.address.label()).toBe('1 Main Street, Paris');
        expect(loaded.address.coordinates).toBeInstanceOf(Coordinates);
        expect(loaded.address.coordinates?.label()).toBe('48.8566,2.3522');
        expect(loaded.address.countryCode).toBe('FR');
        expect(loaded.billing).toBeNull();
        expect(loaded.server).toBeInstanceOf(ServerInfo);
        await db.dispose();
    });

    it('queries and projects nested leaves with typed SQL expressions', async () => {
        const db = await openContext();
        db.customers.add(customer('one'));
        const second = customer('two');
        second.address.city = 'Berlin';
        second.address.countryCode = 'DE';
        db.customers.add(second);
        await db.saveChanges();
        db.changeTracker.clear();

        const rows = await db.customers
            .where(item => item.address.city.eq('Paris'))
            .orderBy(item => item.address.countryCode)
            .select((item, sql) => ({
                city: item.address.city,
                country: sql.upper(item.address.countryCode),
                location: { latitude: item.address.coordinates.latitude },
            }))
            .toArray();

        expect(rows).toEqual([{
            city: 'Paris',
            country: 'FR',
            location: { latitude: 48.8566 },
        }]);
        await db.dispose();
    });

    it('tracks leaf edits, object replacement, and optional null transitions', async () => {
        const db = await openContext();
        db.customers.add(customer('one', Object.assign(new BillingAddress(), {
            city: 'London',
            reference: 'old',
        })));
        await db.saveChanges();
        db.changeTracker.clear();
        const loaded = requireDefined(await db.customers.find('one'));

        loaded.address.city = 'Lyon';
        loaded.billing = null;
        const entry = requireDefined(db.entry(loaded));
        entry.detectChanges();

        expect(entry.state).toBe(EntityState.Modified);
        expect(entry.modifiedProperties()).toEqual([
            'address.city',
            'billing.city',
            'billing.reference',
        ]);

        loaded.address = Object.assign(new Address(), {
            line1: '2 River Road',
            city: 'Nice',
            countryCode: 'FR',
            coordinates: null,
        });
        await db.saveChanges();
        db.changeTracker.clear();
        const reloaded = requireDefined(await db.customers.find('one'));

        expect(reloaded.address).toMatchObject({
            line1: '2 River Road',
            city: 'Nice',
            countryCode: 'FR',
            coordinates: null,
        });
        expect(reloaded.billing).toBeNull();
        await db.dispose();
    });

    it('supports nested database snapshots and recursive bulk updates', async () => {
        const db = await openContext();
        db.customers.add(customer('one', Object.assign(new BillingAddress(), {
            city: 'Rome',
            reference: 'keep-me',
        })));
        await db.saveChanges();
        const tracked = requireDefined(await db.customers.find('one'));
        const values = requireDefined(
            await requireDefined(db.entry(tracked)).getDatabaseValues(),
        );
        const city: string = values.get(item => item.address.city);
        expect(city).toBe('Paris');

        db.changeTracker.clear();
        await db.customers
            .where(item => item.id.eq('one'))
            .executeUpdate({ address: { city: 'Oslo' } });
        await db.customers
            .where(item => item.id.eq('one'))
            .executeUpdate({ billing: null });

        const reloaded = requireDefined(await db.customers.find('one'));
        expect(reloaded.address).toMatchObject({
            city: 'Oslo',
            line1: '1 Main Street',
        });
        expect(reloaded.billing).toBeNull();
        await db.dispose();
    });

    it('rejects null writes for a required complex object before SQL', async () => {
        const db = await openContext();
        const invalid = customer('one');
        invalid.address = null as unknown as Address;
        db.customers.add(invalid);

        await expect(db.saveChanges()).rejects.toThrow(
            'Required complex property \'Customer.address\' must have a value.',
        );
        await expect(db.customers
            .where(item => item.id.eq('one'))
            .executeUpdate({ address: null as unknown as Address }))
            .rejects.toThrow(
                'Required complex property \'Customer.address\' must have a value.',
            );
        await db.dispose();
    });
});
