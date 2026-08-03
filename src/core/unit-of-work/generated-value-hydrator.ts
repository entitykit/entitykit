import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
} from '../../storage/database-connection';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { PropertyMetadata } from '../../model/property-metadata';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { ChangeTracker } from '../../tracking/change-tracker';
import type { SavePlanEntry } from '../save-plan';
import type {
    GeneratedKeyPropagation,
    GeneratedValuesPlan,
} from '../save-plan-execution';
import { SaveTimeMutationLog } from '../save-time-mutations';
import { propagateGeneratedKeys } from './generated-key-propagator';
import { buildGeneratedValueRefresh } from './generated-value-refresh';
import { EntityState } from '../../tracking/entity-state';
import { assertGeneratedIdentityAvailable } from './generated-identity-assertion';
import {
    writeGeneratedRow,
    writeGeneratedValue,
} from './generated-value-writer';

/** Hydrates database-generated values and restores them when a save rolls back. */
export class GeneratedValueHydrator {
    private readonly mutations = new SaveTimeMutationLog();

    constructor(
        private readonly database: DatabaseConnection,
        private readonly dialect: SqlDialect,
        private readonly changeTracker: ChangeTracker,
        private readonly valueReader?: StoreValueReader,
    ) {}

    public reset(): void {
        this.mutations.reset();
    }

    public accept(): () => void {
        return this.mutations.takeRollback();
    }

    public restore(): void {
        this.mutations.restore();
    }

    public async hydrate(
        entry: SavePlanEntry,
        result: DatabaseQueryResult,
        plan?: GeneratedValuesPlan,
        options?: DatabaseOperationOptions,
    ): Promise<void> {
        if (!plan) {
            return;
        }

        const properties = plan.propertyNames.map(propertyName =>
            plan.metadata.getProperty(propertyName as never));
        if (result.rows.length > 0) {
            writeGeneratedRow(
                entry.entity,
                plan.metadata,
                properties,
                result.rows[0],
                this.mutations,
                this.valueReader,
            );
            this.assertFinalIdentity(entry);
            return;
        }

        const insertedIdentity = this.applyInsertedIdentity(
            entry,
            properties,
            result.insertId,
        );
        const remaining = properties.filter(property =>
            property !== insertedIdentity);
        if (remaining.length > 0) {
            const refresh = await this.database.query(
                buildGeneratedValueRefresh(
                    this.dialect,
                    plan.metadata,
                    remaining,
                    entry.entity,
                ),
                options,
            );
            if (refresh.rows.length === 0) {
                throw new Error(
                    `The '${this.dialect.name}' provider saved '${entry.entityName}' but could not refresh its database-generated values.`,
                );
            }
            writeGeneratedRow(
                entry.entity,
                plan.metadata,
                remaining,
                refresh.rows[0],
                this.mutations,
                this.valueReader,
            );
        }
        this.assertFinalIdentity(entry);
    }

    public propagateGeneratedKeys(
        entry: SavePlanEntry,
        propagations?: readonly GeneratedKeyPropagation[],
    ): void {
        propagateGeneratedKeys(entry, this.mutations, propagations);
    }

    private applyInsertedIdentity(
        entry: SavePlanEntry,
        properties: readonly PropertyMetadata[],
        insertId: unknown,
    ): PropertyMetadata | undefined {
        if (entry.state !== EntityState.Added ||
            insertId === undefined || insertId === null ||
            insertId === '' || insertId === 0 || insertId === 0n) {
            return undefined;
        }
        const generatedKeys = properties.filter(property =>
            property.isPrimaryKey);
        if (generatedKeys.length !== 1) {
            return undefined;
        }
        writeGeneratedValue(
            entry.entity,
            generatedKeys[0],
            insertId,
            this.mutations,
            this.valueReader,
        );
        return generatedKeys[0];
    }

    private assertFinalIdentity(entry: SavePlanEntry): void {
        assertGeneratedIdentityAvailable(this.changeTracker, entry);
    }
}
