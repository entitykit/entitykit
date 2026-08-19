import ts from 'typescript';

export function runtimeModuleSpecifier(statement: ts.Statement): string | undefined {
    if (ts.isImportDeclaration(statement)) {
        if (!ts.isStringLiteral(statement.moduleSpecifier) || isTypeOnlyImport(statement)) {
            return undefined;
        }
        return statement.moduleSpecifier.text;
    }

    if (ts.isExportDeclaration(statement)) {
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || isTypeOnlyExport(statement)) {
            return undefined;
        }
        return statement.moduleSpecifier.text;
    }

    return undefined;
}

function isTypeOnlyImport(statement: ts.ImportDeclaration): boolean {
    const clause = statement.importClause;
    if (!clause) {
        return false;
    }
    // `phaseModifier` is a TypeScript 5.9 field, but package.json permits 5.8,
    // where it is undefined and every `import type` reads as a runtime import.
    // This helper is stable across both and is not deprecated.
    if (ts.isTypeOnlyImportDeclaration(clause)) {
        return true;
    }
    return clause.name === undefined
    && clause.namedBindings !== undefined
    && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.every(specifier => specifier.isTypeOnly);
}

function isTypeOnlyExport(statement: ts.ExportDeclaration): boolean {
    return statement.isTypeOnly
    ||
      statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.every(specifier => specifier.isTypeOnly)
    ;
}
