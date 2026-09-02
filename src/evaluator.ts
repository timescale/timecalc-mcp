import type { CallExpression, Expression, Span } from "./ast";
import { TimecalcError } from "./errors";
import { OPERATORS, type OperatorName } from "./operators/catalog";
import type { RuntimeValue, ValueType } from "./values";

const TemporalAPI = (globalThis as typeof globalThis & { Temporal?: any }).Temporal;

export interface EvaluationContext {
  now?: any;
  defaultTimeZone?: string;
  defaultCalendar?: string;
}

export function evaluate(expression: Expression, context: EvaluationContext = {}): RuntimeValue {
  if (!TemporalAPI) {
    throw new TimecalcError("INTERNAL_ERROR", "This runtime does not provide Temporal");
  }
  return evaluateExpression(expression, context);
}

function evaluateExpression(expression: Expression, context: EvaluationContext): RuntimeValue {
  switch (expression.kind) {
    case "string":
    case "number":
    case "boolean":
      return { type: expression.kind, value: expression.value };
    case "temporal-literal":
      try {
        switch (expression.temporalType) {
          case "date":
            return { type: "date", value: TemporalAPI.PlainDate.from(expression.raw) };
          case "instant":
            return { type: "instant", value: TemporalAPI.Instant.from(expression.raw) };
          case "zoned-date-time":
            return { type: "zoned-date-time", value: TemporalAPI.ZonedDateTime.from(expression.raw) };
          case "duration":
            return { type: "duration", value: TemporalAPI.Duration.from(expression.raw) };
        }
      } catch (error) {
        throw new TimecalcError(
          "INVALID_TEMPORAL_VALUE",
          temporalMessage(`Invalid ${expression.temporalType} literal`, error),
          expression.span,
        );
      }
    case "call":
      return evaluateCall(expression, context);
  }
}

function evaluateCall(call: CallExpression, context: EvaluationContext): RuntimeValue {
  if (!(OPERATORS as readonly string[]).includes(call.operator)) {
    throw new TimecalcError(
      "UNKNOWN_OPERATOR",
      `Unknown operator '${call.operator}'`,
      call.operatorSpan,
    );
  }

  const args = call.positional.map((argument) => evaluateExpression(argument, context));
  const options = new Map<string, RuntimeValue>();
  for (const [name, expression] of call.keywords) {
    options.set(name, evaluateExpression(expression, context));
  }

  try {
    return invoke(call.operator as OperatorName, args, options, call.span, context);
  } catch (error) {
    if (error instanceof TimecalcError) throw error;
    throw new TimecalcError(
      "INVALID_TEMPORAL_OPERATION",
      temporalMessage(`Invalid ${call.operator} operation`, error),
      call.span,
    );
  }
}

function invoke(
  operator: OperatorName,
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
  context: EvaluationContext,
): RuntimeValue {
  switch (operator) {
    case "add":
      return add(args, options, span);
    case "subtract":
      return subtract(args, options, span);
    case "compare":
      return compare(args, options, span);
    case "equals":
      return equals(args, options, span);
    case "round":
      return round(args, options, span);
    case "now":
      return contextNow(args, options, span, context);
    case "default-time-zone":
      return defaultTimeZone(args, options, span, context);
    case "with-time-zone":
      return withTimeZone(args, options, span);
    case "to-instant":
      return toInstant(args, options, span);
    case "to-date":
      return toDate(args, options, span);
    default:
      return inspect(operator, args, options, span);
  }
}

function add(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("add", args, 2, span);
  const receiver = expectOneOf("add", args[0], ["date", "instant", "zoned-date-time"], 1, span);
  const duration = expectType("add", args[1], "duration", 2, span);
  const allowed = receiver.type === "instant" ? [] : ["overflow"];
  const temporalOptions = temporalOptionsFor("add", options, allowed, span);
  return applyDuration("add", receiver, duration, temporalOptions, span);
}

