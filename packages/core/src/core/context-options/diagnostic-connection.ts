import { DiagnosticDatabaseConnection } from '../../diagnostics/runtime/diagnostic-database-connection';
import type { RuntimeDiagnosticsEmitter } from '../../diagnostics/runtime/events';
import type { DatabaseConnection } from '../../storage/database-connection';

export function wrapDiagnosticConnection(
    connection: DatabaseConnection,
    provider: string,
    handlers: readonly RuntimeDiagnosticsEmitter[],
): DatabaseConnection {
    return new DiagnosticDatabaseConnection(connection, provider, event => {
        for (const handler of handlers) {
            handler(event);
        }
    });
}
