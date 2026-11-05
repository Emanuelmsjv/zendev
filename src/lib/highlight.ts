export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'ident'
  | 'punct'

export interface Token {
  text: string
  kind: TokenKind
}

const KEYWORDS = new Set([
  'await',
  'async',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'of',
  'return',
  'switch',
  'throw',
  'try',
  'type',
  'typeof',
  'var',
  'while',
  'yield',
])

const PATTERN = new RegExp(
  [
    '(\\/\\/[^\\n]*)',
    '(\\/\\*[\\s\\S]*?\\*\\/)',
    "('(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)",
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '([A-Za-z_$][A-Za-z0-9_$]*)',
    '([{}()\\[\\];,.<>=+\\-*/%!&|?:]+)',
    '([ \\t]+)',
  ].join('|'),
  'g',
)

export function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < code.length) {
    PATTERN.lastIndex = index
    const match = PATTERN.exec(code)
    if (!match || match.index !== index) {
      tokens.push({ text: code[index], kind: 'plain' })
      index += 1
      continue
    }

    const [text, lineComment, blockComment, string, number, ident, punct, space] = match
    if (lineComment || blockComment) tokens.push({ text, kind: 'comment' })
    else if (string) tokens.push({ text, kind: 'string' })
    else if (number) tokens.push({ text, kind: 'number' })
    else if (ident) tokens.push({ text, kind: KEYWORDS.has(ident) ? 'keyword' : 'ident' })
    else if (punct) tokens.push({ text, kind: 'punct' })
    else if (space) tokens.push({ text, kind: 'plain' })
    else tokens.push({ text, kind: 'plain' })

    index += text.length
  }

  return tokens
}

export function tokenizeLines(code: string): Token[][] {
  const lines: Token[][] = [[]]
  for (const token of tokenize(code)) {
    const pieces = token.text.split('\n')
    pieces.forEach((piece, i) => {
      if (i > 0) lines.push([])
      if (piece.length > 0) {
        lines[lines.length - 1].push({ text: piece, kind: token.kind })
      }
    })
  }
  return lines
}
