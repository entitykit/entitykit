import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { DbContextOptionsBuilder ,
    ModelBuilder } from '../src';
import {
    DbContext,
    DeleteBehavior,
    type EntityBuilder,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

/**
 * A team's most common failure is a wrong model, not a wrong query. These pin
 * the misconfigurations that used to build successfully and then misbehave
 * silently — the model reads as though a rule is in force while nothing
 * enforces it.
 */
class Doc {
    public id!: string;
    public tenantId!: string;
    public title!: string;
    public deletedAt!: Date | null;

    constructor(data?: Partial<Doc>) {
        Object.assign(this, data);
    }
}

type EntityConfigurer = (entity: EntityBuilder<Doc>) => void;

/** Build a context with the given model tweak, returning what it did. */
function build(
    configureEntity: EntityConfigurer,
    configureOptions?: (options: DbContextOptionsBuilder) => void,
): { built: true; context: DbContext } | { built: false; message: string } {
    class ProbeDbContext extends DbContext {
        public docs = this.set(Doc);

        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
            configureOptions?.(options);
        }

        protected override model(model: ModelBuilder): void {
            model.entity(Doc, entity => {
                entity.toTable('docs');
                entity.hasKey(doc => doc.id);
                entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
                entity.property(doc => doc.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
                entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
                entity.property(doc => doc.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
                configureEntity(entity);
            });
        }
    }

    try {
        return { built: true, context: ProbeDbContext.create() };
    } catch (error) {
        return { built: false, message: (error as Error).message };
    }
}

describe('model misconfiguration', () => {
    it('refuses a tenant key with no tenant scope configured', () => {
    // Without a tenant provider `currentTenantId()` is always undefined, which
    // disables both halves of tenancy at once: queries stop being scoped, and
    // the save-time guard stops rejecting another tenant's rows. Measured
    // before the fix: a context in this state saved rows for two tenants
    // without complaint and read all of them back.
        const result =  build(entity => entity.tenantKey(doc => doc.tenantId));

        expect(result.built).toBe(false);
        if (result.built) return;
        expect(result.message).toContain('Entity \'Doc\' configures a tenant key');
        expect(result.message).toContain('no tenant scope is configured');
        expect(result.message).toContain('options.useTenantScope(...)');
    });

    it('accepts a tenant key once a tenant scope is configured', async () => {
        const result =  build(
            entity => entity.tenantKey(doc => doc.tenantId),
            options => options.useTenantScope(() => 't1'),
        );

        expect(result.built).toBe(true);
        if (!result.built) return;
        await result.context.dispose();
    });

    it('fails closed when a configured tenant provider returns no identity', async () => {
        const result =  build(
            entity => entity.tenantKey(doc => doc.tenantId),
            options => options.useTenantScope(() => undefined),
        );

        expect(result.built).toBe(true);
        if (!result.built) return;
        await expect(result.context.set(Doc).toArray())
            .rejects.toThrow('Tenant scope is unavailable');
        await result.context.dispose();
    });

    it('refuses a required soft-delete marker', () => {
    // A live row is one whose marker is null, so a `not null` marker hides
    // every row forever. Measured before the fix: the schema script emitted
    // `"title" text not null` and every query carried `"title" is null`.
        const result =  build(entity => entity.softDelete(doc => doc.title));

        expect(result.built).toBe(false);
        if (result.built) return;
        expect(result.message).toContain('Soft delete property \'title\' on entity \'Doc\' must be nullable');
        expect(result.message).toContain('a live row is one whose marker is null');
    });

    it('accepts a nullable soft-delete marker', async () => {
        const result =  build(entity => entity.softDelete(doc => doc.deletedAt));

        expect(result.built).toBe(true);
        if (!result.built) return;
        await result.context.dispose();
    });

    it('refuses an index that lists a property twice', () => {
    // Legal SQL, never intentional, and already refused for keys.
        const result =  build(entity => entity.hasIndex(doc => [doc.title, doc.title]));

        expect(result.built).toBe(false);
        if (result.built) return;
        expect(result.message).toBe('Index on entity \'Doc\' lists property \'title\' more than once.');
    });

    it('refuses SetNull when a foreign-key property is required', () => {
        class Principal {
            public id!: string;
        }
        class Dependent {
            public id!: string;
            public principalId!: string;
            public principal!: Principal | null;
        }
        const model = new ModelBuilderImplementation();
        model.entity(Principal, entity => {
            entity.toTable('principals');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
        });
        model.entity(Dependent, entity => {
            entity.toTable('dependents');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.principalId).hasColumnType('text').isRequired();
            entity.hasOne(Principal, item => item.principal)
                .withMany()
                .hasForeignKey(item => item.principalId)
                .onDelete(DeleteBehavior.SetNull);
        });

        expect(() => model.build()).toThrow(
            'uses SetNull, but every foreign-key property must be optional',
        );
    });

    describe('guards that were already in place', () => {
    // Recorded from the same sweep so the coverage shows what was checked, not
    // only what was broken.

        it('refuses two entities mapped to the same table', () => {
            class Other {
                public id!: string;
            }

            class ClashDbContext extends DbContext {
                protected override configure(options: DbContextOptionsBuilder): void {
                    options.useProvider(sqliteProviderServices, ':memory:');
                }

                protected override model(model: ModelBuilder): void {
                    model.entity(Doc, entity => {
                        entity.toTable('docs');
                        entity.hasKey(doc => doc.id);
                        entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
                    });
                    model.entity(Other, entity => {
                        entity.toTable('docs');
                        entity.hasKey(other => other.id);
                        entity.property(other => other.id).hasColumnName('id').hasColumnType('text').isRequired();
                    });
                }
            }

            expect(() => ClashDbContext.create()).toThrow(
                'Entities \'Doc\' and \'Other\' map to the same table \'docs\'.',
            );
        });

        it('refuses a key that lists a property twice', () => {
            const result =  build(entity => entity.hasKey(doc => [doc.id, doc.id]));

            expect(result.built).toBe(false);
            if (result.built) return;
            expect(result.message).toBe('Key of entity \'Doc\' lists property \'id\' more than once.');
        });

        it('merges repeated configuration of the same entity, last call winning', async () => {
            // Not a defect: `model.entity(...)` returns the same builder each time,
            // matching EF and making `applyConfiguration` composable.
            class MergedDbContext extends DbContext {
                public docs = this.set(Doc);

                protected override configure(options: DbContextOptionsBuilder): void {
                    options.useProvider(sqliteProviderServices, ':memory:');
                }

                protected override model(model: ModelBuilder): void {
                    model.entity(Doc, entity => {
                        entity.toTable('docs');
                        entity.hasKey(doc => doc.id);
                        entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
                    });
                    model.entity(Doc, entity => {
                        entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
                    });
                }
            }

            const db =  MergedDbContext.create();
            expect(db.docs.where(doc => doc.id.eq('x')).toSql().text)
                .toContain('select "id", "title" from "docs"');
            await db.dispose();
        });
    });
});
