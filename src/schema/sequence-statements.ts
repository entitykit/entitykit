import type { Model } from '../model/model';
import type { SqlDialect, SqlSequenceDefinition } from '../sql/sql-dialect';

export function buildCreateSequenceStatements(
    model: Model,
    dialect: SqlDialect,
): string[] {
    return model.sequences.map(sequence => {
        const definition: SqlSequenceDefinition = {
            ...sequence,
            startValue: serialize(sequence.startValue),
            incrementBy: serialize(sequence.incrementBy),
            minValue: serialize(sequence.minValue),
            maxValue: serialize(sequence.maxValue),
        };
        const statement = dialect.createSequenceStatement?.(definition);
        if (!statement) {
            throw new Error(
                `Database sequences are not supported by the '${dialect.name}' provider.`,
            );
        }
        return `${statement};`;
    });
}

function serialize(value: number | bigint | undefined): string | undefined {
    return value === undefined ? undefined : String(value);
}
