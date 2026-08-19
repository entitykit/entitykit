import type { EntityEntry } from '../../tracking/entity-entry';

export interface AppliedPropertyValue {
    readonly propertyName: string;
    readonly persistedValue: unknown;
    readonly boundValue: unknown;
}

export interface AppliedGeneratedValue extends AppliedPropertyValue {
    readonly entry: EntityEntry<object>;
}

export interface GeneratedValueAcceptance {
    readonly values: readonly AppliedGeneratedValue[];
    readonly rollback: () => void;
}
