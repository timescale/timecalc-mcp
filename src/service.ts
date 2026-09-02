import { evaluate, type EvaluationContext } from "./evaluator";
import { serializeError, TimecalcError, type SerializedError } from "./errors";
import { parse } from "./parser";
import {
  humanResult,
  serializeResult,
  type SerializedEvaluationContext,
  type SerializedResult,
} from "./serialize";

const TemporalAPI = (globalThis as typeof globalThis & { Temporal?: any }).Temporal;

export interface EvaluationRequest {
  expression: string;
  now?: string;
  defaultTimeZone?: string;
  defaultCalendar?: string;
}

export interface SystemContextProvider {
  instant(): unknown;
  timeZoneId(): string;
}

export interface EvaluationOptions {
  systemContext?: boolean;
  systemContextProvider?: SystemContextProvider;
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

export function evaluateRequest(
  request: EvaluationRequest,
  options: EvaluationOptions = {},
): EvaluationOutcome {
  try {
    const context = createEvaluationContext(request, options);
    const result = evaluate(parse(request.expression), context);
    return {
      ok: true,
      text: humanResult(result),
      response: serializeResult(result, serializeEvaluationContext(context)),
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
  options: EvaluationOptions = {},
): EvaluationContext {
  if (!TemporalAPI) {
    throw new TimecalcError("INTERNAL_ERROR", "This runtime does not provide Temporal");
  }

  const provider = options.systemContext
    ? options.systemContextProvider ?? nativeSystemContextProvider()
    : undefined;
  const now = request.now ?? provider?.instant();
  const defaultTimeZone = request.defaultTimeZone ?? provider?.timeZoneId();
  const defaultCalendar = request.defaultCalendar ?? (provider ? "iso8601" : undefined);

  const context: EvaluationContext = {};
  if (now !== undefined) {
    try {
      context.now = TemporalAPI.Instant.from(now);
    } catch (error) {
      throw invalidContext("now", "instant", error);
    }
  }
  if (defaultTimeZone !== undefined) {
    try {
      TemporalAPI.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(defaultTimeZone);
      context.defaultTimeZone = defaultTimeZone;
    } catch (error) {
      throw invalidContext("defaultTimeZone", "time zone", error);
    }
  }
  if (defaultCalendar !== undefined) {
    try {
      TemporalAPI.PlainDate.from({
        year: 2000,
        month: 1,
        day: 1,
        calendar: defaultCalendar,
      });
      context.defaultCalendar = defaultCalendar;
    } catch (error) {
      throw invalidContext("defaultCalendar", "calendar", error);
    }
  }
  return context;
}

function nativeSystemContextProvider(): SystemContextProvider {
  return {
    instant: () => TemporalAPI.Now.instant(),
    timeZoneId: () => TemporalAPI.Now.timeZoneId(),
  };
}

function serializeEvaluationContext(context: EvaluationContext): SerializedEvaluationContext {
  return {
    ...(context.now !== undefined ? { now: context.now.toString() } : {}),
    ...(context.defaultTimeZone !== undefined
      ? { defaultTimeZone: context.defaultTimeZone }
      : {}),
    ...(context.defaultCalendar !== undefined
      ? { defaultCalendar: context.defaultCalendar }
      : {}),
  };
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
