export type OperatorCategory =
  | "arithmetic"
  | "comparison"
  | "rounding"
  | "conversion"
  | "inspection";

export interface OperatorMetadata {
  name: string;
  category: OperatorCategory;
  signature: string;
  description: string;
  options?: readonly string[];
}

/**
 * The complete v1 DSL operator catalog. Temporal values are self-describing
 * literals, so date, instant, zoned-date-time, and duration are not operators.
 */
export const OPERATOR_CATALOG = [
  {
    name: "add",
    category: "arithmetic",
    signature: "(add temporal duration [:overflow string])",
    description: "Add a duration to a date, instant, or zoned date-time.",
    options: ["overflow"],
  },
  {
    name: "subtract",
    category: "arithmetic",
    signature: "(subtract temporal duration-or-compatible-temporal [options])",
    description: "Subtract a duration from a Temporal value, or return the signed duration left minus right.",
    options: ["overflow", "largest-unit", "smallest-unit", "rounding-increment", "rounding-mode"],
  },
  {
    name: "compare",
    category: "comparison",
    signature: "(compare value value [:relative-to temporal])",
    description: "Return -1, 0, or 1 for two compatible Temporal values.",
    options: ["relative-to"],
  },
  {
    name: "equals",
    category: "comparison",
    signature: "(equals value value)",
    description: "Return whether two compatible Temporal values are equal.",
  },
  {
    name: "round",
    category: "rounding",
    signature: "(round value :smallest-unit string [rounding options])",
    description: "Round an instant, zoned date-time, or duration.",
    options: ["smallest-unit", "largest-unit", "rounding-increment", "rounding-mode", "relative-to"],
  },
  {
    name: "with-time-zone",
    category: "conversion",
    signature: "(with-time-zone instant-or-zoned-date-time time-zone-string)",
    description: "Represent an instant or zoned date-time in another time zone.",
  },
  {
    name: "to-instant",
    category: "conversion",
    signature: "(to-instant zoned-date-time)",
    description: "Convert a zoned date-time to an instant.",
  },
  { name: "year", category: "inspection", signature: "(year value)", description: "Return the year." },
  { name: "month", category: "inspection", signature: "(month value)", description: "Return the month." },
  { name: "day", category: "inspection", signature: "(day value)", description: "Return the day of the month." },
  { name: "hour", category: "inspection", signature: "(hour zoned-date-time)", description: "Return the local hour." },
  { name: "minute", category: "inspection", signature: "(minute zoned-date-time)", description: "Return the local minute." },
  { name: "second", category: "inspection", signature: "(second zoned-date-time)", description: "Return the local second." },
  { name: "day-of-week", category: "inspection", signature: "(day-of-week value)", description: "Return the ISO day of week." },
  { name: "day-of-year", category: "inspection", signature: "(day-of-year value)", description: "Return the day of year." },
  { name: "week-of-year", category: "inspection", signature: "(week-of-year value)", description: "Return the ISO week of year." },
  { name: "days-in-month", category: "inspection", signature: "(days-in-month value)", description: "Return the number of days in the month." },
  { name: "days-in-year", category: "inspection", signature: "(days-in-year value)", description: "Return the number of days in the year." },
  { name: "months-in-year", category: "inspection", signature: "(months-in-year value)", description: "Return the number of months in the year." },
  { name: "offset", category: "inspection", signature: "(offset zoned-date-time)", description: "Return the UTC offset string." },
  { name: "time-zone-id", category: "inspection", signature: "(time-zone-id zoned-date-time)", description: "Return the time-zone identifier." },
  { name: "calendar-id", category: "inspection", signature: "(calendar-id value)", description: "Return the calendar identifier." },
] as const satisfies readonly OperatorMetadata[];

export type OperatorName = (typeof OPERATOR_CATALOG)[number]["name"];
export const OPERATORS: readonly OperatorName[] = OPERATOR_CATALOG.map((operator) => operator.name);
