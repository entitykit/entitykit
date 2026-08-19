import { entityKitCliMetadata } from './cli-command-definitions';
import {
    commandCompletionWords,
    fixedCompletionValues,
    fixedValueEntries,
    freeValueSpellings,
    globalOptions,
    groupCompletionWords,
    rootCommands,
    rootCompletionWords,
} from './cli-completion-model';
import type {
    EntityKitCliOptionDefinition,
    EntityKitCliShell,
} from './cli-metadata-types';

/** Render context-aware completion from the canonical command model. */
export function renderCliCompletion(shell: EntityKitCliShell): string {
    if (shell === 'bash') {
        return renderBash();
    }
    if (shell === 'fish') {
        return renderFish();
    }
    return renderZsh();
}

function renderBash(): string {
    return [
        '_entitykit_complete() {',
        '  local current="${COMP_WORDS[COMP_CWORD]}"',
        '  local previous="${COMP_WORDS[COMP_CWORD-1]}"',
        '  local root="${COMP_WORDS[1]}"',
        '  local leaf="${COMP_WORDS[2]}"',
        '  local candidates=""',
        '  case "$previous" in',
        ...bashValueCases(),
        '  esac',
        '  if [[ "$COMP_CWORD" -eq 1 ]]; then',
        `    candidates="${rootCompletionWords().join(' ')}"`,
        '  elif [[ "$COMP_CWORD" -eq 2 && "$root" == "migration" ]]; then',
        `    candidates="${groupCompletionWords('migration').join(' ')}"`,
        '  elif [[ "$COMP_CWORD" -eq 2 && "$root" == "db" ]]; then',
        `    candidates="${groupCompletionWords('db').join(' ')}"`,
        '  else',
        '    local command_path="$root"',
        '    if [[ "$root" == "migration" || "$root" == "db" ]]; then command_path="$root $leaf"; fi',
        '    case "$command_path" in',
        ...entityKitCliMetadata.commands.map(command =>
            `      "${command.name}") candidates="${commandCompletionWords(command).join(' ')}" ;;`),
        '    esac',
        '  fi',
        '  COMPREPLY=( $(compgen -W "$candidates" -- "$current") )',
        '}',
        'complete -F _entitykit_complete entitykit',
    ].join('\n');
}

function bashValueCases(): string[] {
    const cases = fixedValueEntries().map(([option, values]) =>
        `    ${option}) COMPREPLY=( $(compgen -W "${values.join(' ')}" -- "$current") ); return ;;`);
    return [
        ...cases,
        '    completion) COMPREPLY=( $(compgen -W "bash fish zsh" -- "$current") ); return ;;',
        '    --config|--cwd|--output|-o) COMPREPLY=( $(compgen -f -- "$current") ); return ;;',
        `    ${freeValueSpellings().join('|')}) return ;;`,
    ];
}

function renderFish(): string {
    return [
        'complete -c entitykit -f',
        `complete -c entitykit -n '__fish_use_subcommand' -a '${rootCommands().join(' ')}'`,
        ...['migration', 'db'].map(group =>
            `complete -c entitykit -n '${fishGroupCondition(group)}' -a '${groupCompletionWords(group).join(' ')}'`),
        'complete -c entitykit -n \'__fish_seen_subcommand_from completion\' -a \'bash fish zsh\'',
        ...globalOptions().map(option => fishOption(option)),
        ...entityKitCliMetadata.commands.flatMap(command =>
            command.options.map(option => fishOption(option, fishCommandCondition(command.name)))),
    ].join('\n');
}

function renderZsh(): string {
    return [
        '#compdef entitykit',
        '_entitykit() {',
        '  local previous="${words[CURRENT-1]}"',
        '  local root="${words[2]}"',
        '  local leaf="${words[3]}"',
        '  local -a candidates',
        '  case "$previous" in',
        ...fixedValueEntries().map(([option, values]) =>
            `    ${option}) compadd -- ${values.join(' ')}; return ;;`),
        '    completion) compadd -- bash fish zsh; return ;;',
        '    --config|--cwd|--output|-o) _files; return ;;',
        `    ${freeValueSpellings().join('|')}) return ;;`,
        '  esac',
        '  if (( CURRENT == 2 )); then',
        `    candidates=(${rootCompletionWords().join(' ')})`,
        '  elif (( CURRENT == 3 )) && [[ "$root" == "migration" ]]; then',
        `    candidates=(${groupCompletionWords('migration').join(' ')})`,
        '  elif (( CURRENT == 3 )) && [[ "$root" == "db" ]]; then',
        `    candidates=(${groupCompletionWords('db').join(' ')})`,
        '  else',
        '    local command_path="$root"',
        '    if [[ "$root" == "migration" || "$root" == "db" ]]; then command_path="$root $leaf"; fi',
        '    case "$command_path" in',
        ...entityKitCliMetadata.commands.map(command =>
            `      "${command.name}") candidates=(${commandCompletionWords(command).join(' ')}) ;;`),
        '    esac',
        '  fi',
        '  compadd -- $candidates',
        '}',
        '_entitykit "$@"',
    ].join('\n');
}

function fishOption(option: EntityKitCliOptionDefinition, condition?: string): string {
    const fixed = fixedCompletionValues(option.name);
    const parts = [
        'complete -c entitykit',
        ...condition ? [`-n '${condition}'`] : [],
        `-l ${option.name.slice(2)}`,
        ...option.shortName ? [`-s ${option.shortName.slice(1)}`] : [],
        ...option.kind === 'flag' ? [] : ['-r'],
        ...fixed ? [`-a '${fixed.join(' ')}'`] : [],
        `-d '${option.description.replace(/'/g, '\\\'')}'`,
    ];
    return parts.join(' ');
}

function fishGroupCondition(group: string): string {
    return `__fish_seen_subcommand_from ${group}; and not __fish_seen_subcommand_from ${groupCompletionWords(group).join(' ')}`;
}

function fishCommandCondition(name: string): string {
    return name.split(' ').map(part => `__fish_seen_subcommand_from ${part}`).join('; and ');
}
