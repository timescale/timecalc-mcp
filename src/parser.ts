import type {
  BooleanLiteral,
  CallExpression,
  Expression,
  NumberLiteral,
  Span,
  StringLiteral,
  TemporalLiteral,
  TemporalLiteralType,
} from "./ast";
import { TimecalcError } from "./errors";

export interface ParserLimits {
  maxSourceLength: number;
  maxDepth: number;
  maxNodes: number;
  maxStringLength: number;
}

const DEFAULT_LIMITS: ParserLimits = {
  maxSourceLength: 64 * 1024,
  maxDepth: 100,
  maxNodes: 10_000,
  maxStringLength: 32 * 1024,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})\[[A-Za-z0-9._+:\/-]+\]$/;
const DURATION = /^[+-]?P[0-9YMWDTHS.]+$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const NAME = /^[A-Za-z][A-Za-z0-9_-]*/;

export function parse(source: string, limits: Partial<ParserLimits> = {}): Expression {
  return new Parser(source, { ...DEFAULT_LIMITS, ...limits }).parse();
}

class Parser {
  private index = 0;
  private depth = 0;
  private nodes = 0;

  constructor(
    private readonly source: string,
    private readonly limits: ParserLimits,
  ) {}

  parse(): Expression {
    if (this.source.length > this.limits.maxSourceLength) {
      throw new TimecalcError(
        "RESOURCE_LIMIT",
        `Source exceeds the ${this.limits.maxSourceLength}-character limit`,
        { start: 0, end: this.source.length },
      );
    }

    this.skipSpacing();
    if (this.eof()) this.fail("PARSE_ERROR", "Expected an expression");
    const expression = this.parseExpression();
    this.skipSpacing();
    if (!this.eof()) this.fail("PARSE_ERROR", "Unexpected trailing input");
    return expression;
  }

  private parseExpression(): Expression {
    this.countNode();
    if (this.peek() === "(") return this.parseCall();
    if (this.peek() === '"') return this.parseString();
    return this.parseBareLiteral();
  }

  private parseCall(): CallExpression {
    const start = this.index++;
    this.depth++;
    if (this.depth > this.limits.maxDepth) {
      this.fail("RESOURCE_LIMIT", `Expression nesting exceeds ${this.limits.maxDepth}`, start);
    }

    this.skipSpacing();
    const operatorStart = this.index;
    const operator = this.readName();
    if (!operator) this.fail("PARSE_ERROR", "Expected an operator name", operatorStart);
    const operatorSpan = { start: operatorStart, end: this.index };
    const positional: Expression[] = [];
    const keywords = new Map<string, Expression>();
    let sawKeyword = false;

    while (true) {
      const hadSeparator = this.skipSpacing();
      if (this.peek() === ")") {
        this.index++;
        this.depth--;
        return {
          kind: "call",
          operator,
          operatorSpan,
          positional,
          keywords,
          span: { start, end: this.index },
        };
      }
      if (this.eof()) this.fail("PARSE_ERROR", "Unclosed call; expected ')'", start);
      if (!hadSeparator) this.fail("PARSE_ERROR", "Expected whitespace between arguments");

      if (this.peek() === ":") {
        sawKeyword = true;
        const keywordStart = this.index++;
        const keyword = this.readName();
        if (!keyword) this.fail("PARSE_ERROR", "Expected a keyword name after ':'", keywordStart);
        if (keywords.has(keyword)) {
          throw new TimecalcError(
            "DUPLICATE_OPTION",
            `Duplicate option :${keyword}`,
            { start: keywordStart, end: this.index },
          );
        }
        if (!this.skipSpacing()) {
          this.fail("PARSE_ERROR", `Expected a value for :${keyword}`, keywordStart);
        }
        keywords.set(keyword, this.parseExpression());
      } else {
        if (sawKeyword) {
          this.fail("PARSE_ERROR", "Positional arguments must precede keyword arguments");
        }
        positional.push(this.parseExpression());
      }
    }
  }

