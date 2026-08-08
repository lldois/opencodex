\
import { describe, expect, test } from "bun:test";
import { createOpenAIChatAdapter } from "../src/adapters/openai-chat";
import { createResponsesPassthroughAdapter } from "../src/adapters/openai-responses";
import { createTranslatorBudget } from "../src/lib/translator-budget";
import type { OcxParsedRequest, OcxProviderConfig, OcxTool } from "../src/types";

function gmailParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      part: { $ref: "#/$defs/GmailMessagePartRequest" },
      mode: { anyOf: [{ type: "string", enum: ["full"] }, { type: "null" }] },
    },
    required: ["part"],
    $defs: {
      GmailMessagePartRequest: {
        type: "object",
        properties: {
          mimeType: { type: "string" },
          body: { type: "string", "x-mcp-header": "X-Gmail-Part" },
        },
        required: ["mimeType"],
      },
    },
  };
}

function parsedChat(modelId: string): OcxParsedRequest {
  return {
    modelId,
    stream: false,
    options: {},
    context: {
      messages: [{ role: "user", content: "inspect gmail", timestamp: 0 }],
      tools: [{ name: "gmail_read", description: "Read Gmail", parameters: gmailParameters() } as OcxTool],
    },
  } as OcxParsedRequest;
}

function assertPortable(parameters: Record<string, unknown>): void {
  expect(parameters.$defs).toBeUndefined();
  expect(parameters.definitions).toBeUndefined();
  expect(JSON.stringify(parameters)).not.toContain('"$ref"');
  const properties = parameters.properties as Record<string, Record<string, unknown>>;
  expect(properties.part.type).toBe("object");
  expect((properties.part.properties as Record<string, Record<string, unknown>>).mimeType.type).toBe("string");
  expect(JSON.stringify(properties.part)).not.toContain("x-mcp-header");
  expect(properties.mode).toEqual({ type: "string", enum: ["full"], nullable: true });
}

const chatProvider = {
  adapter: "openai-chat",
  baseUrl: "https://newapi.example/v1",
  authMode: "key",
  apiKey: "sk-test",
} as OcxProviderConfig;

const responsesProvider = {
  adapter: "openai-responses",
  baseUrl: "https://newapi.example/v1",
  authMode: "key",
  apiKey: "sk-test",
} as OcxProviderConfig;

describe("NewAPI-style Claude/Gemini tool schema compatibility", () => {
  test("Chat Completions sanitizes Gmail $ref/$defs for Claude and Gemini", () => {
    for (const modelId of ["claude-opus-4-6-thinking", "vendor/gemini-3.6-pro"]) {
      const request = createOpenAIChatAdapter(chatProvider).buildRequest(parsedChat(modelId));
      const body = JSON.parse(String(request.body)) as {
        tools: Array<{ function: { parameters: Record<string, unknown> } }>;
      };
      assertPortable(body.tools[0].function.parameters);
    }
  });

  test("Chat Completions leaves DeepSeek JSON Schema intact", () => {
    const request = createOpenAIChatAdapter(chatProvider).buildRequest(parsedChat("deepseek-v4-flash"));
    const body = JSON.parse(String(request.body)) as {
      tools: Array<{ function: { parameters: Record<string, unknown> } }>;
    };
    expect(body.tools[0].function.parameters.$defs).toBeDefined();
    expect(JSON.stringify(body.tools[0].function.parameters)).toContain('"$ref"');
  });

  test("Responses passthrough sanitizes top-level, namespace, and additional_tools schemas", () => {
    const budget = createTranslatorBudget();
    try {
      const schema = gmailParameters();
      const request = createResponsesPassthroughAdapter(responsesProvider).buildRequest({
        modelId: "newapi/gemini-3.6-pro",
        stream: true,
        options: {},
        context: { messages: [] },
        _rawBody: {
          model: "gemini-3.6-pro",
          input: [{
            type: "additional_tools",
            tools: [{ type: "function", name: "gmail_additional", parameters: schema }],
          }],
          tools: [
            { type: "function", name: "gmail_top", parameters: schema },
            {
              type: "namespace",
              name: "gmail",
              tools: [{ type: "function", name: "nested", parameters: schema }],
            },
          ],
        },
      } as OcxParsedRequest, { headers: new Headers(), translatorBudget: budget });
      const body = JSON.parse(String(request.body)) as {
        tools: Array<Record<string, unknown>>;
        input: Array<{ tools: Array<Record<string, unknown>> }>;
      };
      assertPortable((body.tools[0] as { parameters: Record<string, unknown> }).parameters);
      const namespace = body.tools[1] as { tools: Array<{ parameters: Record<string, unknown> }> };
      assertPortable(namespace.tools[0].parameters);
      assertPortable((body.input[0].tools[0] as { parameters: Record<string, unknown> }).parameters);
      request.releaseBodyObservation?.();
    } finally {
      budget.dispose();
    }
  });

  test("Responses passthrough leaves DeepSeek JSON Schema intact", () => {
    const budget = createTranslatorBudget();
    try {
      const request = createResponsesPassthroughAdapter(responsesProvider).buildRequest({
        modelId: "deepseek-v4-flash",
        stream: true,
        options: {},
        context: { messages: [] },
        _rawBody: {
          model: "deepseek-v4-flash",
          input: [],
          tools: [{ type: "function", name: "gmail_read", parameters: gmailParameters() }],
        },
      } as OcxParsedRequest, { headers: new Headers(), translatorBudget: budget });
      const body = JSON.parse(String(request.body)) as {
        tools: Array<{ parameters: Record<string, unknown> }>;
      };
      expect(body.tools[0].parameters.$defs).toBeDefined();
      expect(JSON.stringify(body.tools[0].parameters)).toContain('"$ref"');
      request.releaseBodyObservation?.();
    } finally {
      budget.dispose();
    }
  });
});
