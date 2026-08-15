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
import { buildGeneratedValueRefresh } from './generated-value-refresh';
import type { AppliedPropertyValue, GeneratedValueAcceptance } from './applied-generated-value';
import { GeneratedValueRecorder } from './generated-value-recorder';
import { applyGeneratedInsertIdentity } from './generated-insert-identity';
import { assertFinalGeneratedIdentity } from './generated-final-identity';
import { restoreGeneratedValuesAfterFailure } from './generated-value-rollback';
import { applyTrackedGeneratedRow } from './tracked-generated-row';
import { applyTrackedGeneratedKeyPropagation } from './tracked-generated-key-propagation';
import type { RestorationScope } from '../../restoration-scope';
export class GeneratedValueHydrator {
    private readonly mutations = new SaveTimeMutationLog();
    private readonly recorded: GeneratedValueRecorder;
    constructor(
        private readonly database: DatabaseConnection,
        private readonly dialect: SqlDialect,
        private readonly changeTracker: ChangeTracker,
        private readonly scope: RestorationScope,
        private readonly valueReader?: StoreValueReader,
    ) {
        this.recorded = new GeneratedValueRecorder(changeTracker);
    }
    public accept(): GeneratedValueAcceptance {
        const sources = this.recorded.rollbackSources();
        const rollback = this.mutations.takeRollback();
        return {
            values: this.recorded.take(),
            rollback: () => {
                restoreGeneratedValuesAfterFailure(
                    this.changeTracker, sources, rollback);
            },
        };
    }
    public restore(): void {
        const sources = this.recorded.rollbackSources();
        this.recorded.take();
        restoreGeneratedValuesAfterFailure(
            this.changeTracker, sources,
            this.mutations.restore.bind(this.mutations),
        );
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
        persistedBoundValues: Readonly<Record<string, unknown>> = {},
        options?: DatabaseOperationOptions,
    ): Promise<void> {
        if (!plan) return;
        const properties = plan.propertyNames.map(propertyName =>
            plan.metadata.getProperty(propertyName as never));
        if (result.rows.length > 0) {
            applyTrackedGeneratedRow({
                entity: entry.entity,
                metadata: plan.metadata,
                properties,
                row: result.rows[0],
                sourceBoundValues: persistedBoundValues,
                recorder: this.recorded,
                mutations: this.mutations,
                scope: this.scope,
                valueReader: this.valueReader,
            });
            assertFinalGeneratedIdentity(
                this.changeTracker, this.recorded, entry, plan.metadata,
                persistedValues, persistedBoundValues,
            );
            return;
        }
        const insertedIdentity = applyGeneratedInsertIdentity(
            entry,
            properties,
            result.insertId,
            this.mutations,
            this.recorded,
            persistedBoundValues,
            this.scope,
            this.valueReader,
        );
        const remaining = properties.filter(property => property !== insertedIdentity);
        if (remaining.length > 0) {
            const refresh = await this.database.query(
                buildGeneratedValueRefresh(
                    this.dialect,
                    plan.metadata,
                    remaining,
                    propertyName => {
                        const fact = this.recorded.find(entry.entity, propertyName);
                        return fact?.boundValue ??
                            persistedBoundValues[propertyName];
                    },
                ),
                options,
            );
            if (refresh.rows.length === 0) {
                throw new Error(
                    `The '${this.dialect.name}' provider saved '${entry.entityName}' but could not refresh its database-generated values.`,
                );
            }
            applyTrackedGeneratedRow({
                entity: entry.entity,
                metadata: plan.metadata,
                properties: remaining,
                row: refresh.rows[0],
                sourceBoundValues: persistedBoundValues,
                recorder: this.recorded,
                mutations: this.mutations,
                scope: this.scope,
                valueReader: this.valueReader,
            });
        }
        assertFinalGeneratedIdentity(
            this.changeTracker, this.recorded, entry, plan.metadata,
            persistedValues, persistedBoundValues,
        );
    }
    public propagateGeneratedKeys(
        entry: SavePlanEntry,
        persistedValues: Record<string, unknown>, persistedBoundValues: Record<string, unknown>,
        propagations?: readonly GeneratedKeyPropagation[],
    ): void {
        applyTrackedGeneratedKeyPropagation({
            tracker: this.changeTracker,
            entry,
            persistedValues,
            persistedBoundValues,
            mutations: this.mutations,
            recorder: this.recorded,
            scope: this.scope,
            propagations,
        });
    }
}
