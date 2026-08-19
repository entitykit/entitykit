import ts from 'typescript';
import {
    resolveRelativeModule,
    sourceFile,
    sourceFiles,
} from './architecture-test-support';

/**
 * Machinery for the package-access rule.
 *
 * Every module is assigned the package it belongs to after the monorepo
 * cutover, and every module reference that crosses one of those boundaries is
 * resolved down to the names it actually binds. Reachability is decided by
 * name, not by file: a cross-package import survives the split when some public
 * entry of core re-exports every name the import binds, because that is exactly
 * the specifier the rewrite will point it at.
 */

/** Core's public entries, keyed by the subpath a consumer writes. */
export const corePublicEntries: Readonly<Record<string, string>> = {
    '.': 'src/index.ts',
    './migrations': 'src/migrations/api.ts',
    './adapter': 'src/adapter/index.ts',
    './tooling': 'src/tooling/index.ts',
    './experimental': 'src/experimental/index.ts',
};

/** A package the cutover carves out of the current single package. */
export type FuturePackage =
    | 'core' | 'cli' | 'mysql' | 'postgres' | 'sqlite' | 'testing';

const packageRoots: ReadonlyArray<readonly [string, FuturePackage]> = [
    ['src/providers/mysql/', 'mysql'],
    ['src/providers/postgres/', 'postgres'],
    ['src/providers/sqlite/', 'sqlite'],
    ['src/cli/', 'cli'],
    ['src/testing/', 'testing'],
];

/** Packages that consume core rather than being it. */
export const corePackageConsumers: readonly FuturePackage[] =
    packageRoots.map(([, name]) => name);

/** Assign a repository-relative source file to its future package. */
export function futurePackageOf(file: string): FuturePackage {
    return packageRoots.find(([root]) => file.startsWith(root))?.[1] ?? 'core';
}

/** Every source file that belongs to a package other than core. */
export function consumerSourceFiles(): string[] {
    return [
        ...sourceFiles('src/providers'),
        ...sourceFiles('src/cli'),
        ...sourceFiles('src/testing'),
    ];
}

/** Every core source file. */
export function coreSourceFiles(): string[] {
    return sourceFiles('src').filter(file => futurePackageOf(file) === 'core');
}

/** One module reference that leaves its own package. */
export interface CrossPackageReference {
    readonly from: string;
    readonly fromPackage: FuturePackage;
    readonly to: string;
    readonly toPackage: FuturePackage;
    readonly line: number;
    /** Names the reference binds, with `import type` markers stripped. */
    readonly names: readonly string[];
    /**
     * True when the reference pulls in a module without naming its members —
     * a namespace or default import, a bare side-effect import, or a runtime
     * `require`. Nothing tells us which names it uses, so no public entry can
     * be proven to serve it.
     */
    readonly opaque: boolean;
}

interface ModuleReference {
    readonly specifier: string;
    readonly line: number;
    readonly names: readonly string[];
    readonly opaque: boolean;
}

function namedImportReference(
    statement: ts.ImportDeclaration,
    line: number,
    specifier: string,
): ModuleReference {
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (clause === undefined || clause.name !== undefined) {
        return { specifier, line, names: [], opaque: true };
    }
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
        return { specifier, line, names: [], opaque: true };
    }
    return {
        specifier,
        line,
        names: bindings.elements.map(element =>
            (element.propertyName ?? element.name).text),
        opaque: false,
    };
}

function exportReference(
    statement: ts.ExportDeclaration,
    line: number,
    specifier: string,
): ModuleReference {
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) {
        return { specifier, line, names: [], opaque: true };
    }
    return {
        specifier,
        line,
        names: clause.elements.map(element =>
            (element.propertyName ?? element.name).text),
        opaque: false,
    };
}

