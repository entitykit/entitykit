import type * as TypeScript from 'typescript';

/** Replace Node's file-backed `import.meta` paths with CommonJS equivalents. */
export function commonJsImportMetaTransformer(
    typescript: typeof TypeScript,
): TypeScript.TransformerFactory<TypeScript.SourceFile> {
    return context => sourceFile => {
        const visit = (node: TypeScript.Node): TypeScript.VisitResult<TypeScript.Node> => {
            const property = importMetaPathProperty(typescript, node);
            if (property) {
                return createCommonJsModulePath(typescript, property);
            }
            return typescript.visitEachChild(node, visit, context);
        };
        return typescript.visitNode(sourceFile, visit) as TypeScript.SourceFile;
    };
}

/** Prevent `.mts` from overriding the requested CommonJS transpilation mode. */
export function commonJsTranspileFileName(filePath: string): string {
    return filePath.toLowerCase().endsWith('.mts')
        ? `${filePath.slice(0, -4)}.ts`
        : filePath;
}

type ImportMetaPathProperty = 'dirname' | 'filename' | 'url';

function importMetaPathProperty(
    typescript: typeof TypeScript,
    node: TypeScript.Node,
): ImportMetaPathProperty | undefined {
    if (
        !typescript.isPropertyAccessExpression(node)
        || !typescript.isMetaProperty(node.expression)
        || node.expression.keywordToken !== typescript.SyntaxKind.ImportKeyword
        || node.expression.name.text !== 'meta'
    ) {
        return undefined;
    }
    return isImportMetaPathProperty(node.name.text) ? node.name.text : undefined;
}

function isImportMetaPathProperty(value: string): value is ImportMetaPathProperty {
    return value === 'dirname' || value === 'filename' || value === 'url';
}

function createCommonJsModulePath(
    typescript: typeof TypeScript,
    property: ImportMetaPathProperty,
): TypeScript.Expression {
    if (property !== 'url') {
        return typescript.factory.createIdentifier(`__${property}`);
    }
    const requiredUrlModule = typescript.factory.createCallExpression(
        typescript.factory.createIdentifier('require'),
        undefined,
        [typescript.factory.createStringLiteral('node:url')],
    );
    const pathToFileUrl = typescript.factory.createPropertyAccessExpression(
        requiredUrlModule,
        'pathToFileURL',
    );
    const moduleUrl = typescript.factory.createCallExpression(
        pathToFileUrl,
        undefined,
        [typescript.factory.createIdentifier('__filename')],
    );
    return typescript.factory.createPropertyAccessExpression(moduleUrl, 'href');
}
