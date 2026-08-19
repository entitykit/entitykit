import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';

export interface ManyToManyChange {
    readonly action: 'link' | 'unlink';
    readonly source: object;
    readonly target: object;
    readonly sourceMetadata: EntityMetadata;
    readonly targetMetadata: EntityMetadata;
    readonly relationship: ManyToManyMetadata;
}
