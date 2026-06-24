import type { Model } from '../model/model';
import { postgresDialect, type SqlDialect } from '../sql/sql-dialect';
import { buildCreateSchemaStatements } from './schema-statements';
import { buildCreateTable } from './table-statement';
import { buildManyToManyJoinTables } from './join-table-statements';
import { buildIndexes } from './index-statements';
import { orderTablesForCreation } from './table-order';
import { buildCreateSequenceStatements } from './sequence-statements';

export class SchemaSqlBuilder {
    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    public build(model: Model): string {
        return this.buildStatements(model).join('\n\n');
    }

    public buildStatements(model: Model): string[] {
        const schemaStatements = buildCreateSchemaStatements(model, this.dialect);
        const sequenceStatements = buildCreateSequenceStatements(model, this.dialect);
        const tableStatements = orderTablesForCreation(model)
            .filter(entity => !entity.isView)
            .map(
                entity => buildCreateTable(entity, model, this.dialect),
            );
        const joinTableStatements = buildManyToManyJoinTables(model, this.dialect);
        const indexStatements = model.entities.filter(entity => !entity.isView).flatMap(
            entity => buildIndexes(entity, this.dialect),
        );

        return [
            ...schemaStatements,
            ...sequenceStatements,
            ...tableStatements,
            ...joinTableStatements,
            ...indexStatements,
        ];
    }
}
