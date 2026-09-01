export interface Span {
  start: number;
  end: number;
}

export type TemporalLiteralType =
  | "date"
  | "instant"
  | "zoned-date-time"
  | "duration";

export interface CallExpression {
  kind: "call";
  operator: string;
  operatorSpan: Span;
  positional: Expression[];
  keywords: Map<string, Expression>;
  span: Span;
}

export interface TemporalLiteral {
  kind: "temporal-literal";
  temporalType: TemporalLiteralType;
  raw: string;
  span: Span;
}

export interface StringLiteral {
  kind: "string";
  value: string;
  span: Span;
}

export interface NumberLiteral {
  kind: "number";
  value: number;
  span: Span;
}

export interface BooleanLiteral {
  kind: "boolean";
  value: boolean;
  span: Span;
}

export type Expression =
  | CallExpression
  | TemporalLiteral
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral;
