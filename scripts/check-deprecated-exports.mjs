import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Use the consumer's compiler and installed declarations, as its editor would.
const project = path.resolve(process.argv[2]);
const ts = createRequire(path.join(project, 'package.json'))('typescript');
const fixture = path.join(project, 'deprecated-exports.ts');
const pairs = [
  ['rootSelect', 'focusedSelect'],
  ['rootAssert', 'focusedAssert'],
  ['rootDate', 'focusedDate'],
];

for (const [extension, module, moduleResolution] of [
  ['cts', ts.ModuleKind.Node16, ts.ModuleResolutionKind.Node16],
  ['mts', ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext],
]) {
  const file = path.join(project, `editor-consumer.${extension}`);
  fs.copyFileSync(fixture, file, fs.constants.COPYFILE_EXCL);
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module, moduleResolution };
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => '0',
    getScriptSnapshot: name => {
      const text = ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => project,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    realpath: ts.sys.realpath,
  });
  try {
    const diagnostics = [
      ...service.getSyntacticDiagnostics(file),
      ...service.getSemanticDiagnostics(file),
    ];
    assert.equal(diagnostics.length, 0, diagnostics.map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
    const program = service.getProgram();
    const checker = program.getTypeChecker();
    const references = new Map(pairs.flat().map(name => [name, []]));
    const visit = node => {
      if (ts.isIdentifier(node) && references.has(node.text)
        && ((ts.isImportSpecifier(node.parent) && node.parent.name === node)
          || (ts.isCallExpression(node.parent) && node.parent.expression === node))) {
        references.get(node.text).push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(program.getSourceFile(file));
    const signatures = name => checker.getSignaturesOfType(
      checker.getTypeAtLocation(references.get(name)[0]), ts.SignatureKind.Call,
    ).map(signature => checker.signatureToString(signature, undefined, ts.TypeFormatFlags.NoTruncation));

    for (const [legacy, focused] of pairs) {
      for (const name of [legacy, focused]) {
        const nodes = references.get(name);
        assert.equal(nodes.length, 2, `${extension}: ${name} needs import and call coverage`);
        for (const node of nodes) {
          const info = service.getQuickInfoAtPosition(file, node.getStart() + 1);
          assert(info, `${extension}: missing hover for ${name}`);
          const deprecation = info.tags?.find(tag => tag.name === 'deprecated');
          const site = ts.isImportSpecifier(node.parent) ? 'import' : 'call';
          assert.equal(Boolean(deprecation), name === legacy, `${extension}: ${name} ${site} deprecation`);
          if (deprecation) {
            const entry = legacy === 'rootDate' ? '@entitykit/core/tooling' : '@entitykit/core/adapter';
            assert(ts.displayPartsToString(deprecation.text).includes(entry), `${name} must name its replacement entry`);
          }
        }
      }
      assert(signatures(focused).length > 0, `${focused} must retain its callable signature`);
      assert.deepEqual(signatures(legacy), signatures(focused), `${legacy} must preserve the focused signature`);
    }
  } finally {
    service.dispose();
  }
}
process.stdout.write(`PACKAGE_DEPRECATED_EXPORTS_OK TypeScript ${ts.version} Node16 and NodeNext\n`);
