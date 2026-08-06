import type { DatabaseConnection, DatabaseOperationOptions, DatabaseQueryResult } from '../../storage/database-connection';
import type { StoreValueReader } from '../../storage/store-value-reader';
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
import { assertGeneratedIdentityAvailable } from './generated-identity-assertion';
import { writeGeneratedRow } from './generated-value-writer';
import type { AppliedPropertyValue, GeneratedValueAcceptance } from './applied-generated-value';
import { GeneratedValueRecorder } from './generated-value-recorder';
import { applyGeneratedInsertIdentity } from './generated-insert-identity';
import type { EntityMetadata } from '../../model/entity-metadata';
export class GeneratedValueHydrator {
    private readonly mutations = new SaveTimeMutationLog();
    private readonly recorded: GeneratedValueRecorder;
    constructor(
        private readonly database: DatabaseConnection,
        private readonly dialect: SqlDialect,
        private readonly changeTracker: ChangeTracker,
        private readonly valueReader?: StoreValueReader,
    ) {
        this.recorded = new GeneratedValueRecorder(changeTracker);
    }
    public accept(): GeneratedValueAcceptance {
        return {
            values: this.recorded.take(),
            rollback: this.mutations.takeRollback(),
        };
    }

    public restore(): void {
        this.mutations.restore();
    }

    public findPersistedValue(
        entity: object,
        propertyName: string,
    ): AppliedPropertyValue | undefined {
        return this.recorded.find(entity, propertyName);
    }

    public async hydrate(
        entry: SavePlanEntry,
        result: DatabaseQueryResult,
        plan?: GeneratedValuesPlan,
        persistedValues: Readonly<Record<string, unknown>> = {},
        options?: DatabaseOperationOptions,
    ): Promise<void> {
        if (!plan) {
            return;
        }

        const properties = plan.propertyNames.map(propertyName =>
            plan.metadata.getProperty(propertyName as never));
        if (result.rows.length > 0) {
            this.recorded.record(entry.entity, writeGeneratedRow(
                entry.entity,
                plan.metadata,
                properties,
                result.rows[0],
                this.mutations,
                this.valueReader,
            ));
            this.assertFinalIdentity(entry, plan.metadata, persistedValues);
            return;
        }

        const insertedIdentity = applyGeneratedInsertIdentity(
            entry,
            properties,
            result.insertId,
            this.mutations,
            this.recorded,
            this.valueReader,
        );
        const remaining = properties.filter(property =>
            property !== insertedIdentity);
        if (remaining.length > 0) {
            const refresh = await this.database.query(
                buildGeneratedValueRefresh(
                    this.dialect,
                    plan.metadata,
                    remaining,
                    propertyName => {
                        const fact = this.recorded.find(entry.entity, propertyName);
                        return fact?.persistedValue ?? persistedValues[propertyName];
                    },
                ),
                options,
            );
            if (refresh.rows.length === 0) {
                throw new Error(
                    `The '${this.dialect.name}' provider saved '${entry.entityName}' but could not refresh its database-generated values.`,
                );
            }
            this.recorded.record(entry.entity, writeGeneratedRow(
                entry.entity,
                plan.metadata,
                remaining,
                refresh.rows[0],
                this.mutations,
                this.valueReader,
            ));
        }
        this.assertFinalIdentity(entry, plan.metadata, persistedValues);
    }

    public propagateGeneratedKeys(
        entry: SavePlanEntry,
        persistedValues: Record<string, unknown>,
        propagations?: readonly GeneratedKeyPropagation[],
    ): void {
        this.recorded.record(
            entry.entity,
            propagateGeneratedKeys(
                entry,
                persistedValues,
                this.mutations,
                propagations,
                (principal, propertyName) =>
                    this.recorded.find(principal, propertyName),
            ),
        );
    }

    private assertFinalIdentity(
        entry: SavePlanEntry,
        metadata: EntityMetadata,
        persistedValues: Readonly<Record<string, unknown>>,
    ): void {
        const keyValues = metadata.keyProperties.map(propertyName =>
            this.recorded.find(entry.entity, propertyName)?.persistedValue ??
            persistedValues[propertyName]);
        assertGeneratedIdentityAvailable(
            this.changeTracker,
            entry,
            keyValues,
            persistedValues,
        );
    }
}
