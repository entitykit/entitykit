import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { ContextStateRestorationError, DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { createdAncestorRestoration } from '../src/core/created-ancestor-restoration';
import { ensureComplexPropertyPath } from '../src/materialization/complex-value-materializer';
import { contextModel } from './support/public-api-internals';

class FragileTenantStamp {
    public tenantId?: string;
}

class FragileComplexRow {
    private storedScope: FragileTenantStamp | null = null;
    public id = '';
    public failCreation = false;
    public creationFailure: unknown;
    public restorationMode?: 'throw' | 'ignore';
    public restorationFailure = new Error('ancestor restoration failed');

    public get scope(): FragileTenantStamp | null {
        return this.storedScope;
    }
    public set scope(value: FragileTenantStamp | null) {
        if (value === null && this.restorationMode === 'throw') {
            throw this.restorationFailure;
        }
        if (value === null && this.restorationMode === 'ignore') return;
        if (value !== null && this.failCreation) {
            this.storedScope = Object.assign(new FragileTenantStamp(), {
                tenantId: 'partially-applied',
            });
            throw this.creationFailure;
        }
        this.storedScope = value;
    }
}

class FragileComplexContext extends DbContext {
    public rows = this.set(FragileComplexRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-one');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(FragileComplexRow, entity => {
            entity.toTable('fragile_complex_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.scope.tenantId);
            entity.complexProperty(
                row => row.scope,
                { constructor: FragileTenantStamp },
                scope => scope.property(value => value.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('text'),
            );
        });
    }
}

function rejected(action: () => unknown): unknown {
    try {
        action();
    } catch (error) {
        return error;
    }
    throw new Error('Expected operation to fail.');
}

describe('complex ancestor restoration failure', () => {
    it('consumes guarded ancestor rollback exactly once', () => {
        const previous = { name: 'previous' };
        const created = { name: 'created' };
        const target: Record<string, unknown> = { scope: created };
        const restoration = createdAncestorRestoration(
            target, 'scope', previous, created, () => true,
        );

        restoration.rollback();
        expect(target.scope).toBe(previous);
        target.scope = created;
        restoration.rollback();
        expect(target.scope).toBe(created);
    });

    it('preserves a replacement or edited created ancestor', () => {
        const previous = { name: 'previous' };
        const created = { name: 'created' };
        const replacement = { name: 'replacement' };
        const target: Record<string, unknown> = { scope: replacement };
        createdAncestorRestoration(
            target, 'scope', previous, created, () => true,
        ).rollback();
        expect(target.scope).toBe(replacement);

        target.scope = created;
        createdAncestorRestoration(
            target, 'scope', previous, created, () => false,
        ).rollback();
        expect(target.scope).toBe(created);
    });

    it('forces partial-write restoration exactly once', () => {
        const previous = { name: 'previous' };
        const created = { name: 'created' };
        const partial = { name: 'partial' };
        const target: Record<string, unknown> = { scope: partial };
        const restoration = createdAncestorRestoration(
            target, 'scope', previous, created, () => true,
        );

        restoration.restoreAfterWriteFailure();
        expect(target.scope).toBe(previous);
        target.scope = created;
        restoration.rollback();
        expect(target.scope).toBe(created);
    });

    it('supports path creation without lifecycle callbacks', async () => {
        const db = FragileComplexContext.create();
        const row = new FragileComplexRow();
        ensureComplexPropertyPath(
            contextModel(db).getEntity(FragileComplexRow),
            row,
            ['scope', 'tenantId'],
        );
        expect(row.scope).toBeInstanceOf(FragileTenantStamp);
        await db.dispose();
    });

    it('preserves a primitive creation failure without callbacks', async () => {
        const db = FragileComplexContext.create();
        const primary: unknown = Symbol('creation failed');
        const row = Object.assign(new FragileComplexRow(), {
            failCreation: true,
            creationFailure: primary,
        });

        expect(rejected(() => {
            ensureComplexPropertyPath(
                contextModel(db).getEntity(FragileComplexRow),
                row,
                ['scope', 'tenantId'],
            );
        })).toBe(primary);
        await db.dispose();
    });

    it.each(['throw', 'ignore'] as const)(
        'fails closed when an ancestor accessor chooses to %s restoration',
        async restorationMode => {
            const db = FragileComplexContext.create();
            const primary: unknown = Symbol('ancestor creation failed');
            const row = Object.assign(new FragileComplexRow(), {
                id: restorationMode,
                failCreation: true,
                creationFailure: primary,
                restorationMode,
            });

            expect(rejected(() => db.rows.add(row))).toBe(primary);
            expect(row.scope?.tenantId).toBe('partially-applied');
            expect(db.entry(row)).toBeUndefined();
            let unusable: unknown;
            try {
                await db.rows.count();
            } catch (error) {
                unusable = error;
            }
            expect(unusable).toBeInstanceOf(ContextStateRestorationError);
            if (restorationMode === 'throw') {
                expect((unusable as Error).cause)
                    .toBe(row.restorationFailure);
            } else {
                expect((unusable as Error).cause).toMatchObject({
                    message: 'Property \'scope\' refused its restoration value.',
                });
            }
            await db.dispose();
        },
    );
});
