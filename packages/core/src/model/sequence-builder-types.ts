import type { SequenceDataType } from './sequence-metadata';

/** Configures a database sequence. */
export interface SequenceBuilder {
    /** Configure schema and return this builder. */ hasSchema(name: string): this;
    /** Configure data type and return this builder. */ hasDataType(dataType: SequenceDataType): this;
    /** Perform the starts at operation. */ startsAt(value: number | bigint): this;
    /** Perform the increments by operation. */ incrementsBy(value: number | bigint): this;
    /** Configure min and return this builder. */ hasMin(value: number | bigint): this;
    /** Configure max and return this builder. */ hasMax(value: number | bigint): this;
    /** Configure cyclic and return this builder. */ isCyclic(enabled?: boolean): this;
    /** Configure cache and return this builder. */ hasCache(size: number): this;
}
