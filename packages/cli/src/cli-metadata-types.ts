/** Whether a CLI option is a switch or consumes one or more values. */
export type EntityKitCliOptionKind = 'flag' | 'value' | 'repeatableValue';

/** One option accepted by the EntityKit CLI. */
export interface EntityKitCliOptionDefinition {
    /** Canonical long option name. */ readonly name: `--${string}`;
    /** Optional single-character spelling. */ readonly shortName?: `-${string}`;
    /** Whether the option is a switch or consumes values. */ readonly kind: EntityKitCliOptionKind;
    /** Name shown for an option value in help. */ readonly valueName?: string;
    /** Human-readable option description. */ readonly description: string;
}

/** Side effects and resources a command is allowed to use. */
export interface EntityKitCliCommandCapabilities {
    /** Whether the command needs an EntityKit configuration. */ readonly requiresConfig: boolean;
    /** Whether any invocation may need a live database connection. */ readonly requiresConnection: boolean;
    /** Whether the command may write project files. */ readonly mutatesFiles: boolean;
    /** Whether the command may change a database. */ readonly mutatesDatabase: boolean;
}

/** One canonical EntityKit CLI leaf command. */
export interface EntityKitCliCommandDefinition {
    /** Space-separated command path. */ readonly name: string;
    /** Invocation shown in help. */ readonly usage: string;
    /** Short summary shown in command listings. */ readonly description: string;
    /** Longer command-specific guidance. */ readonly notes: readonly string[];
    /** Options accepted by this command. */ readonly options: readonly EntityKitCliOptionDefinition[];
    /** Examples rendered by command help. */ readonly examples: readonly string[];
    /** Declared command capabilities. */ readonly capabilities: EntityKitCliCommandCapabilities;
}

/** Versioned command metadata for help, completion, and automation. */
export interface EntityKitCliMetadata {
    /** Version of this serialized machine contract. */ readonly schemaVersion: 1;
    /** Options accepted anywhere before `--`. */ readonly globalOptions: readonly EntityKitCliOptionDefinition[];
    /** Canonical leaf commands. */ readonly commands: readonly EntityKitCliCommandDefinition[];
}

/** Shells with generated EntityKit completion scripts. */
export type EntityKitCliShell = 'bash' | 'fish' | 'zsh';
