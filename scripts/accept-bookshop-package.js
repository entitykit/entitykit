const fs = require('node:fs');
const path = require('node:path');

/** Compile and run the example outside the checkout against accepted tarballs. */
function acceptBookshopPackage(root, project, run) {
  const example = path.join(project, 'bookshop');
  fs.mkdirSync(example);
  const authored = path.join(root, 'examples', 'bookshop');
  fs.cpSync(path.join(authored, 'src'), path.join(example, 'src'), { recursive: true });
  fs.copyFileSync(path.join(authored, 'tsconfig.json'), path.join(example, 'tsconfig.json'));
  fs.writeFileSync(path.join(example, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
  run(process.execPath, [
    path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p', path.join(example, 'tsconfig.json'),
  ], { cwd: project });
  run(process.execPath, [
    '--unhandled-rejections=strict', path.join(example, 'dist', 'qualify.js'), 'sqlite',
  ], { cwd: project });
  process.stdout.write('PACKAGE_BOOKSHOP_TYPES_RUNTIME_RECOVERY_OK\n');
}

module.exports = { acceptBookshopPackage };
