import ts from 'typescript';
import {
    resolveRelativeModule,
    sourceFile,
    sourceFiles,
} from './architecture-test-support';

/**
 * Machinery for the package-access rule.
 *
 * Every module belongs to exactly one workspace package, and a package may only
 * be reached from outside through a public entry named by its package
 * specifier. Two properties keep that true: no relative reference may leave its
 * own package, and every `@entitykit/*` reference must bind names the entry it
 * names actually re-exports. Reachability is decided by name, not by file,
 * because the specifier is all a published consumer ever gets.
 */

/** Core's public entries, keyed by the specifier a consumer writes. */
export const corePublicEntries: Readonly<Record<string, string>> = {
    '@entitykit/core': 'packages/core/src/index.ts',
    '@entitykit/core/migrations': 'packages/core/src/migrations/api.ts',
    '@entitykit/core/adapter': 'packages/core/src/adapter/index.ts',
    '@entitykit/core/tooling': 'packages/core/src/tooling/index.ts',
    '@entitykit/core/experimental': 'packages/core/src/experimental/index.ts',
};

/** A package the cutover carved out of the original single package. */
export type WorkspacePackage =
    | 'core' | 'cli' | 'mysql' | 'nestjs' | 'postgres' | 'sqlite' | 'testing';

const packageRoots: ReadonlyArray<readonly [string, WorkspacePackage]> = [
    ['packages/mysql/', 'mysql'],
    ['packages/nestjs/', 'nestjs'],
    ['packages/postgres/', 'postgres'],
    ['packages/sqlite/', 'sqlite'],
    ['packages/cli/', 'cli'],
    ['packages/testing/', 'testing'],
    ['packages/core/', 'core'],
];

/** Packages that consume core rather than being it. */
export const corePackageConsumers: readonly WorkspacePackage[] =
    packageRoots.filter(([, name]) => name !== 'core').map(([, name]) => name);

/** Assign a repository-relative source file to its workspace package. */
export function workspacePackageOf(file: string): WorkspacePackage | undefined {
    return packageRoots.find(([root]) => file.startsWith(root))?.[1];
}

/** Every source file that belongs to a package other than core. */
export function consumerSourceFiles(): string[] {
    return corePackageConsumers.flatMap(name => sourceFiles(`packages/${name}/src`));
}

/** Every core source file. */
export function coreSourceFiles(): string[] {
    return sourceFiles('packages/core/src');
}

/** One module reference that leaves the file's own package. */
export interface CrossPackageReference {
    readonly from: string;
    readonly fromPackage: WorkspacePackage;
    readonly specifier: string;
    /** The package the specifier names, when it names a workspace package. */
    readonly toPackage: WorkspacePackage | undefined;
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
    /** True when the reference is relative and escapes its own package. */
    readonly relativeEscape: boolean;
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

/** The workspace package a `@entitykit/...` specifier names, if any. */
export function packageOfSpecifier(specifier: string): WorkspacePackage | undefined {
    const match = /^@entitykit\/([a-z]+)(?:\/|$)/u.exec(specifier);
    const name = match?.[1];
    return packageRoots.some(([, value]) => value === name)
        ? name as WorkspacePackage
        : undefined;
}

/** Every reference in `file` that leaves the package `file` belongs to. */
export function crossPackageReferences(file: string): CrossPackageReference[] {
    const fromPackage = workspacePackageOf(file);
    if (fromPackage === undefined) {
        return [];
    }
    const packageRoot = `packages/${fromPackage}/`;

    return moduleReferences(file).flatMap((reference): CrossPackageReference[] => {
        const base = {
            from: file,
            fromPackage,
            specifier: reference.specifier,
            line: reference.line,
            names: reference.names,
            opaque: reference.opaque,
        };
        if (reference.specifier.startsWith('.')) {
            const target = resolveRelativeModule(file, reference.specifier);
            const escapes = !target?.startsWith(packageRoot);
            return escapes
                ? [{
                    ...base,
                    toPackage: target === undefined ? undefined : workspacePackageOf(target),
                    relativeEscape: true,
                }]
                : [];
        }
        const toPackage = packageOfSpecifier(reference.specifier);
        return toPackage === undefined || toPackage === fromPackage
            ? []
            : [{ ...base, toPackage, relativeEscape: false }];
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

/** Export-name closure of every public core entry, keyed by specifier. */
export function corePublicEntryNames(): ReadonlyMap<string, ReadonlySet<string>> {
    return new Map(Object.entries(corePublicEntries)
        .map(([specifier, file]) => [specifier, exportedNames(file)]));
}

/** Specifiers whose closure contains every requested name. */
export function servingEntries(
    names: readonly string[],
    entries: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
    return [...entries]
        .filter(([, exported]) => names.every(name => exported.has(name)))
        .map(([specifier]) => specifier);
}