/** Names bound to `createRequire(...)`, which load modules at runtime. */
function runtimeLoaderNames(parsed: ts.SourceFile): ReadonlySet<string> {
    const names: Set<string> = new Set(['require']);
    for (const statement of parsed.statements) {
        if (!ts.isVariableStatement(statement)) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            const initializer = declaration.initializer;
            if (
                ts.isIdentifier(declaration.name)
                && initializer !== undefined
                && ts.isCallExpression(initializer)
                && ts.isIdentifier(initializer.expression)
                && initializer.expression.text === 'createRequire'
            ) {
                names.add(declaration.name.text);
            }
        }
    }
    return names;
}

function moduleReferences(file: string): ModuleReference[] {
    const parsed = sourceFile(file);
    const loaders = runtimeLoaderNames(parsed);
    const references: ModuleReference[] = [];
    const lineOf = (node: ts.Node): number =>
        parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            references.push(namedImportReference(node, lineOf(node), node.moduleSpecifier.text));
        } else if (
            ts.isExportDeclaration(node)
            && node.moduleSpecifier !== undefined
            && ts.isStringLiteral(node.moduleSpecifier)
        ) {
            references.push(exportReference(node, lineOf(node), node.moduleSpecifier.text));
        } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
            const [argument] = node.arguments;
            const callee = node.expression;
            const loads = callee.kind === ts.SyntaxKind.ImportKeyword
                || ts.isIdentifier(callee) && loaders.has(callee.text);
            if (loads && ts.isStringLiteral(argument)) {
                references.push({
                    specifier: argument.text,
                    line: lineOf(node),
                    names: [],
                    opaque: true,
                });
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(parsed);
    return references;
}

/** Every reference in `file` that resolves into a different future package. */
export function crossPackageReferences(file: string): CrossPackageReference[] {
    const fromPackage = futurePackageOf(file);
    return moduleReferences(file).flatMap(reference => {
        const target = resolveRelativeModule(file, reference.specifier);
        if (target === undefined) {
            return [];
        }
        const toPackage = futurePackageOf(target);
        return toPackage === fromPackage
            ? []
            : [{
                from: file,
                fromPackage,
                to: target,
                toPackage,
                line: reference.line,
                names: reference.names,
                opaque: reference.opaque,
            }];
    });
}

/** Names an entry exports, following `export *` and named re-exports. */
function exportedNames(entryFile: string): ReadonlySet<string> {
    const names: Set<string> = new Set();
    const visited: Set<string> = new Set();
    const pending = [entryFile];

    while (pending.length > 0) {
        const file = pending.pop();
        if (file === undefined || visited.has(file)) {
            continue;
        }
        visited.add(file);

        for (const statement of sourceFile(file).statements) {
            if (ts.isExportDeclaration(statement)) {
                const clause = statement.exportClause;
                if (clause !== undefined && ts.isNamedExports(clause)) {
                    for (const element of clause.elements) {
                        names.add(element.name.text);
                    }
                } else if (
                    statement.moduleSpecifier !== undefined
                    && ts.isStringLiteral(statement.moduleSpecifier)
                ) {
                    const target = resolveRelativeModule(file, statement.moduleSpecifier.text);
                    if (target !== undefined) {
                        pending.push(target);
                    }
                }
                continue;
            }

            const modifiers = ts.canHaveModifiers(statement)
                ? ts.getModifiers(statement) ?? []
                : [];
            if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
                continue;
            }
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name)) {
                        names.add(declaration.name.text);
                    }
                }
            } else if ('name' in statement && statement.name !== undefined
                && ts.isIdentifier(statement.name as ts.Node)) {
                names.add((statement.name as ts.Identifier).text);
            }
        }
    }

    return names;
}

/** Export-name closure of every public core entry, keyed by subpath. */
export function corePublicEntryNames(): ReadonlyMap<string, ReadonlySet<string>> {
    return new Map(Object.entries(corePublicEntries)
        .map(([subpath, file]) => [subpath, exportedNames(file)]));
}

/** Subpaths whose closure contains every requested name. */
export function servingEntries(
    names: readonly string[],
    entries: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
    return [...entries]
        .filter(([, exported]) => names.every(name => exported.has(name)))
        .map(([subpath]) => subpath);
}
