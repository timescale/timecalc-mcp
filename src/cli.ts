#!/usr/bin/env bun

import { evaluateRequest, formatSerializedError } from "./service";

const VERSION = "0.0.0";

type Command = "eval" | "validate" | "grammar" | "mcp";

interface CliOptions {
  command: Command;
  expression?: string;
  stdin: boolean;
  json: boolean;
  pretty: boolean;
  output?: string;
  now?: string;
  timeZone?: string;
  calendar?: string;
}

class UsageError extends Error {}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'timecalc --help' for usage.");
    return 2;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(VERSION);
    return 0;
  }

  if (options.command === "grammar") return generateGrammar(options.output);
  if (options.command === "mcp") {
    try {
      const { runStdioMcpServer } = await import("./mcp");
      await runStdioMcpServer();
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  let source = options.expression;
  if (options.stdin) {
    if (source !== undefined) {
      console.error("An expression argument cannot be combined with --stdin.");
      return 2;
    }
    source = await Bun.stdin.text();
  }
  if (source === undefined) {
    console.error("Missing expression. Pass one argument or use --stdin.");
    return 2;
  }

  const outcome = evaluateRequest({
    expression: source,
    ...(options.now ? { now: options.now } : {}),
    ...(options.timeZone ? { defaultTimeZone: options.timeZone } : {}),
    ...(options.calendar ? { defaultCalendar: options.calendar } : {}),
  });

  if (!outcome.ok) {
    if (options.json) printJson(outcome.response, options.pretty);
    else console.error(formatSerializedError(outcome.response));
    return outcome.response.error.code === "INTERNAL_ERROR" ? 2 : 1;
  }

  if (options.command === "validate") {
    if (options.json) printJson({ ok: true, valid: true }, options.pretty);
    else console.log("valid");
  } else if (options.json) {
    printJson(outcome.response, options.pretty);
  } else {
    console.log(outcome.text);
  }
  return 0;
}

function parseArguments(argv: string[]): CliOptions {
  let command: Command = "eval";
  let index = 0;
  if (["eval", "validate", "grammar", "mcp"].includes(argv[0])) {
    command = argv[0] as Command;
    index++;
  }

  const options: CliOptions = {
    command,
    stdin: false,
    json: false,
    pretty: false,
  };
  const expressions: string[] = [];

  while (index < argv.length) {
    const argument = argv[index++];
    switch (argument) {
      case "--help":
      case "-h":
      case "--version":
      case "-V":
        break;
      case "--stdin":
        options.stdin = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--pretty":
        options.pretty = true;
        break;
      case "--output":
      case "-o":
        options.output = requiredOptionValue(argument, argv, index++);
        break;
      case "--now":
        options.now = requiredOptionValue(argument, argv, index++);
        break;
      case "--time-zone":
        options.timeZone = requiredOptionValue(argument, argv, index++);
        break;
      case "--calendar":
        options.calendar = requiredOptionValue(argument, argv, index++);
        break;
      case "--":
        expressions.push(...argv.slice(index));
        index = argv.length;
        break;
      default:
        if (argument.startsWith("-") && !/^-(?:P|\d)/.test(argument)) {
          throw new UsageError(`Unknown option '${argument}'`);
        }
        expressions.push(argument);
    }
  }

  if (expressions.length > 1) {
    throw new UsageError("Expected one expression argument; quote expressions containing spaces.");
  }
  options.expression = expressions[0];

  if (options.pretty && !options.json) {
    throw new UsageError("--pretty requires --json.");
  }
  if (command !== "grammar" && options.output) {
    throw new UsageError("--output is only valid with the grammar command.");
  }
  if (command === "grammar" && (options.expression || options.stdin)) {
    throw new UsageError("The grammar command does not accept an expression.");
  }
  return options;
}

function requiredOptionValue(option: string, argv: string[], index: number): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${option} requires a value.`);
  }
  return value;
}

function generateGrammar(output = "docs/grammar.html"): number {
  const executable = `${import.meta.dir}/../node_modules/.bin/ebnf2railroad`;
  const result = Bun.spawnSync({
    cmd: [executable, "--title", "timecalc DSL Grammar", `${import.meta.dir}/grammar.ebnf`, "--target", output],
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode;
}

function printJson(value: unknown, pretty: boolean): void {
  console.log(JSON.stringify(value, null, pretty ? 2 : undefined));
}

const HELP = `timecalc ${VERSION}

Evaluate deterministic Temporal date-math expressions.

Usage:
  timecalc [eval] [options] '<expression>'
  timecalc validate [options] '<expression>'
  timecalc grammar [--output <file>]

Examples:
  timecalc '(add 2025-01-31 P1M)'
  timecalc --json '(until 2025-01-01 2025-12-31 :largest-unit "months")'
  echo '(day-of-week 2025-06-01)' | timecalc --stdin

Options:
  --stdin                 Read the expression from standard input
  --json                  Emit structured JSON
  --pretty                Pretty-print JSON (requires --json)
  --now <instant>         Inject the evaluation clock
  --time-zone <zone>      Set the evaluation context's default time zone
  --calendar <calendar>   Set the evaluation context's default calendar
  -o, --output <file>     Grammar diagram output path
  -h, --help              Show help
  -V, --version           Show version
`;

if (import.meta.main) {
  process.exitCode = await main();
}
