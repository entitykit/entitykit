/** Options that configure driver. */ export type DriverOptions = Readonly<Record<string, unknown>>;
/** Public type representing database tls version. */ export type DatabaseTlsVersion =
    | 'TLSv1'
    | 'TLSv1.1'
    | 'TLSv1.2'
    | 'TLSv1.3';

/** Options that configure database tls. */ export interface DatabaseTlsOptions {
    /** The ca. */ readonly ca?: string | Uint8Array | Array<string | Uint8Array>;
    /** The cert. */ readonly cert?: string | Uint8Array | Array<string | Uint8Array>;
    /** The key. */ readonly key?: string | Uint8Array | Array<string | Uint8Array>;
    /** The passphrase. */ readonly passphrase?: string;
    /** The reject unauthorized. */ readonly rejectUnauthorized?: boolean;
    /** The servername. */ readonly servername?: string;
    /** The ciphers. */ readonly ciphers?: string;
    /** The min version. */ readonly minVersion?: DatabaseTlsVersion;
    /** The max version. */ readonly maxVersion?: DatabaseTlsVersion;
}

/** Options that configure postgres pool. */ export interface PostgresPoolOptions {
    /** The min. */ readonly min?: number;
    /** The max. */ readonly max?: number;
    /** The idle timeout ms. */ readonly idleTimeoutMs?: number;
    /** The connection timeout ms. */ readonly connectionTimeoutMs?: number;
    /** The max lifetime seconds. */ readonly maxLifetimeSeconds?: number;
    /** The max uses. */ readonly maxUses?: number;
    /** The allow exit on idle. */ readonly allowExitOnIdle?: boolean;
    /**
     * Observes errors emitted by idle pooled clients.
     *
     * When omitted, EntityKit emits a redacted process warning so Node does not
     * treat the pool's background `error` event as unhandled.
     */
    readonly onError?: (error: Error) => void;
}

/** Configuration for postgres connection. */ export interface PostgresConnectionConfig {
    /** The connection string. */ readonly connectionString?: string;
    /** The host. */ readonly host?: string;
    /** The port. */ readonly port?: number;
    /** The database. */ readonly database?: string;
    /** The user. */ readonly user?: string;
    /** The password. */ readonly password?: string | (() => string | Promise<string>);
    /** The ssl. */ readonly ssl?: boolean | DatabaseTlsOptions;
    /** The keep alive. */ readonly keepAlive?: boolean;
    /** The keep alive initial delay ms. */ readonly keepAliveInitialDelayMs?: number;
    /** The application name. */ readonly applicationName?: string;
    /** Server-side statement timeout in milliseconds. */
    readonly commandTimeoutMs?: number;
    /** The lock timeout ms. */ readonly lockTimeoutMs?: number;
    /** The idle in transaction timeout ms. */ readonly idleInTransactionTimeoutMs?: number;
    /** The pool. */ readonly pool?: PostgresPoolOptions;
    /** Uncommon `pg` PoolConfig settings. Named EntityKit options win. */
    readonly driverOptions?: DriverOptions;
}

/** Options that configure my sql pool. */ export interface MySqlPoolOptions {
    /** The max. */ readonly max?: number;
    /** The max idle. */ readonly maxIdle?: number;
    /** The idle timeout ms. */ readonly idleTimeoutMs?: number;
    /** The queue limit. */ readonly queueLimit?: number;
    /** The wait for connections. */ readonly waitForConnections?: boolean;
    /** The reset on release. */ readonly resetOnRelease?: boolean;
}

/** Configuration for my sql connection. */ export interface MySqlConnectionConfig {
    /** The connection string. */ readonly connectionString?: string;
    /** The host. */ readonly host?: string;
    /** The port. */ readonly port?: number;
    /** The user. */ readonly user?: string;
    /** The password. */ readonly password?: string;
    /** The database. */ readonly database?: string;
    /** The ssl. */ readonly ssl?: false | string | DatabaseTlsOptions;
    /** The charset. */ readonly charset?: string;
    /** The timezone. */ readonly timezone?: string;
    /** The keep alive. */ readonly keepAlive?: boolean;
    /** The keep alive initial delay ms. */ readonly keepAliveInitialDelayMs?: number;
    /** The connect timeout ms. */ readonly connectTimeoutMs?: number;
    /** Per-command `mysql2` inactivity timeout in milliseconds. */
    readonly commandTimeoutMs?: number;
    /** The pool. */ readonly pool?: MySqlPoolOptions;
    /** Uncommon `mysql2` PoolOptions settings. Named EntityKit options win. */
    readonly driverOptions?: DriverOptions;
}

/** Configuration for sqlite connection. */ export interface SqliteConnectionConfig {
    /** Database file path, or `:memory:` for an in-memory database. */
    readonly filename?: string;
    /** Alias for `filename`, so connection strings work like other providers. */
    readonly connectionString?: string;
    /** Open an existing database without write access. */
    readonly readOnly?: boolean;
    /**
     * Enforce foreign-key constraints. Node defaults this to `true`; set it to
     * `false` only for compatibility with a legacy schema.
     */
    readonly foreignKeys?: boolean;
    /** Milliseconds to wait for a write lock before failing with `SQLITE_BUSY`. */
    readonly busyTimeoutMs?: number;
    /** Journal mode, for example `"WAL"`. */
    readonly journalMode?: string;
}
