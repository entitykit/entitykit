export function sqliteDdlText(sql: string): { sql: string; code: string } {
    // Keep offsets aligned so matches in executable SQL can slice the original quoted values.
    const text = sql.split('');
    const code = sql.split('');
    for (let index = 0; index < sql.length; index++) {
        const character = sql[index];
        if ('\'"`['.includes(character)) {
            const quote = character === '[' ? ']' : character;
            let end = index + 1;
            while (end < sql.length) {
                if (sql[end] === quote) {
                    if (quote !== ']' && sql[end + 1] === quote) {
                        end += 2;
                        continue;
                    }
                    end++;
                    break;
                }
                end++;
            }
            code.fill(' ', index, end);
            index = end - 1;
        } else if (sql.startsWith('--', index) || sql.startsWith('/*', index)) {
            const line = sql.startsWith('--', index);
            const close = sql.indexOf(line ? '\n' : '*/', index + 2);
            const end = close < 0 ? sql.length : close + (line ? 0 : 2);
            text.fill(' ', index, end);
            code.fill(' ', index, end);
            index = end - 1;
        }
    }
    return { sql: text.join(''), code: code.join('') };
}

export function sqliteDdlMatches(sql: string, pattern: RegExp): RegExpExecArray[] {
    const text = sqliteDdlText(sql);
    return Array.from(text.sql.matchAll(pattern))
        .filter(match => text.code[match.index] !== ' ');
}
