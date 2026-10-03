// Treat every advisory as a failure unless its entire tooling-only path was
// explicitly reviewed. Runtime audits never consult the tooling exception.
function evaluateAudits(runtimeReports, fullReport, lock, policy, now = new Date()) {
  const errors = [];
  function findings(report, scope) {
    if (report?.auditReportVersion !== 2 || report.error
      || !report.vulnerabilities || !report.metadata?.vulnerabilities
      || report.metadata.vulnerabilities.total !== Object.keys(report.vulnerabilities).length) {
      errors.push(`${scope}: incomplete npm audit report`);
      return {};
    }
    return report.vulnerabilities;
  }
  for (const [scope, report] of Object.entries(runtimeReports)) {
    for (const name of Object.keys(findings(report, scope))) {
      errors.push(`${scope}: runtime advisory affects ${name}`);
    }
  }
  const full = findings(fullReport, 'tooling');
  const expires = Date.parse(policy.expires);
  if (!Number.isFinite(expires) || now.getTime() >= expires) {
    errors.push('tooling: advisory review expired');
  }
  function check(name, visited = new Set()) {
    const finding = full[name];
    if (!finding || visited.has(name) || !Array.isArray(finding.via) || !finding.via.length
      || !Array.isArray(finding.nodes) || !finding.nodes.length) {
      errors.push(`tooling: incomplete advisory chain for ${name}`);
      return;
    }
    const next = new Set([...visited, name]);
    for (const node of finding.nodes) {
      const installed = lock.packages?.[node];
      if (!installed || installed.dev !== true || policy.nodes[node] !== installed.version) {
        errors.push(`tooling: unreviewed dependency path ${node}`);
      }
    }
    for (const via of finding.via) {
      if (typeof via === 'string') check(via, next);
      else if (name !== policy.package || via.url !== policy.advisory) {
        errors.push(`tooling: unreviewed advisory ${via.url ?? name}`);
      }
    }
  }
  for (const name of Object.keys(full)) check(name);
  return [...new Set(errors)];
}

module.exports = { evaluateAudits };
