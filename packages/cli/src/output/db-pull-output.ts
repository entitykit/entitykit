import type { DbPullDiagnostic, GeneratedCodeFile } from '@entitykit/core/tooling';

/** Render the summary for db-pull files written to disk. */
export function renderDbPullWriteResult(
    fileCount: number,
    outputDir: string,
    diagnostics: readonly DbPullDiagnostic[],
): string {
    const lines = [`Wrote ${String(fileCount)} db pull file(s) to ${outputDir}.`];
    if (diagnostics.length > 0) {
        lines.push('', ...renderDiagnosticWarnings(diagnostics));
    }
    return lines.join('\n');
}

/** Render generated db-pull files for stdout. */
export function renderGeneratedFiles(
    files: readonly GeneratedCodeFile[],
    diagnostics: readonly DbPullDiagnostic[],
): string {
    const lines = [files.map(file => [
        `// ${file.path}`,
        file.contents.trimEnd(),
    ].join('\n')).join('\n\n')];
    if (diagnostics.length > 0) {
        lines.push('', renderDiagnosticWarnings(diagnostics).join('\n'));
    }
    return lines.join('\n');
}

function renderDiagnosticWarnings(diagnostics: readonly DbPullDiagnostic[]): string[] {
    const labels: Record<DbPullDiagnostic['category'], string> = {
        'generated-name': 'Generated names',
        table: 'Tables',
        column: 'Columns',
        index: 'Indexes',
        relationship: 'Relationships',
        'unsupported-schema': 'Unsupported schema features',
    };
    const order: ReadonlyArray<DbPullDiagnostic['category']> = [
        'generated-name',
        'table',
        'column',
        'index',
        'relationship',
        'unsupported-schema',
    ];
    const lines = ['Review required:'];
    for (const category of order) {
        const items = diagnostics.filter(diagnostic => diagnostic.category === category);
        if (items.length === 0) {
            continue;
        }
        lines.push(`  ${labels[category]}:`);
        lines.push(...items.map(diagnostic => `    - ${diagnostic.message}`));
    }
    return lines;
}
