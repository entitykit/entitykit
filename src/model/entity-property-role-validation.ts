import type { AlternateKeyMetadata } from './alternate-key-metadata';
import type { PropertyMetadata } from './property-metadata';
import type { AuditMetadata, SoftDeleteMetadata } from './saas-metadata';
import type { EntityPropertyKey } from '../types';

interface EntityPropertyRoles<TEntity extends object> {
    readonly entityName: string;
    readonly properties: ReadonlyArray<PropertyMetadata<TEntity>>;
    readonly alternateKeys: ReadonlyArray<AlternateKeyMetadata<TEntity>>;
    readonly audit?: AuditMetadata<TEntity>;
    readonly softDelete?: SoftDeleteMetadata<TEntity>;
    readonly tenantKeyProperty?: EntityPropertyKey<TEntity>;
}

/** Reject persistence policies whose independent writes conflict at runtime. */
export function validateEntityPropertyRoles<TEntity extends object>(
    roles: EntityPropertyRoles<TEntity>,
): void {
    const alternateKeys: Set<string> = new Set(
        roles.alternateKeys.flatMap(key => key.propertyNames),
    );
    const auditRoles = auditRolesByProperty(roles.audit);
    for (const property of roles.properties) {
        const name = property.propertyName;
        const audits = auditRoles.get(name) ?? [];
        const tenant = name === roles.tenantKeyProperty;
        const softDelete = name === roles.softDelete?.propertyName;
        if (tenant && property.isVersion) {
            incompatible(roles.entityName, name, 'tenant', 'version');
        }
        if (tenant && softDelete) {
            incompatible(roles.entityName, name, 'tenant', 'soft-delete');
        }
        if (tenant && audits.length > 0) {
            incompatible(roles.entityName, name, 'tenant', audits[0]);
        }
        if (property.isVersion && property.isPrimaryKey) {
            incompatible(roles.entityName, name, 'version', 'primary-key');
        }
        if (property.isVersion && alternateKeys.has(name)) {
            incompatible(roles.entityName, name, 'version', 'alternate-key');
        }
        if (property.isVersion && softDelete) {
            incompatible(roles.entityName, name, 'version', 'soft-delete');
        }
        if (property.isVersion && audits.length > 0) {
            incompatible(roles.entityName, name, 'version', audits[0]);
        }
        if (softDelete && property.isPrimaryKey) {
            incompatible(roles.entityName, name, 'soft-delete', 'primary-key');
        }
        if (softDelete && alternateKeys.has(name)) {
            incompatible(roles.entityName, name, 'soft-delete', 'alternate-key');
        }
        if (softDelete && audits.length > 0) {
            incompatible(roles.entityName, name, 'soft-delete', audits[0]);
        }
        if (audits.length > 0 && property.isPrimaryKey) {
            incompatible(roles.entityName, name, audits[0], 'primary-key');
        }
        if (audits.length > 0 && alternateKeys.has(name)) {
            incompatible(roles.entityName, name, audits[0], 'alternate-key');
        }
    }
}

function auditRolesByProperty<TEntity extends object>(
    audit?: AuditMetadata<TEntity>,
): Map<string, string[]> {
    const roles: Map<string, string[]> = new Map();
    for (const [role, property] of [
        ['createdAt audit', audit?.createdAtProperty],
        ['updatedAt audit', audit?.updatedAtProperty],
        ['createdBy audit', audit?.createdByProperty],
        ['updatedBy audit', audit?.updatedByProperty],
    ] as const) {
        if (property === undefined) continue;
        const propertyRoles = roles.get(property) ?? [];
        propertyRoles.push(role);
        roles.set(property, propertyRoles);
    }
    return roles;
}

function incompatible(
    entityName: string,
    propertyName: string,
    firstRole: string,
    secondRole: string,
): never {
    throw new Error(
        `Property '${entityName}.${propertyName}' cannot combine ${firstRole} and ${secondRole} roles. Configure separate properties for these persistence concerns.`,
    );
}
