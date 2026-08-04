import type { PropertySelector } from './model-property-selector';
import { selectPropertyName } from './model-property-selector';
import type { DeleteBehavior } from './relationship-metadata';
import type { MutableManyToManyMetadata } from './many-to-many-metadata';
import type {
    ManyToManyJoinTableBuilder,
    ManyToManyRelationshipBuilder,
} from './relationship-builder-types';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import { ModelValidationError } from '../errors/model-validation-error';

export class ManyToManyRelationshipBuilderImplementation<
    TEntity extends object,
    TTarget extends object,
> implements ManyToManyRelationshipBuilder<TTarget> {
    constructor(private readonly metadata: MutableManyToManyMetadata<TEntity, TTarget>) {}

    public withMany<TInverse>(selector: PropertySelector<TTarget, TInverse>): this {
        this.metadata.inverseNavigationProperty = selectPropertyName(selector);
        return this;
    }

    public usingJoinTable(
        tableName: string,
        configure?: (join: ManyToManyJoinTableBuilder) => void,
    ): this {
        this.metadata.joinTableName = tableName;
        if (configure) {
            // The public void contract hides values that JavaScript still returns.
            // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
            const result: unknown = configure(
                new ManyToManyJoinTableBuilderImplementation(this.metadata),
            );
            assertSynchronousCallbackResult(
                result,
                'ManyToManyRelationshipBuilder.usingJoinTable() callback',
                message => new ModelValidationError(message, {
                    contractViolation: 'asyncJoinTableConfiguration',
                }),
            );
        }
        return this;
    }

    public onDelete(deleteBehavior: DeleteBehavior): this {
        this.metadata.deleteBehavior = deleteBehavior;
        return this;
    }
}

class ManyToManyJoinTableBuilderImplementation<
    TEntity extends object,
    TTarget extends object,
> implements ManyToManyJoinTableBuilder {
    constructor(private readonly metadata: MutableManyToManyMetadata<TEntity, TTarget>) {}

    public hasSchema(schemaName: string): this {
        this.metadata.joinSchemaName = schemaName;
        return this;
    }

    /** Preserve a database-specific name for the join table's primary key. */
    public primaryKeyName(name: string): this {
        if (!name.trim()) {
            throw new Error('primaryKeyName requires a non-empty name.');
        }
        this.metadata.primaryKeyName = name;
        return this;
    }

    /**
   * Join-table column(s) referencing the source entity's key.
   *
   * Pass an array when that key is composite, listing columns in its key order.
   */
    public sourceForeignKey(columnNames: string | readonly string[]): this {
        this.metadata.sourceForeignKeyColumns = toColumnList(columnNames, 'sourceForeignKey');
        return this;
    }

    /** Join-table column(s) referencing the target entity's key. */
    public targetForeignKey(columnNames: string | readonly string[]): this {
        this.metadata.targetForeignKeyColumns = toColumnList(columnNames, 'targetForeignKey');
        return this;
    }

    public sourceConstraintName(name: string): this {
        this.metadata.sourceConstraintName = name;
        return this;
    }

    public targetConstraintName(name: string): this {
        this.metadata.targetConstraintName = name;
        return this;
    }
}

function toColumnList(columnNames: string | readonly string[], operation: string): readonly string[] {
    const columns = typeof columnNames === 'string' ? [columnNames] : [...columnNames];
    if (columns.length === 0) {
        throw new Error(`${operation} requires at least one column.`);
    }

    const seen: Set<string> = new Set();
    for (const column of columns) {
        if (!column.trim()) {
            throw new Error(
                `${operation} requires every column name to be non-empty.`,
            );
        }
        if (seen.has(column)) {
            throw new Error(`${operation} lists column '${column}' more than once.`);
        }
        seen.add(column);
    }

    return columns;
}
