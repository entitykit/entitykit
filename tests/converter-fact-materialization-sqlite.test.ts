import { join } from 'node:path';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import {
    StrongId,
    strongIdConverter,
} from './support/converter-fact-support';

let databaseFile = '';

/** A materialized value the accessor silently swaps for a different one. */
function substituted(value: StrongId, refused: string): StrongId {
    return value.value === refused ? new StrongId('WRONG') : value;
}

class HostileKeyRow {
    #storedId = new StrongId('');
    public label = '';

    public get id(): StrongId {
        return this.#storedId;
    }

    public set id(value: StrongId) {
        this.#storedId = substituted(value, 'k1');
    }
}

class HostileAlternateRow {
    #storedCode = new StrongId('');
    public id = '';

    public get code(): StrongId {
        return this.#storedCode;
    }

    public set code(value: StrongId) {
        this.#storedCode = substituted(value, 'a1');
    }
}

class HostileTenantRow {
    #storedTenant = new StrongId('');
    public id = '';
    public label = '';

    public get tenantId(): StrongId {
        return this.#storedTenant;
    }

    public set tenantId(value: StrongId) {
        this.#storedTenant = substituted(value, 't1');
    }
}

class WellBehavedKeyRow {
    public id = new StrongId('');
    public label = '';
}

class HostileMaterializationContext extends DbContext {
    public keys = this.set(HostileKeyRow);
    public alternates = this.set(HostileAlternateRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, databaseFile);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(HostileKeyRow, entity => {
            entity.toTable('fact_key_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
        model.entity(HostileAlternateRow, entity => {
            entity.toTable('fact_alternate_rows');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => row.code);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.code).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
        });
    }
}

class TenantMaterializationContext extends DbContext {
    public rows = this.set(HostileTenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, databaseFile)
            .useTenantScope(() => new StrongId('t1'));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(HostileTenantRow, entity => {
            entity.toTable('fact_tenant_rows');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(strongIdConverter)
                .isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

/** The same `fact_key_rows` row read through a well-behaved entity class. */
class WellBehavedContext extends DbContext {
    public keys = this.set(WellBehavedKeyRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, databaseFile);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(WellBehavedKeyRow, entity => {
            entity.toTable('fact_key_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

async function seed(): Promise<void> {
    const hostile = HostileMaterializationContext.create();
    await hostile.database.connection.query({
        text: hostile.database.createScript(), values: [],
    });
    await hostile.database.connection.query({
        text: 'insert into fact_key_rows (id, label) values (?, ?)',
        values: ['k1', 'first'],
    });
    await hostile.database.connection.query({
        text: 'insert into fact_alternate_rows (id, code) values (?, ?)',
        values: ['r1', 'a1'],
    });
    await hostile.dispose();
    const tenant = TenantMaterializationContext.create();
    await tenant.database.connection.query({
        text: tenant.database.createScript(), values: [],
    });
    await tenant.database.connection.query({
        text: `insert into fact_tenant_rows (id, tenant_id, label)
            values (?, ?, ?)`,
        values: ['s1', 't1', 'scoped'],
    });
    await tenant.dispose();
}

describe('converter-aware materialization of private-field keys', () => {
    beforeEach(async () => {
        databaseFile = join(
            createManagedTempDirectory('ek-converter-fact-'), 'facts.db',
        );
        await seed();
    });

    it('fails a query whose private-field primary key is swapped', async () => {
        const db = HostileMaterializationContext.create();

        const failure = await rejection(async () => db.keys.toArray());

        expect(refusalMessage(failure)).toBe(
            'Property \'HostileKeyRow.id\' refused its assigned value.',
        );
        expect(db.changeTracker.entries()).toEqual([]);
        await db.dispose();
    });

    it('fails a query whose private-field alternate key is swapped', async () => {
        const db = HostileMaterializationContext.create();

        const failure = await rejection(async () =>
            db.alternates.where(row => row.id.eq('r1')).toArray());

        expect(refusalMessage(failure)).toBe(
            'Property \'HostileAlternateRow.code\' refused its assigned value.',
        );
        expect(db.changeTracker.entries()).toEqual([]);
        await db.dispose();
    });

    it('fails a tenant-scoped query whose converted tenant key is swapped', async () => {
        const db = TenantMaterializationContext.create();

        const failure = await rejection(async () => db.rows.toArray());

        expect(refusalMessage(failure)).toBe(
            'Property \'HostileTenantRow.tenantId\' refused its assigned value.',
        );
        expect(db.changeTracker.entries()).toEqual([]);
        await db.dispose();
    });

    it('keeps the context usable and reads the row through a sound class', async () => {
        const db = HostileMaterializationContext.create();
        await rejection(async () => db.keys.toArray());

        await expect(db.keys.count()).resolves.toBe(1);
        expect(db.changeTracker.entries()).toEqual([]);
        const sound = WellBehavedContext.create();
        const rows = await sound.keys.toArray();

        expect(rows).toHaveLength(1);
        expect(requireDefined(rows[0]).id).toBeInstanceOf(StrongId);
        expect(requireDefined(rows[0]).id.value).toBe('k1');
        expect(requireDefined(rows[0]).label).toBe('first');
        await sound.dispose();
        await db.dispose();
    });
});
