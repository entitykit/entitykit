// prepublishOnly guard, wired into every publishable workspace. npm runs this
// hook with the cwd set to the package being published, so the manifest beside
// us is the one about to reach the registry: the guard checks that package's
// own publishConfig, not the repository root's.
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(process.cwd(), 'package.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : {};
const declaredTag = manifest.publishConfig?.tag;
// npm does NOT fold publishConfig.tag into npm_config_tag, so a bare
// `npm publish` leaves this undefined even for an alpha-pinned package.
const invokedTag = process.env.npm_config_tag;

function refuse(reason) {
  console.error(
    `Refusing prerelease publication of ${manifest.name ?? 'this package'}: `
    + `${reason} Use npm run release:alpha or npm publish --tag alpha.`,
  );
  process.exit(1);
}

if (declaredTag !== undefined && declaredTag !== 'alpha') {
  refuse(`its publishConfig pins dist-tag '${declaredTag}'.`);
}

if (invokedTag !== 'alpha') {
  refuse(`the invocation carries dist-tag '${invokedTag ?? 'latest'}'.`);
}
