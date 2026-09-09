import type { EntityConstructor } from '../types';
import type { DbSet } from './db-set-types';
import type { DbSetCreationOptions, EntityCreationConstructor, EntityCreationFunction, EntityCreationResult, EntityCreationArguments, ValidCreationFactory } from './db-set-creation-types';
import { dbSetCreationFactory } from './db-set-create';
import type { DbContextHost } from './db-context-host';

/** Constructor-aware set registration, shared by every context. */
export abstract class DbContextSets {
    constructor(private readonly setHost: () => DbContextHost) {}
    /** Bind a creation factory to this gateway; other sets retain their construction policy. */
    public set<TEntity extends object, TFactory extends EntityCreationFunction<NoInfer<TEntity>>, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: EntityConstructor<TEntity>, options: DbSetCreationOptions<TFactory> & ValidCreationFactory<NoInfer<TEntity>, NoInfer<TFactory>>,
    ): DbSet<TEntity, TKey, EntityCreationArguments<TFactory>>;
    /** Infer creation arguments from a public constructor. */
    public set<TConstructor extends EntityCreationConstructor, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: TConstructor,
    ): DbSet<EntityCreationResult<TConstructor>, TKey, EntityCreationArguments<TConstructor>>;
    /** Preserve identity-only registration and existing entity/key type arguments. */
    public set<TEntity extends object, TKey extends readonly unknown[] = readonly unknown[]>(
        entityType: EntityConstructor<TEntity>,
    ): DbSet<TEntity, TKey>;
    public set<TEntity extends object>(
        entityType: EntityConstructor<TEntity>, options?: DbSetCreationOptions<EntityCreationFunction<TEntity>>,
    ): unknown {
        return this.setHost().set(entityType, dbSetCreationFactory(options));
    }
}