  private parseString(): StringLiteral {
    const start = this.index++;
    let value = "";

    while (!this.eof()) {
      const char = this.source[this.index++];
      if (char === '"') {
        return this.node({ kind: "string", value, span: { start, end: this.index } });
      }
      if (char.charCodeAt(0) < 0x20) {
        this.fail("LEX_ERROR", "Unescaped control character in string", this.index - 1);
      }
      if (char !== "\\") {
        value += char;
      } else {
        value += this.parseEscape();
      }
      if (value.length > this.limits.maxStringLength) {
        this.fail(
          "RESOURCE_LIMIT",
          `String exceeds the ${this.limits.maxStringLength}-character limit`,
          start,
        );
      }
    }

    this.fail("PARSE_ERROR", "Unterminated string", start);
  }

  private parseEscape(): string {
    if (this.eof()) this.fail("LEX_ERROR", "Unterminated string escape");
    const escape = this.source[this.index++];
    const simple: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escape in simple) return simple[escape];
    if (escape !== "u") this.fail("LEX_ERROR", `Unknown string escape \\${escape}`, this.index - 2);

    const digits = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(digits)) {
      this.fail("LEX_ERROR", "Unicode escape must contain four hexadecimal digits", this.index - 2);
    }
    this.index += 4;
    return String.fromCharCode(Number.parseInt(digits, 16));
  }

  private parseBareLiteral(): TemporalLiteral | NumberLiteral | BooleanLiteral {
    const start = this.index;
    while (!this.eof() && !isDelimiter(this.peek())) this.index++;
    if (start === this.index) this.fail("PARSE_ERROR", `Unexpected '${this.peek()}'`);
    const raw = this.source.slice(start, this.index);
    const span = { start, end: this.index };

    const temporalType = classifyTemporal(raw);
    if (temporalType) {
      return this.node({ kind: "temporal-literal", temporalType, raw, span });
    }
    if (raw === "true" || raw === "false") {
      return this.node({ kind: "boolean", value: raw === "true", span });
    }
    if (NUMBER.test(raw)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new TimecalcError("LEX_ERROR", "Number must be finite", span);
      }
      return this.node({ kind: "number", value, span });
    }

    throw new TimecalcError("LEX_ERROR", `Unrecognized literal '${raw}'`, span);
  }

  private readName(): string | undefined {
    const match = NAME.exec(this.source.slice(this.index));
    if (!match) return undefined;
    this.index += match[0].length;
    return match[0];
  }

  private skipSpacing(): boolean {
    const start = this.index;
    while (!this.eof()) {
      if (isWhiteSpace(this.peek())) {
        this.index++;
      } else if (this.peek() === ";") {
        while (!this.eof() && this.peek() !== "\n" && this.peek() !== "\r") this.index++;
      } else {
        break;
      }
    }
    return this.index > start;
  }

  private countNode(): void {
    this.nodes++;
    if (this.nodes > this.limits.maxNodes) {
      this.fail("RESOURCE_LIMIT", `AST exceeds ${this.limits.maxNodes} nodes`);
    }
  }

  private node<T extends Expression>(node: T): T {
    return node;
  }

  private peek(): string {
    return this.source[this.index] ?? "";
  }

  private eof(): boolean {
    return this.index >= this.source.length;
  }

  private fail(code: "LEX_ERROR" | "PARSE_ERROR" | "RESOURCE_LIMIT", message: string, start = this.index): never {
    throw new TimecalcError(code, message, { start, end: Math.min(start + 1, this.source.length) });
  }
}

function classifyTemporal(raw: string): TemporalLiteralType | undefined {
  if (ZONED_DATE_TIME.test(raw)) return "zoned-date-time";
  if (INSTANT.test(raw)) return "instant";
  if (DATE.test(raw)) return "date";
  if (DURATION.test(raw)) return "duration";
  return undefined;
}

function isDelimiter(char: string): boolean {
  return char === "" || isWhiteSpace(char) || char === "(" || char === ")" || char === ";";
}

function isWhiteSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}
