#!/usr/bin/env node
/**
 * fdarecords CLI.
 *
 *   fdarecords search_drug_label '<json>'
 *   fdarecords lookup_drugsfda_application '<json>'
 *   fdarecords resolve_drug_to_application '<json>'
 *   fdarecords screen_for_rwe_signals '<json>'
 *   fdarecords lookup_device_submission '<json>'
 *   fdarecords classify_device_product_code '<json>'
 *   fdarecords validate_device_application '<json>'
 *   fdarecords mcp
 *   fdarecords --version
 *
 * Each tool subcommand takes one JSON argument string with the
 * tool's arguments and prints the tool's result text. Exit
 * codes: 0 success, 1 runtime error, 2 usage error.
 */
import {
  classifyDeviceProductCode,
  lookupDeviceSubmission,
  lookupDrugsfdaApplication,
  resolveDrugToApplication,
  screenForRweSignals,
  searchDrugLabel,
  validateDeviceApplication,
  VERSION,
} from "./fda.js";

const TOOL_NAMES = [
  "search_drug_label",
  "lookup_drugsfda_application",
  "resolve_drug_to_application",
  "screen_for_rwe_signals",
  "lookup_device_submission",
  "classify_device_product_code",
  "validate_device_application",
] as const;

function usage(): never {
  console.error(`Usage:
  fdarecords <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  fdarecords mcp
  fdarecords --version`);
  process.exit(2);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_drug_label":
      return searchDrugLabel(args as never);
    case "lookup_drugsfda_application":
      return lookupDrugsfdaApplication(args as never);
    case "resolve_drug_to_application":
      return resolveDrugToApplication(args as never);
    case "screen_for_rwe_signals":
      return screenForRweSignals(args as never);
    case "lookup_device_submission":
      return lookupDeviceSubmission(args as never);
    case "classify_device_product_code":
      return classifyDeviceProductCode(args as never);
    case "validate_device_application":
      return validateDeviceApplication(args as never);
    default:
      usage();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
