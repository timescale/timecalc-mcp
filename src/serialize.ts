import type { RuntimeValue } from "./values";

export interface SerializedEvaluationContext {
  now?: string;
  defaultTimeZone?: string;
  defaultCalendar?: string;
}

export interface SerializedResult {
  ok: true;
  type: RuntimeValue["type"];
  value: string | number | boolean;
  calendar?: string;
  timeZone?: string;
  offset?: string;
  context?: SerializedEvaluationContext;
}

export function serializeResult(
  result: RuntimeValue,
  context?: SerializedEvaluationContext,
): SerializedResult {
  const contextField = context && Object.keys(context).length > 0 ? { context } : {};
  if (result.type === "string" || result.type === "number" || result.type === "boolean") {
    return { ok: true, type: result.type, value: result.value, ...contextField };
  }

  const value = result.value.toString();
  if (result.type === "date") {
    return {
      ok: true,
      type: result.type,
      value,
      calendar: result.value.calendarId,
      ...contextField,
    };
  }
  if (result.type === "zoned-date-time") {
    return {
      ok: true,
      type: result.type,
      value,
      calendar: result.value.calendarId,
      timeZone: result.value.timeZoneId,
      offset: result.value.offset,
      ...contextField,
    };
  }
  return { ok: true, type: result.type, value, ...contextField };
}

export function humanResult(result: RuntimeValue): string {
  if (result.type === "string") return result.value;
  if (result.type === "number" || result.type === "boolean") return String(result.value);
  return result.value.toString();
}
