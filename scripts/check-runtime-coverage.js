#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config', 'coverage.json');
const jestSummaryPath = path.join(root, 'coverage', 'coverage-summary.json');
const runtimeSummaryPath = path.join(root, 'coverage', 'runtime-summary.json');
const markdownPath = path.join(root, 'coverage', 'runtime-summary.md');

function checkRuntimeCoverage(options = {}) {
  const cwd = options.cwd ?? root;
  const config = options.config ?? readJson(path.join(cwd, 'config', 'coverage.json'));
  validateConfig(config);
  const jestSummary = options.jestSummary
    ?? readJson(path.join(cwd, 'coverage', 'coverage-summary.json'));
  const inventory = runtimeSourceInventory(cwd, config);
  const result = summarizeRuntimeCoverage(cwd, jestSummary, inventory, config);
  const outputDirectory = path.join(cwd, 'coverage');

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, 'runtime-summary.json'),
    `${JSON.stringify(result, undefined, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDirectory, 'runtime-summary.md'),
    renderMarkdown(result),
  );
  console.log(renderConsole(result));

  if (!result.passed) {
    const failed = result.failures
      .map(item => `${item.metric} ${item.actual}% < ${item.minimum}%`)
      .join(', ');
    throw new Error(`Runtime coverage thresholds failed: ${failed}.`);
  }
  return result;
}

function runtimeSourceInventory(cwd, config) {
  const sourceRoot = path.join(cwd, config.sourceRoot);
  const files = visitTypeScriptFiles(sourceRoot);
  const included = [];
  const excluded = [];
  for (const absolutePath of files) {
    const relativePath = normalizePath(path.relative(cwd, absolutePath));
    const configured = config.excludedPathPrefixes.some(prefix =>
      relativePath.startsWith(prefix),
    );
    const typeOnly = !configured && !hasRuntimeStatements(
      fs.readFileSync(absolutePath, 'utf8'),
      relativePath,
    );
    const item = { absolutePath, relativePath };
    if (configured || typeOnly) {
      excluded.push({
        ...item,
        reason: configured ? 'configured' : 'type-only',
      });
    } else {
      included.push(item);
    }
  }
  return { included, excluded };
}

function visitTypeScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...visitTypeScriptFiles(absolutePath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function hasRuntimeStatements(source, fileName = 'source.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return sourceFile.statements.some(isRuntimeStatement);
}

function isRuntimeStatement(statement) {
  if (ts.isImportDeclaration(statement)
      || ts.isExportDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEmptyStatement(statement)) {
    return false;
  }
  return !hasDeclareModifier(statement);
}

function hasDeclareModifier(statement) {
  return ts.canHaveModifiers(statement)
    && ts.getModifiers(statement)?.some(
      modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword,
    ) === true;
}

function summarizeRuntimeCoverage(cwd, jestSummary, inventory, config) {
  const byRelativePath = new Map(
    Object.entries(jestSummary)
      .filter(([fileName]) => fileName !== 'total')
      .map(([fileName, coverage]) => [
        normalizePath(path.relative(cwd, fileName)),
        coverage,
      ]),
  );
  const missing = inventory.included
    .map(file => file.relativePath)
    .filter(fileName => !byRelativePath.has(fileName));
  if (missing.length > 0) {
    throw new Error(
      `Jest coverage is missing ${String(missing.length)} runtime source file(s): ${missing.slice(0, 5).join(', ')}`,
    );
  }
  const totals = aggregateCoverage(inventory.included.map(file =>
    byRelativePath.get(file.relativePath),
  ));
  const failures = METRICS
    .filter(metric => totals[metric].pct < config.thresholds[metric])
    .map(metric => ({
      metric,
      actual: totals[metric].pct,
      minimum: config.thresholds[metric],
    }));
  return {
    schemaVersion: 1,
    scope: {
      sourceRoot: config.sourceRoot,
      runtimeFiles: inventory.included.length,
      excludedFiles: inventory.excluded.length,
      excludedByReason: countExcludedReasons(inventory.excluded),
    },
    thresholds: config.thresholds,
    totals,
    passed: failures.length === 0,
    failures,
  };
}

function aggregateCoverage(records) {
  const totals = Object.fromEntries(METRICS.map(metric => [
    metric,
    { total: 0, covered: 0, skipped: 0, pct: 100 },
  ]));
  for (const record of records) {
    for (const metric of METRICS) {
      totals[metric].total += record[metric].total;
      totals[metric].covered += record[metric].covered;
      totals[metric].skipped += record[metric].skipped;
    }
  }
  for (const metric of METRICS) {
    const value = totals[metric];
    value.pct = coveragePercent(value.covered, value.total);
  }
  return totals;
}

function coveragePercent(covered, total) {
  return total === 0 ? 100 : Math.floor((covered / total) * 10_000) / 100;
}

function countExcludedReasons(excluded) {
  return excluded.reduce((counts, item) => ({
    ...counts,
    [item.reason]: (counts[item.reason] ?? 0) + 1,
  }), {});
}

function renderConsole(result) {
  const rows = METRICS.map(metric => {
    const total = result.totals[metric];
    return `${metric.padEnd(10)} ${String(total.pct).padStart(6)}%  floor ${String(result.thresholds[metric]).padStart(3)}%  (${String(total.covered)}/${String(total.total)})`;
  });
  return [
    'EntityKit TypeScript runtime coverage',
    ...rows,
    `scope      ${String(result.scope.runtimeFiles)} runtime files; ${String(result.scope.excludedFiles)} type-only/example files excluded`,
    result.passed ? 'Coverage thresholds passed.' : 'Coverage thresholds failed.',
  ].join('\n');
}

function renderMarkdown(result) {
  const rows = METRICS.map(metric => {
    const total = result.totals[metric];
    return `| ${metric} | ${String(total.pct)}% | ${String(result.thresholds[metric])}% | ${String(total.covered)} / ${String(total.total)} |`;
  });
  return [
    '# EntityKit runtime coverage',
    '',
    `Status: **${result.passed ? 'passed' : 'failed'}**`,
    '',
    '| Metric | Actual | Floor | Covered |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
    '',
    `Scope: ${String(result.scope.runtimeFiles)} executable TypeScript source files. `
      + `${String(result.scope.excludedFiles)} type-only or configured example files were excluded.`,
    '',
  ].join('\n');
}

function validateConfig(config) {
  if (config.schemaVersion !== 1 || typeof config.sourceRoot !== 'string'
      || !Array.isArray(config.excludedPathPrefixes)) {
    throw new Error('config/coverage.json does not match schema version 1.');
  }
  for (const metric of METRICS) {
    const threshold = config.thresholds?.[metric];
    if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
      throw new Error(`Coverage threshold '${metric}' must be between 0 and 100.`);
    }
  }
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(fileName, 'utf8'));
}

function normalizePath(fileName) {
  return fileName.replace(/\\/g, '/');
}

if (require.main === module) {
  try {
    checkRuntimeCoverage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  aggregateCoverage,
  checkRuntimeCoverage,
  coveragePercent,
  hasRuntimeStatements,
  renderMarkdown,
  runtimeSourceInventory,
  summarizeRuntimeCoverage,
};
