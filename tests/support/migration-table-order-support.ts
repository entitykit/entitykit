import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as migrations from '../../packages/core/src/migrations/api';
import type { EntitySnapshot, ModelSnapshot } from '../../packages/core/src/model/model-snapshot-types';
import { usersSnapshot } from '../model-differ-support';
import { createManagedTempDirectory } from './managed-temp-directory';

export function emailClaimSnapshot(options: {
    readonly schemaName?: string;
    readonly cyclic?: boolean;
    readonly chain?: boolean;
    readonly selfReference?: boolean;
} = {}): ModelSnapshot {
    const user: EntitySnapshot = {
        ...usersSnapshot.entities[0], schemaName: options.schemaName, tableName: 'ek_order_users', indexes: [],
        properties: usersSnapshot.entities[0].properties.map(property => ({ ...property, columnType: property.isPrimaryKey ? 'integer' : 'varchar(255)' })),
    };
    const reference = (propertyName: string, principalEntityName: string, constraintName: string): EntitySnapshot['relationships'][number] => ({
        navigationProperty: principalEntityName.toLowerCase(), principalEntityName, foreignKeyProperty: propertyName,
        deleteBehavior: 'restrict', constraintName,
    });
    const key = user.properties[0];
    const claim: EntitySnapshot = {
        ...user, entityName: 'EmailClaim', tableName: 'ek_order_email_claims',
        properties: [key, { ...key, propertyName: 'userId', columnName: 'user_id', isPrimaryKey: false }],
        relationships: [reference('userId', 'User', 'fk_ek_order_claim_user')],
    };
    const parent: EntitySnapshot = options.cyclic || options.selfReference ? {
        ...user,
        properties: [...user.properties, { ...key, propertyName: 'referenceId', columnName: 'reference_id', isPrimaryKey: false, isRequired: false }],
        relationships: [reference('referenceId', options.cyclic ? 'EmailClaim' : 'User', 'fk_ek_order_user_reference')],
    } : user;
    const token: EntitySnapshot = {
        ...claim, entityName: 'EmailToken', tableName: 'ek_order_email_tokens',
        properties: [key, { ...key, propertyName: 'claimId', columnName: 'claim_id', isPrimaryKey: false }],
        relationships: [reference('claimId', 'EmailClaim', 'fk_ek_order_token_claim')],
    };
    return { formatVersion: 1, entities: options.chain ? [token, claim, parent] : [claim, parent] };
}

export function scaffoldedMigration(previous: ModelSnapshot, target: ModelSnapshot): { source: string; migration: migrations.Migration } {
    const directory = createManagedTempDirectory('entitykit-table-order-');
    const snapshotPath = path.join(directory, 'ModelSnapshot.ts');
    fs.writeFileSync(snapshotPath, migrations.renderSnapshotSource(previous), 'utf8');
    const source = migrations.scaffoldMigration({ createModelSnapshot: () => target }, {
        name: 'Order Email Claims', migrationsDir: directory, snapshotPath, now: new Date('2026-10-04T12:00:00Z'), allowEmpty: true,
    }).migrationSource;
    const generated: { exports: { default?: new () => migrations.Migration } } = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const execute = vm.runInThisContext(`(function(module, exports, require) { ${code}\n })`, { filename: path.join(directory, 'OrderEmailClaims.cjs') }) as
        (module: typeof generated, exports: typeof generated.exports, require: (name: string) => typeof migrations) => void;
    execute(generated, generated.exports, name => {
        if (name !== '@entitykit/core/migrations') throw new Error(`Unexpected generated import ${name}.`);
        return migrations;
    });
    if (!generated.exports.default) throw new Error('Generated migration has no default export.');
    return { source, migration: new generated.exports.default() };
}
