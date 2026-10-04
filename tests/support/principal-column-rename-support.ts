import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import type { ModelSnapshot } from '../../packages/core/src/model/model-snapshot-types';

export type PrincipalKeyKind = 'primary' | 'alternate' | 'composite';

class CatalogEntry {
    public legacyId = '';
    public id = '';
    public legacyCode = '';
    public code = '';
    public tenant = '';
    public label = '';
    public links: CatalogLink[] = [];
}

class CatalogLink {
    public id = '';
    public ownerKey = '';
    public ownerTenant = '';
    public entry: CatalogEntry | null = null;
}

export function principalSnapshot(kind: PrincipalKeyKind, renamed: boolean): ModelSnapshot {
    const property = kind === 'alternate'
        ? renamed ? 'code' : 'legacyCode'
        : renamed ? 'id' : 'legacyId';
    const column = kind === 'alternate'
        ? renamed ? 'code' : 'legacy_code'
        : renamed ? 'id' : 'legacy_id';
    return new ModelBuilder()
        .entity(CatalogEntry, entity => {
            entity.toTable('catalog_entries');
            entity.property(property).hasColumnName(column).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.tenant).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            if (kind === 'alternate') {
                entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
                entity.hasKey(row => row.id);
                entity.hasAlternateKey(property).hasDatabaseName('ak_catalog_entry_code');
            } else {
                entity.hasKey(row => kind === 'composite' ? [row.tenant, row[property]] : row[property]);
            }
        })
        .entity(CatalogLink, entity => {
            entity.toTable('catalog_links');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.ownerKey).hasColumnName('owner_key').hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.ownerTenant).hasColumnName('owner_tenant').hasColumnType('varchar(64)').isRequired();
            const relationship = entity.hasOne(CatalogEntry, row => row.entry).withMany(row => row.links)
                .hasForeignKey(row => kind === 'composite' ? [row.ownerTenant, row.ownerKey] : row.ownerKey)
                .hasConstraintName('fk_catalog_link_entry');
            if (kind === 'alternate') relationship.hasPrincipalKey(property);
        }).build().toSnapshot();
}

export function principalRenameHint(kind: PrincipalKeyKind): { tableName: string; from: string; to: string } {
    return {
        tableName: 'catalog_entries',
        from: kind === 'alternate' ? 'legacy_code' : 'legacy_id',
        to: kind === 'alternate' ? 'code' : 'id',
    };
}
