import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const repositoryRoot = path.resolve(__dirname, '../..');

function toRepoPath(value: string): string {
    return value.split(path.sep).join('/');
}

export function sourceFiles(relativeDirectory: string): string[] {
    const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
    if (!fs.existsSync(absoluteDirectory)) {
        return [];
    }

    return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
        .flatMap(entry => {
            const relativePath = path.join(relativeDirectory, entry.name);
            if (entry.isDirectory()) {
                return sourceFiles(relativePath);
            }
            return entry.isFile() && entry.name.endsWith('.ts')
                ? [toRepoPath(relativePath)]
                : [];
        })
        .sort();
}

/** The workspace packages the cutover produced, in dependency order. */
export const workspacePackages = [
    'core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing',
] as const;

/** Repository-relative source root of one workspace package. */
export function packageSourceRoot(name: string): string {
    return `packages/${name}/src`;
}

/** Every authored source file, across all six workspace packages. */
export function packageSourceFiles(): string[] {
    return workspacePackages.flatMap(name => sourceFiles(packageSourceRoot(name)));
}

export function readSource(file: string): string {
    return fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
}

export function sourceFile(file: string): ts.SourceFile {
    return ts.createSourceFile(
        file,
        readSource(file),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
}

export function resolveRelativeModule(importer: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) {
        return undefined;
    }

    const unresolved = toRepoPath(path.normalize(path.join(path.dirname(importer), specifier)))
        .replace(/\.js$/u, '');
    const candidates = [
        unresolved,
        `${unresolved}.ts`,
        `${unresolved}/index.ts`,
    ];

    return candidates.find(candidate =>
        fs.existsSync(path.join(repositoryRoot, candidate)),
    );
}

function isTypeOnlyImport(statement: ts.ImportDeclaration): boolean {
    const clause = statement.importClause;
    // `phaseModifier` is a TypeScript 5.9 field, but package.json permits 5.8,
    // where it is undefined and every `import type` reads as a runtime import.
    // This helper is stable across both and is not deprecated.
    if (clause === undefined || clause.name !== undefined) {
        return clause !== undefined && ts.isTypeOnlyImportDeclaration(clause);
    }
    if (ts.isTypeOnlyImportDeclaration(clause)) {
        return true;
    }
    const bindings = clause.namedBindings;
    return bindings !== undefined
    && ts.isNamedImports(bindings)
    && bindings.elements.length > 0
    && bindings.elements.every(element => element.isTypeOnly);
}

export function staticImportsOf(
    file: string,
    options: { runtimeOnly?: boolean } = {},
): string[] {
    const imports: string[] = [];

    for (const statement of sourceFile(file).statements) {
        if (
            ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && (!options.runtimeOnly || !isTypeOnlyImport(statement))
        ) {
            const resolved = resolveRelativeModule(file, statement.moduleSpecifier.text);
            if (resolved !== undefined) {
                imports.push(resolved);
            }
        }

        if (
            ts.isExportDeclaration(statement)
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
      && (!options.runtimeOnly || !statement.isTypeOnly)
        ) {
            const resolved = resolveRelativeModule(file, statement.moduleSpecifier.text);
            if (resolved !== undefined) {
                imports.push(resolved);
            }
        }
    }

    return [...new Set(imports)].sort();
}

export function importsFrom(file: string, directory: string): string[] {
    return staticImportsOf(file)
        .filter(target => target.startsWith(`${directory}/`));
}

export function pureFacadeViolations(file: string): string[] {
    const parsed = sourceFile(file);
    const statements = parsed.statements;
    if (statements.length === 0) {
        return [`${file} has no exports`];
    }

    return statements
        .filter(statement => !ts.isExportDeclaration(statement))
        .map(statement => {
            const location = parsed.getLineAndCharacterOfPosition(statement.getStart());
            return `${file}:${String(location.line + 1)} contains ${ts.SyntaxKind[statement.kind]}`;
        });
}

export function identifierNames(file: string): ReadonlySet<string> {
    const names: Set<string> = new Set();

    function visit(node: ts.Node): void {
        if (ts.isIdentifier(node)) {
            names.add(node.text);
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile(file));
    return names;
}

export function topLevelDeclarationNames(file: string): ReadonlySet<string> {
    const names: Set<string> = new Set();

    for (const statement of sourceFile(file).statements) {
        if (
            (
                ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement)
        || ts.isFunctionDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
            )
      && statement.name !== undefined
        ) {
            names.add(statement.name.text);
        }

        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    names.add(declaration.name.text);
                }
            }
        }
    }

    return names;
}

function containsNode(
    file: string,
    predicate: (node: ts.Node) => boolean,
): boolean {
    let matched = false;

    function visit(node: ts.Node): void {
        if (matched || predicate(node)) {
            matched = true;
            return;
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile(file));
    return matched;
}

export function hasInstanceOfExpression(
    file: string,
    constructorName: string,
): boolean {
    return containsNode(file, node =>
        ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
    && ts.isIdentifier(node.right)
    && node.right.text === constructorName,
    );
}

export function hasStaticMethodCall(
    file: string,
    ownerName: string,
    methodName: string,
): boolean {
    return containsNode(file, node =>
        ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === ownerName
    && node.expression.name.text === methodName,
    );
}

export function hasNamedReExport(
    file: string,
    originalName: string,
    exportedName = originalName,
): boolean {
    return sourceFile(file).statements.some(statement =>
        ts.isExportDeclaration(statement)
    && statement.exportClause !== undefined
    && ts.isNamedExports(statement.exportClause)
    && statement.exportClause.elements.some(element =>
        (element.propertyName?.text ?? element.name.text) === originalName
      && element.name.text === exportedName,
    ),
    );
}

export function unexpectedConsumers(
    facade: string,
    scope: readonly string[],
    allowedConsumers: readonly string[],
): string[] {
    const allowed = new Set(allowedConsumers);
    return scope
        .filter(file => file !== facade && !allowed.has(file))
        .filter(file => staticImportsOf(file).includes(facade))
        .map(file => `${file} -> ${facade}`);
}

export function oversizedFiles(
    files: readonly string[],
    maximumLines: number,
): string[] {
    return files
        .map(file => ({ file, lines: readSource(file).split('\n').length }))
        .filter(entry => entry.lines > maximumLines)
        .map(entry => `${entry.file} (${String(entry.lines)} lines)`);
}