function subtract(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("subtract", args, 2, span);
  const left = expectOneOf(
    "subtract",
    args[0],
    ["date", "instant", "zoned-date-time"],
    1,
    span,
  );
  const right = args[1];

  if (right.type === "duration") {
    const allowed = left.type === "instant" ? [] : ["overflow"];
    const temporalOptions = temporalOptionsFor("subtract", options, allowed, span);
    return applyDuration("subtract", left, right, temporalOptions, span);
  }

  if (right.type !== left.type) {
    throw new TimecalcError(
      "TYPE_MISMATCH",
      `subtract expected duration or ${left.type} as argument 2, received ${right.type}`,
      span,
    );
  }

  const temporalOptions = temporalOptionsFor(
    "subtract",
    options,
    ["largest-unit", "smallest-unit", "rounding-increment", "rounding-mode"],
    span,
  );
  return { type: "duration", value: left.value.since(right.value, temporalOptions) };
}

type Arithmetic = "add" | "subtract";
type TemporalReceiver = RuntimeValue & { type: "date" | "instant" | "zoned-date-time" };

/**
 * Apply an `add`/`subtract` duration operation. Bun's Temporal reports both a
 * nonexistent-day rejection (e.g. Jan 31 + P1M with :overflow "reject") and a
 * genuinely out-of-representable-range result with the same opaque message. When
 * the failure disappears under :overflow "constrain", it was purely an overflow
 * rejection, so surface a message that names the actual cause. Genuine range
 * errors propagate unchanged and are wrapped by evaluateCall.
 */
function applyDuration(
  operator: Arithmetic,
  receiver: TemporalReceiver,
  duration: RuntimeValue,
  temporalOptions: Record<string, unknown>,
  span: Span,
): RuntimeValue {
  try {
    return { type: receiver.type, value: receiver.value[operator](duration.value, temporalOptions) };
  } catch (error) {
    if (temporalOptions.overflow === "reject" && constrainSucceeds(operator, receiver, duration, temporalOptions)) {
      throw new TimecalcError(
        "INVALID_TEMPORAL_OPERATION",
        `${operator} with :overflow "reject" landed on a date that does not exist in the target month; use :overflow "constrain" to clamp it`,
        span,
      );
    }
    throw error;
  }
}

function constrainSucceeds(
  operator: Arithmetic,
  receiver: TemporalReceiver,
  duration: RuntimeValue,
  temporalOptions: Record<string, unknown>,
): boolean {
  try {
    receiver.value[operator](duration.value, { ...temporalOptions, overflow: "constrain" });
    return true;
  } catch {
    return false;
  }
}

function compare(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("compare", args, 2, span);
  const left = expectOneOf(
    "compare",
    args[0],
    ["date", "instant", "zoned-date-time", "duration"],
    1,
    span,
  );
  expectType("compare", args[1], left.type, 2, span);

  let result: number;
  if (left.type === "duration") {
    const temporalOptions = temporalOptionsFor("compare", options, ["relative-to"], span);
    result = TemporalAPI.Duration.compare(left.value, args[1].value, temporalOptions);
  } else {
    rejectOptions("compare", options, span);
    const temporalClass = {
      date: TemporalAPI.PlainDate,
      instant: TemporalAPI.Instant,
      "zoned-date-time": TemporalAPI.ZonedDateTime,
    }[left.type];
    result = temporalClass.compare(left.value, args[1].value);
  }
  return { type: "number", value: result };
}

function equals(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("equals", args, 2, span);
  rejectOptions("equals", options, span);
  const left = expectOneOf(
    "equals",
    args[0],
    ["date", "instant", "zoned-date-time", "duration"],
    1,
    span,
  );
  expectType("equals", args[1], left.type, 2, span);
  if (left.type === "duration") {
    const fields = [
      "years",
      "months",
      "weeks",
      "days",
      "hours",
      "minutes",
      "seconds",
      "milliseconds",
      "microseconds",
      "nanoseconds",
    ];
    return {
      type: "boolean",
      value: fields.every((field) => left.value[field] === args[1].value[field]),
    };
  }
  return { type: "boolean", value: left.value.equals(args[1].value) };
}

