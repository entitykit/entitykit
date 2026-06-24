import { DiagnosticDatabaseConnection } from '../../diagnostics/runtime/diagnostic-database-connection';
import type {
    RuntimeDiagnosticsHandler,
} from '../../diagnostics/runtime/events';
import type { DatabaseConnection } from '../../storage/database-connection';

export function wrapDiagnosticConnection(
    connection: DatabaseConnection,
    provider: string,
    handlers: readonly RuntimeDiagnosticsHandler[],
): DatabaseConnection {
    return new DiagnosticDatabaseConnection(connection, provider, event => {
        for (const handler of handlers) {
            handler(event);
        }
    });
}
