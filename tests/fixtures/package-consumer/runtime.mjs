import { DbContext } from 'entitykit';
import { sqliteProviderServices } from 'entitykit/sqlite';

if (DbContext.name !== 'DbContext' || sqliteProviderServices.name !== 'sqlite') {
  throw new Error('Packaged ESM imports did not resolve CommonJS exports.');
}

process.stdout.write('PACKAGE_ESM_IMPORT_OK\n');
