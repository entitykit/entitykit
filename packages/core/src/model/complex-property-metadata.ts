import type { EntityConstructor } from '../types';

/** A flattened, table-sharing value-object node in an entity mapping. */
export interface ComplexPropertyMetadata {
    readonly propertyName: string;
    readonly propertyPath: readonly string[];
    readonly isRequired: boolean;
    readonly ctor?: EntityConstructor<object>;
}

export interface MutableComplexPropertyMetadata {
    propertyName: string;
    propertyPath: readonly string[];
    isRequired?: boolean;
    ctor?: EntityConstructor<object>;
}