function round(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("round", args, 1, span);
  const value = expectOneOf("round", args[0], ["instant", "zoned-date-time", "duration"], 1, span);
  const allowed = ["smallest-unit", "rounding-increment", "rounding-mode"];
  if (value.type === "duration") allowed.push("largest-unit", "relative-to");
  const temporalOptions = temporalOptionsFor("round", options, allowed, span);
  return { type: value.type, value: value.value.round(temporalOptions) };
}

function contextNow(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
  context: EvaluationContext,
): RuntimeValue {
  exactArity("now", args, 0, span);
  rejectOptions("now", options, span);
  if (context.now === undefined) {
    throw new TimecalcError(
      "MISSING_CONTEXT",
      "now requires an explicit clock or system-context mode",
      span,
    );
  }
  return { type: "instant", value: context.now };
}

function defaultTimeZone(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
  context: EvaluationContext,
): RuntimeValue {
  exactArity("default-time-zone", args, 0, span);
  rejectOptions("default-time-zone", options, span);
  if (context.defaultTimeZone === undefined) {
    throw new TimecalcError(
      "MISSING_CONTEXT",
      "default-time-zone requires an explicit time zone or system-context mode",
      span,
    );
  }
  return { type: "string", value: context.defaultTimeZone };
}

function withTimeZone(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("with-time-zone", args, 2, span);
  rejectOptions("with-time-zone", options, span);
  const value = expectOneOf("with-time-zone", args[0], ["instant", "zoned-date-time"], 1, span);
  const zone = expectType("with-time-zone", args[1], "string", 2, span);
  const result = value.type === "instant"
    ? value.value.toZonedDateTimeISO(zone.value)
    : value.value.withTimeZone(zone.value);
  return { type: "zoned-date-time", value: result };
}

function toInstant(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("to-instant", args, 1, span);
  rejectOptions("to-instant", options, span);
  const value = expectType("to-instant", args[0], "zoned-date-time", 1, span);
  return { type: "instant", value: value.value.toInstant() };
}

function toDate(
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity("to-date", args, 1, span);
  rejectOptions("to-date", options, span);
  const value = expectType("to-date", args[0], "zoned-date-time", 1, span);
  return { type: "date", value: value.value.toPlainDate() };
}

const INSPECTION: Readonly<Record<string, { property: string; types: readonly ValueType[]; result: ValueType }>> = {
  year: { property: "year", types: ["date", "zoned-date-time"], result: "number" },
  month: { property: "month", types: ["date", "zoned-date-time"], result: "number" },
  day: { property: "day", types: ["date", "zoned-date-time"], result: "number" },
  hour: { property: "hour", types: ["zoned-date-time"], result: "number" },
  minute: { property: "minute", types: ["zoned-date-time"], result: "number" },
  second: { property: "second", types: ["zoned-date-time"], result: "number" },
  "day-of-week": { property: "dayOfWeek", types: ["date", "zoned-date-time"], result: "number" },
  "day-of-year": { property: "dayOfYear", types: ["date", "zoned-date-time"], result: "number" },
  "week-of-year": { property: "weekOfYear", types: ["date", "zoned-date-time"], result: "number" },
  "days-in-month": { property: "daysInMonth", types: ["date", "zoned-date-time"], result: "number" },
  "days-in-year": { property: "daysInYear", types: ["date", "zoned-date-time"], result: "number" },
  "months-in-year": { property: "monthsInYear", types: ["date", "zoned-date-time"], result: "number" },
  offset: { property: "offset", types: ["zoned-date-time"], result: "string" },
  "time-zone-id": { property: "timeZoneId", types: ["zoned-date-time"], result: "string" },
  "calendar-id": { property: "calendarId", types: ["date", "zoned-date-time"], result: "string" },
};

