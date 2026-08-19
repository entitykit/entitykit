import { SqlParameterBag, type SqlStatement } from './sql-statement';
import type { SqlDialect } from './sql-dialect';

/** Perform the build raw sql operation. */ export function buildRawSql(dialect: SqlDialect, strings: TemplateStringsArray, ...values: readonly unknown[]): SqlStatement {
    if (strings.length !== values.length + 1) {
        throw new Error('Raw SQL template interpolation is malformed.');
    }

    const parameters = new SqlParameterBag(dialect);
    const text = strings.reduce((sql, chunk, index) => {
        if (index === values.length) {
            return sql + chunk;
        }

        return sql + chunk + parameters.add(values[index]);
    }, '');

    return {
        text: text.trim(),
        values: parameters.values,
    };
}
