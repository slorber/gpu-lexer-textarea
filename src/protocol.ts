import type { parse } from 'gpu-lexer';

export type SyntaxSpan = Awaited<ReturnType<typeof parse>>[number];
export const syntaxTypes = ['comment', 'string', 'number', 'keyword', 'type', 'function', 'constant', 'operator'] as const;
export type ColoredSyntax = (typeof syntaxTypes)[number];

export interface ParseRequest { id: number; code: string }
export type ParseResponse =
  | { id: number; spans: SyntaxSpan[] }
  | { id: number; error: string };
