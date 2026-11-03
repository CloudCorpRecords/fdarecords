/**
 * fdarecords MCP server. Tools: search_drug_label,
 * lookup_drugsfda_application, resolve_drug_to_application,
 * screen_for_rwe_signals, lookup_device_submission,
 * classify_device_product_code, validate_device_application.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core validates every tools/call
 * argument set itself.
 *
 * Every tool returns a single text item; a query with no
 * results returns the JSON text "null", and validation or
 * upstream failures come back as isError results carrying
 * the documented error strings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
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

const TOOLS = [
  {
    name: "search_drug_label",
    description: "Search SPL label text, optionally scoped to a section.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "integer" , description: "Maximum number of results to return (optional)." },
        query: { type: "string" , description: "Search query text." },
        section: { type: "string" , description: "The section for this call." },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_drugsfda_application",
    description: "Drugs@FDA record for an NDA/BLA/ANDA number.",
    inputSchema: {
      type: "object" as const,
      properties: {
        application_number: { type: "string" , description: "The application number for this call." },
      },
      required: ["application_number"],
    },
  },
  {
    name: "resolve_drug_to_application",
    description: "Brand or generic name to application number(s).",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" , description: "Name for this call." },
      },
      required: ["name"],
    },
  },
  {
    name: "screen_for_rwe_signals",
    description:
      "Experimental, unvalidated sweep of drug labels for real-world-evidence signals; hits are candidates for human review, not findings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "integer" , description: "Maximum number of results to return (optional)." },
        query: { type: "string" , description: "Search query text." },
      },
    },
  },
  {
    name: "lookup_device_submission",
    description:
      "510(k)/De Novo/PMA submission number to device record (K or DEN number, P number; HDE numbers are not in openFDA).",
    inputSchema: {
      type: "object" as const,
      properties: {
        submission_number: { type: "string" , description: "The submission number for this call." },
      },
      required: ["submission_number"],
    },
  },
  {
    name: "classify_device_product_code",
    description: "Device product code to device class and medical specialty.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_code: { type: "string" , description: "The product code for this call." },
      },
      required: ["product_code"],
    },
  },
  {
    name: "validate_device_application",
    description:
      "Full chain: submission number to device class, medical specialty and category.",
    inputSchema: {
      type: "object" as const,
      properties: {
        submission_number: { type: "string" , description: "The submission number for this call." },
      },
      required: ["submission_number"],
    },
  },
];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "fdarecords", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "search_drug_label":
        out = await searchDrugLabel(a as never);
        break;
      case "lookup_drugsfda_application":
        out = await lookupDrugsfdaApplication(a as never);
        break;
      case "resolve_drug_to_application":
        out = await resolveDrugToApplication(a as never);
        break;
      case "screen_for_rwe_signals":
        out = await screenForRweSignals(a as never);
        break;
      case "lookup_device_submission":
        out = await lookupDeviceSubmission(a as never);
        break;
      case "classify_device_product_code":
        out = await classifyDeviceProductCode(a as never);
        break;
      case "validate_device_application":
        out = await validateDeviceApplication(a as never);
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
