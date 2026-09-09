import fs from 'node:fs';
import path from 'node:path';

export type BuiltInProvider = 'mysql' | 'postgres' | 'sqlite';
export type ProjectModuleStyle = 'commonjs' | 'esm';

/** Render the provider-explicit EntityKit CLI configuration. */
export function renderInitConfig(
    provider: BuiltInProvider,
    moduleStyle: ProjectModuleStyle,
): string {
    const symbol = provider === 'mysql'
        ? 'mySqlProviderServices'
        : `${provider}ProviderServices`;
    const connection = provider === 'sqlite'
        ? moduleStyle === 'esm'
            ? 'fileURLToPath(new URL("./entitykit.db", import.meta.url))'
            : 'path.join(__dirname, "entitykit.db")'
        : '() => process.env.DATABASE_URL';
    return [
        ...sqlitePathImport(provider, moduleStyle),
        'import { defineEntityKitConfig } from "@entitykit/core";',
        `import { ${symbol} } from "@entitykit/${provider}";`,
        `import { MigrationDbContext } from "./src/db/app-db-context${moduleStyle === 'esm' ? '.js' : ''}";`,
        '',
        'export default defineEntityKitConfig({',
        '  context: MigrationDbContext,',
        `  provider: ${symbol},`,
        `  connection: ${connection},`,
        '  migrationsDir: "src/db/migrations",',
        '});',
        '',
    ].join('\n');
}

/** Render a source-backed application context and its connection-owning CLI subclass. */
export function renderInitContext(
    provider: BuiltInProvider,
    moduleStyle: ProjectModuleStyle,
): string {
    const configure = provider === 'sqlite'
        ? moduleStyle === 'esm'
            ? 'options.useSqlite(fileURLToPath(new URL("../../entitykit.db", import.meta.url)));'
            : 'options.useSqlite(path.join(__dirname, "..", "..", "entitykit.db"));'
        : provider === 'postgres'
            ? 'options.usePostgres(requiredDatabaseUrl());'
            : 'options.useMySql(requiredDatabaseUrl());';
    return [
        ...sqlitePathImport(provider, moduleStyle),
        'import { DbContext, type DbContextOptionsBuilder } from "@entitykit/core";',
        '',
        'export class AppDbContext extends DbContext {',
        '  // Declare sets and map entities here. Use dataSource.createContext(AppDbContext) at runtime.',
        '}',
        '',
        '// The CLI constructs this context without application arguments.',
        'export class MigrationDbContext extends AppDbContext {',
        '  protected override configure(options: DbContextOptionsBuilder): void {',
        `    ${configure}`,
        '  }',
        '}',
        ...provider === 'sqlite' ? [] : [
            '',
            'function requiredDatabaseUrl(): string {',
            '  const value = process.env.DATABASE_URL;',
            '  if (!value) throw new Error("DATABASE_URL is required.");',
            '  return value;',
            '}',
        ],
        '',
    ].join('\n');
}

/** Detect the JavaScript module interpretation Node will use for generated files. */
export function projectModuleStyle(root: string): ProjectModuleStyle {
    const packagePath = path.join(root, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return 'commonjs';
    }
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { readonly type?: unknown };
    return manifest.type === 'module' ? 'esm' : 'commonjs';
}

function sqlitePathImport(provider: BuiltInProvider, moduleStyle: ProjectModuleStyle): string[] {
    if (provider !== 'sqlite') {
        return [];
    }
    return moduleStyle === 'esm'
        ? ['import { fileURLToPath } from "node:url";']
        : ['import * as path from "node:path";'];
}
