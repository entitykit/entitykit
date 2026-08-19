import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { EntityConstructor } from '../types';

/** Relationship metadata widened to runtime string property names. */
export type TrackedRelationshipMetadata = Omit<
    RelationshipMetadata,
    'navigationProperty' |
    'inverseNavigationProperty' |
    'foreignKeyProperty' |
    'foreignKeyProperties' |
    'principalKeyProperties' |
    'principalEntity'
> & {
    readonly navigationProperty: string;
    readonly inverseNavigationProperty?: string;
    readonly foreignKeyProperty?: string;
    readonly foreignKeyProperties: readonly string[];
    readonly principalKeyProperties?: readonly string[];
    readonly principalEntity: EntityConstructor<Record<string, unknown>>;
};
