// Shared by local dry-run acceptance and the artifact-only release jobs.
// Numbers stay exact even when a malformed registry response exceeds JS's
// safe-integer range. Only canonical alpha.N and stable versions are accepted.
const numeric = '(0|[1-9][0-9]*)';
const versionPattern = new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-alpha\\.${numeric})?$`, 'u');

function releasePolicy(version) {
  const match = typeof version === 'string' && version.length <= 128
    ? versionPattern.exec(version) : null;
  if (!match) throw new Error(`Unsupported release version: ${String(version)}.`);
  const channel = match[4] === undefined ? 'stable' : 'alpha';
  return {
    version,
    channel,
    targetTag: channel === 'stable' ? 'latest' : 'alpha',
    candidateTag: `${channel}-candidate`,
    parts: match.slice(1, 4).map(BigInt),
    prerelease: match[4] === undefined ? undefined : BigInt(match[4]),
  };
}

function requireReleaseVersion(version, channel) {
  if (channel !== 'alpha' && channel !== 'stable') {
    throw new Error(`Unsupported release channel: ${String(channel)}.`);
  }
  const policy = releasePolicy(version);
  if (policy.channel !== channel) {
    throw new Error(`Refusing ${channel} release: ${version} belongs to ${policy.channel}.`);
  }
  return policy;
}

function compareVersions(left, right) {
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) {
      return left.parts[index] > right.parts[index] ? 1 : -1;
    }
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease > right.prerelease ? 1 : -1;
}

function requireForwardRelease(version, channel, current, allowNewPackage = false) {
  const next = requireReleaseVersion(version, channel);
  if (current === undefined || current === '') {
    if (channel !== 'stable' && !allowNewPackage) throw new Error('The current alpha tag must resolve.');
    return 'bootstrap';
  }
  const previous = releasePolicy(current);
  if (channel === 'alpha' && previous.channel !== 'alpha') {
    throw new Error(`Current alpha version ${current} is not an alpha.`);
  }
  const order = compareVersions(next, previous);
  if (order < 0) throw new Error(`${version} is older than current ${next.targetTag} ${current}.`);
  return order === 0 ? 'retry' : 'forward';
}

module.exports = { releasePolicy, requireReleaseVersion, requireForwardRelease };

if (require.main === module) {
  try {
    const [action, version, channel, current, allowance] = process.argv.slice(2);
    if (allowance !== undefined && allowance !== '' && allowance !== '--allow-new-package') {
      throw new Error(`Unsupported release policy allowance: ${allowance}.`);
    }
    const policy = requireReleaseVersion(version, channel);
    if (action === 'candidate') console.log(`${policy.targetTag} ${policy.candidateTag}`);
    else if (action === 'current') console.log(requireForwardRelease(version, channel, current, allowance === '--allow-new-package'));
    else throw new Error(`Unsupported release policy action: ${String(action)}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
