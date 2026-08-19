import {
    entityKitCliMetadata,
    findEntityKitCliCommandDefinition,
} from './cli-command-definitions';
import { renderCliCompletion } from './cli-completion';
import type {
    EntityKitCliCommandDefinition,
    EntityKitCliMetadata,
    EntityKitCliOptionDefinition,
    EntityKitCliShell,
} from './cli-metadata-types';

export type {
    EntityKitCliCommandCapabilities,
    EntityKitCliCommandDefinition,
    EntityKitCliMetadata,
    EntityKitCliOptionDefinition,
    EntityKitCliOptionKind,
    EntityKitCliShell,
} from './cli-metadata-types';

/** Return the versioned command model used by parsing, help, and completion. */
export function getEntityKitCliMetadata(): EntityKitCliMetadata {
    return entityKitCliMetadata;
}

/** Return a JSON Schema describing canonical commands and their options. */
export function getEntityKitCliCommandSchema(): Readonly<Record<string, unknown>> {
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'EntityKit CLI command',
        oneOf: entityKitCliMetadata.commands.map(definition => ({
            type: 'object',
            properties: {
                command: { const: definition.name },
                options: {
                    type: 'array',
                    items: { enum: definition.options.map(option => option.name) },
                },
            },
            required: ['command'],
            additionalProperties: false,
        })),
    };
}

/** Render a completion script from the same model used by parsing and help. */
export function renderEntityKitCliCompletion(shell: EntityKitCliShell): string {
    return renderCliCompletion(shell);
}

/** Look up one canonical leaf command. */
export function findEntityKitCliCommand(name: string): EntityKitCliCommandDefinition | undefined {
    return findEntityKitCliCommandDefinition(name);
}

/** Return the option accepted by a command, including global options. */
export function findEntityKitCliOption(
    command: EntityKitCliCommandDefinition,
    spelling: string,
): EntityKitCliOptionDefinition | undefined {
    return [...command.options, ...entityKitCliMetadata.globalOptions]
        .find(option => option.name === spelling || option.shortName === spelling);
}
