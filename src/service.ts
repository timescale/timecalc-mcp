import { evaluate, type EvaluationContext } from "./evaluator";
import { serializeError, TimecalcError, type SerializedError } from "./errors";
import { parse } from "./parser";
import { humanResult, serializeResult, type SerializedResult } from "./serialize";

const TemporalAPI = (globalThis as typeof globalThis & { Temporal?: any }).Temporal;

export interface EvaluationRequest {
  expression: string;
  now?: string;
  defaultTimeZone?: string;
  defaultCalendar?: string;
}

export interface EvaluationSuccess {
  ok: true;
  text: string;
  response: SerializedResult;
}

export interface EvaluationFailure {
  ok: false;
  text: string;
  response: SerializedError;
}

export type EvaluationOutcome = EvaluationSuccess | EvaluationFailure;

export function evaluateRequest(request: EvaluationRequest): EvaluationOutcome {
  try {
    const context = createEvaluationContext(request);
    const result = evaluate(parse(request.expression), context);
    return {
      ok: true,
      text: humanResult(result),
      response: serializeResult(result),
    };
  } catch (error) {
    const response = serializeError(error, request.expression);
    return {
      ok: false,
      text: formatSerializedError(response),
      response,
    };
  }
}

export function createEvaluationContext(
  request: Omit<EvaluationRequest, "expression">,
): EvaluationContext {
  if (!TemporalAPI) {
    throw new TimecalcError("INTERNAL_ERROR", "This runtime does not provide Temporal");
  }

  const context: EvaluationContext = {};
  if (request.now !== undefined) {
    try {
      context.now = TemporalAPI.Instant.from(request.now);
    } catch (error) {
      throw invalidContext("now", "instant", error);
    }
  }
  if (request.defaultTimeZone !== undefined) {
    try {
      TemporalAPI.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(request.defaultTimeZone);
      context.defaultTimeZone = request.defaultTimeZone;
    } catch (error) {
      throw invalidContext("defaultTimeZone", "time zone", error);
    }
  }
  if (request.defaultCalendar !== undefined) {
    try {
      TemporalAPI.PlainDate.from({
        year: 2000,
        month: 1,
        day: 1,
        calendar: request.defaultCalendar,
      });
      context.defaultCalendar = request.defaultCalendar;
    } catch (error) {
      throw invalidContext("defaultCalendar", "calendar", error);
    }
  }
  return context;
}

export function formatSerializedError(response: SerializedError): string {
  const error = response.error;
  const location = error.line !== undefined ? ` at ${error.line}:${error.column}` : "";
  return `${error.code}${location}: ${error.message}`;
}

function invalidContext(field: string, expected: string, error: unknown): TimecalcError {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
  return new TimecalcError(
    "INVALID_TEMPORAL_VALUE",
    `Invalid ${field} ${expected}${detail}`,
  );
}
