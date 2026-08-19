#!/usr/bin/env node
import { runEntityKitCli } from './entity-kit-cli';

const cancellation = new AbortController();
let interrupted = false;
const onInterrupt = (): void => {
    if (!interrupted) {
        interrupted = true;
        cancellation.abort(new Error('EntityKit CLI interrupted.'));
        return;
    }
    process.off('SIGINT', onInterrupt);
    process.kill(process.pid, 'SIGINT');
};

process.on('SIGINT', onInterrupt);

runEntityKitCli(process.argv.slice(2), { signal: cancellation.signal })
    .then(result => {
        if (result.stdout) {
            process.stdout.write(`${result.stdout}\n`);
        }
        if (result.stderr) {
            process.stderr.write(`${result.stderr}\n`);
        }
        process.exitCode = result.exitCode;
    })
    .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    })
    .finally(() => {
        process.off('SIGINT', onInterrupt);
    });