function inspect(
  operator: OperatorName,
  args: RuntimeValue[],
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): RuntimeValue {
  exactArity(operator, args, 1, span);
  rejectOptions(operator, options, span);
  const definition = INSPECTION[operator];
  if (!definition) {
    throw new TimecalcError("INTERNAL_ERROR", `Operator '${operator}' is not implemented`, span);
  }
  const value = expectOneOf(operator, args[0], definition.types, 1, span);
  const property = value.value[definition.property];
  if (property === undefined) {
    throw new TimecalcError(
      "INVALID_TEMPORAL_OPERATION",
      `${operator} is unavailable for this calendar`,
      span,
    );
  }
  return { type: definition.result, value: property };
}

function temporalOptionsFor(
  operator: string,
  options: ReadonlyMap<string, RuntimeValue>,
  allowed: readonly string[],
  span: Span,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [name, value] of options) {
    if (!allowed.includes(name)) {
      throw new TimecalcError("UNKNOWN_OPTION", `${operator} does not support :${name}`, span);
    }
    switch (name) {
      case "rounding-increment":
        if (value.type !== "number" || !Number.isInteger(value.value) || value.value <= 0) {
          throw new TimecalcError(
            "TYPE_MISMATCH",
            ":rounding-increment must be a positive integer",
            span,
          );
        }
        output.roundingIncrement = value.value;
        break;
      case "relative-to":
        if (value.type !== "date" && value.type !== "zoned-date-time") {
          throw new TimecalcError(
            "TYPE_MISMATCH",
            ":relative-to must be a date or zoned-date-time",
            span,
          );
        }
        output.relativeTo = value.value;
        break;
      default:
        if (value.type !== "string") {
          throw new TimecalcError("TYPE_MISMATCH", `:${name} must be a string`, span);
        }
        output[toCamelCase(name)] = value.value;
    }
  }
  return output;
}

function rejectOptions(
  operator: string,
  options: ReadonlyMap<string, RuntimeValue>,
  span: Span,
): void {
  const first = options.keys().next().value;
  if (first !== undefined) {
    throw new TimecalcError("UNKNOWN_OPTION", `${operator} does not support :${first}`, span);
  }
}

function exactArity(operator: string, args: RuntimeValue[], expected: number, span: Span): void {
  if (args.length !== expected) {
    throw new TimecalcError(
      "ARITY_ERROR",
      `${operator} expects ${expected} argument${expected === 1 ? "" : "s"}, received ${args.length}`,
      span,
    );
  }
}

function expectType<T extends ValueType>(
  operator: string,
  value: RuntimeValue,
  expected: T,
  position: number,
  span: Span,
): RuntimeValue & { type: T } {
  if (value.type !== expected) {
    throw new TimecalcError(
      "TYPE_MISMATCH",
      `${operator} expected ${expected} as argument ${position}, received ${value.type}`,
      span,
    );
  }
  return value as RuntimeValue & { type: T };
}

function expectOneOf<T extends ValueType>(
  operator: string,
  value: RuntimeValue,
  expected: readonly T[],
  position: number,
  span: Span,
): RuntimeValue & { type: T } {
  if (!expected.includes(value.type as T)) {
    throw new TimecalcError(
      "TYPE_MISMATCH",
      `${operator} expected ${formatTypes(expected)} as argument ${position}, received ${value.type}`,
      span,
    );
  }
  return value as RuntimeValue & { type: T };
}

function formatTypes(types: readonly string[]): string {
  if (types.length === 1) return types[0];
  return `${types.slice(0, -1).join(", ")}, or ${types.at(-1)}`;
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function temporalMessage(prefix: string, error: unknown): string {
  if (error instanceof Error && error.message) return `${prefix}: ${error.message}`;
  return prefix;
}
