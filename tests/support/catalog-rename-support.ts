import type { ModelSnapshot } from '../../packages/core/src/model/model-snapshot-types';
import { ModelBuilder } from '../../packages/core/src/model/model-builder';

class CatalogItem {
    public legacyId = '';
    public id = '';
    public legacyCode = '';
    public code = '';
    public legacyTenantId = '';
    public tenantId = '';
    public legacyActor = '';
    public actor = '';
    public legacyDeletedAt: Date | null = null;
    public deletedAt: Date | null = null;
    public createdAt = new Date();
    public title = '';
    public offers: CatalogOffer[] = [];
}

class CatalogCategory {
    public legacyId = '';
}

class CatalogOffer {
    public id = '';
    public legacyBookCode = '';
    public bookCode = '';
    public categoryId = '';
    public book: CatalogItem | null = null;
    public category: CatalogCategory | null = null;
}

const oldNames = {
    id: 'legacyId', code: 'legacyCode', tenant: 'legacyTenantId', actor: 'legacyActor',
    deleted: 'legacyDeletedAt', foreign: 'legacyBookCode',
} as const;
const newNames = {
    id: 'id', code: 'code', tenant: 'tenantId', actor: 'actor', deleted: 'deletedAt', foreign: 'bookCode',
} as const;

export function catalogModel(renamed: boolean, advanced = true, renameOffer = renamed): ReturnType<ModelBuilder['build']> {
    const names = renamed ? newNames : oldNames;
    const foreignName = renameOffer ? newNames.foreign : oldNames.foreign;
    return new ModelBuilder()
        .entity(CatalogItem, entity => {
            entity.toTable('catalog_items');
            entity.hasKey(names.id);
            entity.hasAlternateKey(names.code).hasDatabaseName('ak_catalog_code');
            entity.property(names.id).hasColumnName(renamed ? 'id' : 'legacy_id').hasColumnType('text').isRequired();
            entity.property(names.code).hasColumnName(renamed ? 'code' : 'legacy_code').hasColumnType('varchar(64)').isRequired();
            entity.property(names.tenant).hasColumnName(renamed ? 'tenant_id' : 'legacy_tenant_id').hasColumnType('text').isRequired();
            entity.property(names.actor).hasColumnName(renamed ? 'actor' : 'legacy_actor').hasColumnType('text').isRequired();
            entity.property(names.deleted).hasColumnName(renamed ? 'deleted_at' : 'legacy_deleted_at').hasColumnType('timestamp').isOptional();
            entity.property(row => row.createdAt).hasColumnName('created_at').hasColumnType('timestamp').isRequired();
            entity.property(row => row.title).hasColumnType('text').isRequired();
            entity.tenantKey(names.tenant);
            entity.audit({ createdAt: 'createdAt', updatedBy: names.actor });
            entity.softDelete(row => row[names.deleted]);
            const index = entity.hasIndex(names.code);
            if (renamed) index.hasDatabaseName('ix_catalog_items_legacy_code');
            if (advanced) {
                entity.hasExpressionIndex('lower(title)').hasDatabaseName('ix_catalog_title')
                    .includeProperties(row => row[names.actor]);
                entity.hasIndex(row => row.title).hasDatabaseName('ix_catalog_title_actor')
                    .includeProperties(row => row[names.actor]);
            }
        })
        .entity(CatalogCategory, entity => {
            entity.toTable('catalog_categories');
            entity.hasKey(row => row.legacyId);
            entity.property(row => row.legacyId).hasColumnName('legacy_id').hasColumnType('varchar(64)').isRequired();
            entity.hasIndex(row => row.legacyId);
        })
        .entity(CatalogOffer, entity => {
            entity.toTable('catalog_offers');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(foreignName).hasColumnName(renameOffer ? 'book_code' : 'legacy_book_code').hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.categoryId).hasColumnName('category_id').hasColumnType('varchar(64)').isRequired();
            entity.hasOne(CatalogItem, row => row.book).withMany(row => row.offers)
                .hasForeignKey(foreignName).hasPrincipalKey(names.code)
                .hasConstraintName('fk_catalog_offers_book');
            entity.hasOne(CatalogCategory, row => row.category).withMany()
                .hasForeignKey(row => row.categoryId).hasPrincipalKey(row => row.legacyId)
                .hasConstraintName('fk_catalog_offers_category');
        }).build();
}

export const hints = {
    columns: [
        { tableName: 'catalog_items', from: 'legacy_id', to: 'id' },
        { tableName: 'catalog_items', from: 'legacy_code', to: 'code' },
        { tableName: 'catalog_items', from: 'legacy_tenant_id', to: 'tenant_id' },
        { tableName: 'catalog_items', from: 'legacy_actor', to: 'actor' },
        { tableName: 'catalog_items', from: 'legacy_deleted_at', to: 'deleted_at' },
        { tableName: 'catalog_offers', from: 'legacy_book_code', to: 'book_code' },
    ],
};

export function withMixedIndex(snapshot: ModelSnapshot, renamed: boolean): ModelSnapshot {
    return {
        ...snapshot,
        entities: snapshot.entities.map(entity => entity.entityName === 'CatalogItem' ? {
            ...entity,
            indexes: [...entity.indexes, {
                propertyNames: [renamed ? 'code' : 'legacyCode'],
                keyParts: [
                    { kind: 'property' as const, propertyName: renamed ? 'code' : 'legacyCode' },
                    { kind: 'expression' as const, expression: 'lower(title)' },
                ],
                databaseName: 'ix_catalog_mixed', isUnique: false,
            }],
        } : entity),
    };
}
