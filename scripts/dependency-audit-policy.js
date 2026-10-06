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
  const reviews = policy?.reviews;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return [...errors, 'tooling: incomplete advisory review policy'];
  }
  const identities = new Set();
  for (const review of reviews) {
    if (!review?.package || !review.advisory || !review.nodes
      || typeof review.nodes !== 'object' || Array.isArray(review.nodes)) {
      errors.push('tooling: incomplete or duplicate advisory review');
      continue;
    }
    const identity = `${review.package}:${review.advisory}`;
    if (identities.has(identity)) {
      errors.push('tooling: incomplete or duplicate advisory review');
    }
    identities.add(identity);
    const expires = Date.parse(review.expires);
    if (!Number.isFinite(expires) || now.getTime() >= expires) {
      errors.push(`tooling: advisory review expired (${review.package})`);
    }
  }
  function check(name, visited = new Set(), ancestors = []) {
    const finding = full[name];
    if (!finding || visited.has(name) || !Array.isArray(finding.via) || !finding.via.length
      || !Array.isArray(finding.nodes) || !finding.nodes.length) {
      errors.push(`tooling: incomplete advisory chain for ${name}`);
      return;
    }
    const next = new Set([...visited, name]);
    const chain = [...ancestors, finding];
    for (const via of finding.via) {
      if (typeof via === 'string') check(via, next, chain);
      else {
        const review = reviews.find(item => item?.package === name && item.advisory === via.url);
        if (!review) errors.push(`tooling: unreviewed advisory ${via.url ?? name}`);
        // Every ancestor must belong to this specific advisory's reviewed
        // path. Another review cannot authorize a shared or newly added node.
        for (const entry of chain) for (const node of entry.nodes) {
          const installed = lock.packages?.[node];
          if (!installed || installed.dev !== true || review?.nodes?.[node] !== installed.version) {
            errors.push(`tooling: unreviewed dependency path ${node}`);
          }
        }
      }
    }
  }
  for (const name of Object.keys(full)) check(name);
  return [...new Set(errors)];
}

module.exports = { evaluateAudits };
