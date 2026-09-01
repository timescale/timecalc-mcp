import type { RuntimeValue } from "./values";

export interface SerializedResult {
  ok: true;
  type: RuntimeValue["type"];
  value: string | number | boolean;
  calendar?: string;
  timeZone?: string;
  offset?: string;
}

export function serializeResult(result: RuntimeValue): SerializedResult {
  if (result.type === "string" || result.type === "number" || result.type === "boolean") {
    return { ok: true, type: result.type, value: result.value };
  }

  const value = result.value.toString();
  if (result.type === "date") {
    return {
      ok: true,
      type: result.type,
      value,
      calendar: result.value.calendarId,
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
    };
  }
  return { ok: true, type: result.type, value };
}

export function humanResult(result: RuntimeValue): string {
  if (result.type === "string") return result.value;
  if (result.type === "number" || result.type === "boolean") return String(result.value);
  return result.value.toString();
}
