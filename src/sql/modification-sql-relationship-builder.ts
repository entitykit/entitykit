import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import {
    buildAuthorizedManyToManyDelete,
    buildAuthorizedManyToManyInsert,
} from './many-to-many-authorized-dml';
import type { AuthorizedManyToManyPair } from './many-to-many-authorization';
import { buildManyToManyAuthorizationQuery } from './many-to-many-authorization-query';
import type { ManyToManyEndpointKey } from './modification-sql-helpers';
import { ModificationSqlCapturedBuilder } from './modification-sql-captured-builder';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';
import type { AuthorizedRelationshipEndpoint } from './many-to-many-authorization';
import { buildRelationshipAuthorizationQuery } from './relationship-authorization-query';

/** Owns join-table DML and its endpoint-authorization statements. */
export abstract class ModificationSqlRelationshipBuilder
    extends ModificationSqlCapturedBuilder {
    protected constructor(private readonly relationshipDialect: SqlDialect = postgresDialect) {
        super(relationshipDialect);
    }

    public buildInsertManyToMany<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        sourceKeyValues: ManyToManyEndpointKey,
        targetKeyValues: ManyToManyEndpointKey,
    ): SqlStatement {
        return this.insertBuilder.buildInsertManyToMany(
            relationship, sourceKeyValues, targetKeyValues,
        );
    }

    public buildInsertManyToManyBatch<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        pairs: ReadonlyArray<readonly [unknown, unknown]>,
    ): SqlStatement {
        return this.insertBuilder.buildInsertManyToManyBatch(relationship, pairs);
    }

    public buildDeleteManyToMany<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        sourceKeyValues: ManyToManyEndpointKey,
        targetKeyValues: ManyToManyEndpointKey,
    ): SqlStatement {
        return this.deleteBuilder.buildDeleteManyToMany(
            relationship, sourceKeyValues, targetKeyValues,
        );
    }

    public buildDeleteManyToManyBatch<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        pairs: ReadonlyArray<readonly [unknown, unknown]>,
    ): SqlStatement {
        return this.deleteBuilder.buildDeleteManyToManyBatch(relationship, pairs);
    }

    public buildManyToManyAuthorization(
        pairs: readonly AuthorizedManyToManyPair[],
    ): SqlStatement {
        return buildManyToManyAuthorizationQuery(this.relationshipDialect, pairs);
    }

    public buildRelationshipAuthorization(
        endpoint: AuthorizedRelationshipEndpoint,
    ): SqlStatement {
        return buildRelationshipAuthorizationQuery(
            this.relationshipDialect,
            endpoint,
        );
    }

    public buildAuthorizedManyToMany(
        action: 'link' | 'unlink',
        relationship: ManyToManyMetadata,
        pairs: readonly AuthorizedManyToManyPair[],
    ): SqlStatement {
        return action === 'link'
            ? buildAuthorizedManyToManyInsert(
                this.relationshipDialect, relationship, pairs,
            )
            : buildAuthorizedManyToManyDelete(
                this.relationshipDialect, relationship, pairs,
            );
    }
}
