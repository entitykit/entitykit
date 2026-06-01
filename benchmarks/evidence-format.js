function formatBenchmarkEvidence(environment, results) {
  const lines = [
    `# Benchmark Evidence: ${environment.suite}`,
    "",
    "These numbers are local performance guardrails, not published performance claims.",
    "",
    "## Environment",
    "",
    "| Field | Value |",
    "| --- | --- |"
  ];

  for (const [key, value] of Object.entries(environment)) {
    lines.push(`| ${key} | ${escapeMarkdownTableValue(String(value))} |`);
  }

  lines.push(
    "",
    "## Summary",
    "",
    "| Group | Cases | Best per-operation ms | Slowest per-operation ms |",
    "| --- | ---: | ---: | ---: |"
  );

  for (const summary of summarizeBenchmarkResults(results)) {
    lines.push(`| ${summary.group} | ${summary.cases} | ${summary.bestPerOperationMs.toFixed(4)} | ${summary.slowestPerOperationMs.toFixed(4)} |`);
  }

  const comparisons = summarizeBenchmarkComparisons(results);
  if (comparisons.length > 0) {
    lines.push(
      "",
      "## Raw Baseline Comparisons",
      "",
      "These ratios compare paired raw `pg` and EntityKit cases from the same local run. They are sorted by extra milliseconds per operation as triage signals for the next internal optimization, not public claims.",
      "",
      "| Rank | Area | Raw pg ms/op | EntityKit ms/op | EntityKit/raw ratio | Extra ms/op |",
      "| ---: | --- | ---: | ---: | ---: | ---: |"
    );

    for (const [index, comparison] of comparisons.entries()) {
      lines.push([
        `| ${index + 1}`,
        escapeMarkdownTableValue(comparison.area),
        comparison.rawPerOperationMs.toFixed(4),
        comparison.entityKitPerOperationMs.toFixed(4),
        comparison.ratio.toFixed(2),
        comparison.extraPerOperationMs.toFixed(4)
      ].join(" | ") + " |");
    }
  }

  lines.push(
    "",
    "## Raw Results",
    "",
    "| Case | Iterations | Total ms | Per operation ms | Operations/sec |",
    "| --- | ---: | ---: | ---: | ---: |"
  );

  for (const result of results) {
    lines.push([
      `| ${escapeMarkdownTableValue(result.name)}`,
      result.iterations,
      result.totalMs.toFixed(2),
      result.perOperationMs.toFixed(4),
      result.operationsPerSecond.toFixed(0)
    ].join(" | ") + " |");
  }

  lines.push("");
  return lines.join("\n");
}

function summarizeBenchmarkResults(results) {
  const groups = new Map();
  for (const result of results) {
    const group = benchmarkGroup(result.name);
    const current = groups.get(group) ?? {
      group,
      cases: 0,
      bestPerOperationMs: Number.POSITIVE_INFINITY,
      slowestPerOperationMs: 0
    };
    current.cases += 1;
    current.bestPerOperationMs = Math.min(current.bestPerOperationMs, result.perOperationMs);
    current.slowestPerOperationMs = Math.max(current.slowestPerOperationMs, result.perOperationMs);
    groups.set(group, current);
  }
  return Array.from(groups.values()).sort((left, right) => left.group.localeCompare(right.group));
}

function summarizeBenchmarkComparisons(results) {
  const byName = new Map(results.map(result => [result.name, result]));
  return benchmarkComparisonPairs()
    .map(pair => {
      const raw = byName.get(pair.raw);
      const entityKit = byName.get(pair.entityKit);
      if (!raw || !entityKit) {
        return undefined;
      }

      return {
        area: pair.area,
        rawPerOperationMs: raw.perOperationMs,
        entityKitPerOperationMs: entityKit.perOperationMs,
        ratio: raw.perOperationMs === 0 ? Number.POSITIVE_INFINITY : entityKit.perOperationMs / raw.perOperationMs,
        extraPerOperationMs: entityKit.perOperationMs - raw.perOperationMs
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const extraDifference = Math.abs(right.extraPerOperationMs) - Math.abs(left.extraPerOperationMs);
      if (extraDifference !== 0) {
        return extraDifference;
      }
      return right.ratio - left.ratio;
    });
}

function benchmarkComparisonPairs() {
  return [
    {
      area: "primary-key lookup",
      raw: "raw pg: select by id",
      entityKit: "EntityKit: DbSet.find by id"
    },
    {
      area: "many-row materialization",
      raw: "raw pg: materialize many rows",
      entityKit: "EntityKit: materialize many rows"
    },
    {
      area: "one-to-many include split query",
      raw: "raw pg: include posts splitQuery baseline",
      entityKit: "EntityKit: include posts splitQuery"
    },
    {
      area: "one-to-many filtered include take",
      raw: "raw pg: include posts windowedBatch take per user",
      entityKit: "EntityKit: include posts windowedBatch take per user"
    },
    {
      area: "one-to-many filtered include skip/take",
      raw: "raw pg: include posts windowedBatch skip/take per user",
      entityKit: "EntityKit: include posts windowedBatch skip/take per user"
    },
    {
      area: "many-to-many filtered include take",
      raw: "raw pg: include tags windowedBatch take per post",
      entityKit: "EntityKit: include tags windowedBatch take per post"
    },
    {
      area: "many-to-many filtered include skip/take",
      raw: "raw pg: include tags windowedBatch skip/take per post",
      entityKit: "EntityKit: include tags windowedBatch skip/take per post"
    },
    {
      area: "tracked save update",
      raw: "raw pg: select then update by id",
      entityKit: "EntityKit: saveChanges update"
    },
    {
      area: "attached save update",
      raw: "raw pg: update by id",
      entityKit: "EntityKit: saveChanges attached update"
    },
    {
      area: "save delete",
      raw: "raw pg: delete by id",
      entityKit: "EntityKit: saveChanges delete"
    },
    {
      area: "save insert",
      raw: "raw pg: insert one row",
      entityKit: "EntityKit: saveChanges insert"
    },
    {
      area: "save insert batch",
      raw: "raw pg: insert batch",
      entityKit: "EntityKit: saveChanges insert batch"
    },
    {
      area: "many-to-many link batch",
      raw: "raw pg: many-to-many link batch",
      entityKit: "EntityKit: saveChanges many-to-many link batch"
    },
    {
      area: "many-to-many link batch transaction-normalized",
      raw: "raw pg: many-to-many link batch transaction",
      entityKit: "EntityKit: saveChanges many-to-many link batch"
    },
    {
      area: "outbox batch",
      raw: "raw pg: outbox batch",
      entityKit: "EntityKit: saveChanges outbox batch"
    },
    {
      area: "mixed graph save",
      raw: "raw pg: mixed graph save",
      entityKit: "EntityKit: saveChanges mixed graph"
    }
  ];
}

function benchmarkGroup(name) {
  if (name.startsWith("raw pg:")) {
    return "raw pg baseline";
  }
  if (name.includes("include")) {
    return "include loading";
  }
  if (name.includes("saveChanges")) {
    return "saveChanges";
  }
  if (name.includes("compile") || name.includes("toSql") || name.includes("query builder")) {
    return "query compilation";
  }
  return "read queries";
}

function escapeMarkdownTableValue(value) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

module.exports = {
  formatBenchmarkEvidence,
  summarizeBenchmarkComparisons,
  summarizeBenchmarkResults
};
