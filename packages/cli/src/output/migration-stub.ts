import { toPascalIdentifier } from '@entitykit/core/migrations';

/** Render a self-contained migration class template for stdout. */
export function renderMigrationStub(name: string): string {
    const className = toPascalIdentifier(name);
    const timestamp = 'YYYYMMDDHHMMSS';
    return [
        'import { Migration, MigrationBuilder } from "entitykit/migrations";',
        '',
        `export class ${className} extends Migration {`,
        `  readonly id = "${timestamp}_${className}";`,
        `  readonly name = "${className}";`,
        '',
        '  up(builder: MigrationBuilder): void {',
        '    // builder.createTable(...);',
        '  }',
        '',
        '  down(builder: MigrationBuilder): void {',
        '    // builder.dropTable(...);',
        '  }',
        '}',
    ].join('\n');
}
