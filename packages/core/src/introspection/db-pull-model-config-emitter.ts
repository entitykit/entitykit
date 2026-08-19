/**
 * Emits the generated DbContext file: imports, DbSet fields, provider wiring and
 * the `model()` body (entity table/key/property/index configuration, foreign-key
 * relationships and many-to-many join-table setup). Separated from entity-class
 * emission because this is the single place that renders the model-configuration
 * DSL, and from orchestration because assembling the file is independent of
 * collecting review warnings.
 */
import type { DatabaseSequence } from './database-schema';
import type { DbPullCodegenOptions, EntityShape, ManyToManyJoinShape } from './db-pull-codegen-types';
import { renderEntityConfiguration } from './db-pull-entity-config-emitter';
import { toKebabFileStem } from './db-pull-naming';
import { renderProviderConfiguration } from './db-pull-provider-config-emitter';

export function renderContextFile(
    contextName: string,
    entities: readonly EntityShape[],
    entityByTable: ReadonlyMap<string, EntityShape>,
    manyToManyJoins: readonly ManyToManyJoinShape[],
    sequences: readonly DatabaseSequence[],
    options: DbPullCodegenOptions,
): string {
    const imports = entities.map(entity =>
        `import { ${entity.className} } from "./${toKebabFileStem(entity.className)}";`,
    );
    const connectionStringExpression = options.connectionStringExpression ?? 'process.env.DATABASE_URL!';
    const setLines = entities.map(renderSetDeclaration);
    const modelLines = [
        ...sequences.map(renderSequenceConfiguration),
        ...entities.flatMap(entity =>
            renderEntityConfiguration(entity, entityByTable, manyToManyJoins)),
    ];
    const provider = renderProviderConfiguration(options.providerName, connectionStringExpression);

    return [
        'import { DbContext, DeleteBehavior, type DbContextOptionsBuilder, type ModelBuilder } from "entitykit";',
        ...provider.importLine ? [provider.importLine] : [],
        ...imports,
        '',
        `export class ${contextName} extends DbContext {`,
        ...setLines,
        '',
        '  protected override configure(options: DbContextOptionsBuilder): void {',
        `    ${provider.configureLine}`,
        '  }',
        '',
        '  protected override model(model: ModelBuilder): void {',
        ...modelLines,
        '  }',
        '}',
        '',
    ].join('\n');
}

function renderSetDeclaration(entity: EntityShape): string {
    const keyColumns = entity.table.primaryKey?.columns;
    if (!keyColumns || keyColumns.length === 0) {
        return `  ${entity.setName} = this.set(${entity.className});`;
    }
    const keyProperties = keyColumns.map(column =>
        entity.propertiesByColumn.get(column),
    );
    if (keyProperties.some(property => property === undefined)) {
        return `  ${entity.setName} = this.set(${entity.className});`;
    }
    const keyTypes = keyProperties
        .map(property => `${entity.className}[${JSON.stringify(property)}]`)
        .join(', ');
    return `  ${entity.setName} = this.set<${entity.className}, [${keyTypes}]>(${entity.className});`;
}

function renderSequenceConfiguration(sequence: DatabaseSequence): string {
    const chain = [
        sequence.schemaName ? `.hasSchema(${JSON.stringify(sequence.schemaName)})` : '',
        sequence.dataType ? `.hasDataType(${JSON.stringify(sequence.dataType)})` : '',
        sequence.startValue ? `.startsAt(${integerLiteral(sequence.startValue)})` : '',
        sequence.incrementBy ? `.incrementsBy(${integerLiteral(sequence.incrementBy)})` : '',
        sequence.minValue ? `.hasMin(${integerLiteral(sequence.minValue)})` : '',
        sequence.maxValue ? `.hasMax(${integerLiteral(sequence.maxValue)})` : '',
        sequence.isCyclic ? '.isCyclic()' : '',
        sequence.cache !== undefined ? `.hasCache(${String(sequence.cache)})` : '',
    ].join('');
    return chain
        ? `    model.hasSequence(${JSON.stringify(sequence.name)}, sequence => sequence${chain});`
        : `    model.hasSequence(${JSON.stringify(sequence.name)});`;
}

function integerLiteral(value: string): string {
    if (!/^-?\d+$/.test(value)) {
        throw new Error(
            `Sequence integer value '${value}' is not a valid integer.`,
        );
    }
    return `${value}n`;
}
