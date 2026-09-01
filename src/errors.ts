import type { Span } from "./ast";

export type ErrorCode =
  | "LEX_ERROR"
  | "PARSE_ERROR"
  | "UNKNOWN_OPERATOR"
  | "ARITY_ERROR"
  | "UNKNOWN_OPTION"
  | "DUPLICATE_OPTION"
  | "TYPE_MISMATCH"
  | "INVALID_TEMPORAL_VALUE"
  | "INVALID_TEMPORAL_OPERATION"
  | "RESOURCE_LIMIT"
  | "INTERNAL_ERROR";

export class TimecalcError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly span?: Span,
  ) {
    super(message);
    this.name = "TimecalcError";
  }
}

export interface SerializedError {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    span?: Span;
    line?: number;
    column?: number;
  };
}

export function serializeError(error: unknown, source?: string): SerializedError {
  const known = error instanceof TimecalcError;
  const code: ErrorCode = known ? error.code : "INTERNAL_ERROR";
  const message = known ? error.message : "An unexpected internal error occurred";
  const span = known ? error.span : undefined;
  const position = span && source !== undefined ? lineAndColumn(source, span.start) : undefined;

  return {
    ok: false,
    error: {
      code,
      message,
      ...(span ? { span } : {}),
      ...(position ? position : {}),
    },
  };
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
