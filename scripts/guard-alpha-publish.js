const tag = process.env.npm_config_tag;

if (tag !== 'alpha') {
  console.error(
    `Refusing prerelease publication with dist-tag '${tag ?? 'latest'}'. `
    + 'Use npm run release:alpha or npm publish --tag alpha.',
  );
  process.exit(1);
}
