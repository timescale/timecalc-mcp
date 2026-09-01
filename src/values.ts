export type ValueType =
  | "date"
  | "instant"
  | "zoned-date-time"
  | "duration"
  | "string"
  | "number"
  | "boolean";

export interface RuntimeValue {
  type: ValueType;
  value: any;
}

export function valueType(value: RuntimeValue): string {
  return value.type;
}
