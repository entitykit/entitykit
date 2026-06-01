/** Public type representing sequence data type. */ export type SequenceDataType = 'smallint' | 'integer' | 'bigint';

export interface SequenceMetadata {
    readonly name: string;
    readonly schemaName?: string;
    readonly dataType?: SequenceDataType;
    readonly startValue?: number | bigint;
    readonly incrementBy?: number | bigint;
    readonly minValue?: number | bigint;
    readonly maxValue?: number | bigint;
    readonly isCyclic: boolean;
    readonly cache?: number;
}

export interface MutableSequenceMetadata {
    name: string;
    schemaName?: string;
    dataType?: SequenceDataType;
    startValue?: number | bigint;
    incrementBy?: number | bigint;
    minValue?: number | bigint;
    maxValue?: number | bigint;
    isCyclic?: boolean;
    cache?: number;
}
