import type { EntityMetadata } from '../../model/entity-metadata';
import type { PropertyMetadata } from '../../model/property-metadata';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import { applyPreparedGeneratedRow } from './generated-value-writer';
import type { GeneratedValueRecorder } from './generated-value-recorder';
import { prepareGeneratedRow } from './prepared-generated-value';
import type { RestorationScope } from '../../restoration-scope';

interface TrackedGeneratedRow<TEntity extends object> {
    readonly entity: TEntity;
    readonly metadata: EntityMetadata<TEntity>;
    readonly properties: ReadonlyArray<PropertyMetadata<TEntity>>;
    readonly row: Readonly<Record<string, unknown>>;
    readonly sourceBoundValues: Readonly<Record<string, unknown>>;
    readonly recorder: GeneratedValueRecorder;
    readonly mutations: SaveTimeMutationLog;
    readonly scope: RestorationScope;
    readonly valueReader?: StoreValueReader;
}

/** Register provider facts before applying one prepared generated row. */
export function applyTrackedGeneratedRow<TEntity extends object>(
    options: TrackedGeneratedRow<TEntity>,
): void {
    const prepared = prepareGeneratedRow(
        options.metadata,
        options.properties,
        options.row,
        options.valueReader,
    );
    const tracked = options.recorder.register(
        options.entity,
        prepared,
        options.sourceBoundValues,
    );
    options.recorder.recordApplied(
        tracked,
        applyPreparedGeneratedRow(
            options.entity,
            options.metadata,
            prepared,
            options.mutations,
            options.scope,
        ),
    );
}
