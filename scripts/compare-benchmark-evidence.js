#!/usr/bin/env node


const { readFileSync } = require("node:fs");
const path = require("node:path");

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error("Usage: node scripts/compare-benchmark-evidence.js <before-evidence.md> <after-evidence.md>");
    process.exitCode = 1;
    return;
  }

  const before = parseBenchmarkEvidence(readFileSync(beforePath, "utf8"), beforePath);
  const after = parseBenchmarkEvidence(readFileSync(afterPath, "utf8"), afterPath);
  console.log(formatBenchmarkEvidenceComparison(before, after));
}

function parseBenchmarkEvidence(markdown, filePath = "benchmark-evidence.md") {
  const environment = parseTableAfterHeading(markdown, "## Environment")
    .reduce((values, row) => ({ ...values, [row[0]]: row[1] }), {});
  const rawResults = parseTableAfterHeading(markdown, "## Raw Results")
    .map(row => ({
      name: row[0],
      iterations: Number(row[1]),
      totalMs: Number(row[2]),
      perOperationMs: Number(row[3]),
      operationsPerSecond: Number(row[4])
    }))
    .filter(result => result.name && Number.isFinite(result.perOperationMs));

  if (rawResults.length === 0) {
    throw new Error(`No raw benchmark results were found in ${filePath}.`);
  }

  return {
    filePath,
    environment,
    results: rawResults
  };
}

function formatBenchmarkEvidenceComparison(before, after) {
  const comparisons = compareBenchmarkEvidence(before, after);
  const lines = [
    "# Benchmark Evidence Comparison",
    "",
    "These deltas are local regression guidance, not published performance claims.",
    "",
    "## Inputs",
    "",
    `- Before: \`${before.filePath}\`${formatEnvironmentSuffix(before.environment)}`,
    `- After: \`${after.filePath}\`${formatEnvironmentSuffix(after.environment)}`,
    "",
    "## Matched Cases",
    "",
    "| Case | Before ms/op | After ms/op | Delta ms/op | Change |",
    "| --- | ---: | ---: | ---: | ---: |"
  ];

  for (const comparison of comparisons.matched) {
    lines.push([
      `| ${escapeMarkdownTableValue(comparison.name)}`,
      comparison.beforePerOperationMs.toFixed(4),
      comparison.afterPerOperationMs.toFixed(4),
      formatSigned(comparison.deltaPerOperationMs),
      formatPercent(comparison.percentChange)
    ].join(" | ") + " |");
  }

  if (comparisons.missingInAfter.length > 0 || comparisons.missingInBefore.length > 0) {
    lines.push("", "## Unmatched Cases", "");
    for (const name of comparisons.missingInAfter) {
      lines.push(`- Missing after: \`${name}\``);
    }
    for (const name of comparisons.missingInBefore) {
      lines.push(`- New after: \`${name}\``);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function compareBenchmarkEvidence(before, after) {
  const beforeByName = new Map(before.results.map(result => [result.name, result]));
  const afterByName = new Map(after.results.map(result => [result.name, result]));
  const matched = [];

  for (const [name, beforeResult] of beforeByName) {
    const afterResult = afterByName.get(name);
    if (!afterResult) {
      continue;
    }
    const delta = afterResult.perOperationMs - beforeResult.perOperationMs;
    matched.push({
      name,
      beforePerOperationMs: beforeResult.perOperationMs,
      afterPerOperationMs: afterResult.perOperationMs,
      deltaPerOperationMs: delta,
      percentChange: beforeResult.perOperationMs === 0 ? Number.POSITIVE_INFINITY : delta / beforeResult.perOperationMs
    });
  }

  matched.sort((left, right) => Math.abs(right.deltaPerOperationMs) - Math.abs(left.deltaPerOperationMs));

  return {
    matched,
    missingInAfter: Array.from(beforeByName.keys()).filter(name => !afterByName.has(name)).sort(),
    missingInBefore: Array.from(afterByName.keys()).filter(name => !beforeByName.has(name)).sort()
  };
}

function parseTableAfterHeading(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex(line => line.trim() === heading);
  if (headingIndex === -1) {
    return [];
  }

  const rows = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) {
      if (rows.length > 0) {
        break;
      }
      continue;
    }
    if (!line.startsWith("|")) {
      if (rows.length > 0) {
        break;
      }
      continue;
    }
    if (/^\|\s*-+/.test(line)) {
      continue;
    }
    const row = splitMarkdownTableRow(line);
    if (row.length > 0 && !isHeaderRow(row)) {
      rows.push(row);
    }
  }
  return rows;
}

function splitMarkdownTableRow(line) {
  const cells = [];
  let current = "";
  let escaped = false;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(unescapeMarkdownTableValue(current.trim()));
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(unescapeMarkdownTableValue(current.trim()));
  return cells;
}

function isHeaderRow(row) {
  return row.some(cell => cell === "Field" || cell === "Case");
}

function formatEnvironmentSuffix(environment) {
  const details = [];
  if (environment.suite) {
    details.push(`suite ${environment.suite}`);
  }
  if (environment.gitCommit) {
    details.push(`commit ${environment.gitCommit}`);
  }
  return details.length > 0 ? ` (${details.join(", ")})` : "";
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function escapeMarkdownTableValue(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function unescapeMarkdownTableValue(value) {
  return value.replace(/\\\|/g, "|").replace(/`/g, "");
}

if (require.main === module) {
  main();
}

module.exports = {
  compareBenchmarkEvidence,
  formatBenchmarkEvidenceComparison,
  parseBenchmarkEvidence
};
