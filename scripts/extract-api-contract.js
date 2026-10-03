const path = require('node:path');
const { Extractor, ExtractorConfig } = require('@microsoft/api-extractor');

function extractApiContract(project, entry, label, reports, temporary, accept) {
  const packageJsonFullPath = path.join(project, 'package.json');
  const config = ExtractorConfig.prepare({
    configObjectFullPath: path.join(project, 'api-extractor.json'),
    packageJsonFullPath,
    configObject: {
      projectFolder: project,
      mainEntryPointFilePath: entry,
      newlineKind: 'lf',
      compiler: { overrideTsconfig: {
        compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16',
          strict: true, esModuleInterop: true, skipLibCheck: true, types: ['node'] },
        files: [entry],
      } },
      apiReport: { enabled: true, reportFileName: `${label}.api.md`,
        reportFolder: reports, reportTempFolder: temporary, includeForgottenExports: true },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: { extractorMessageReporting: {
        'ae-missing-release-tag': { logLevel: 'none' },
        'ae-forgotten-export': { logLevel: 'warning', addToApiReportFile: true },
      } },
    },
  });
  const result = Extractor.invoke(config, { localBuild: accept });
  return result.succeeded;
}

module.exports = { extractApiContract };
