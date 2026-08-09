import { describe, expect, test } from "bun:test";
import { parseRequest } from "../src/responses/parser";
import { buildToolBridgeMaps } from "../src/server/responses/collaboration";

describe("routed native search and deferred tool bridge", () => {
  test("web_search and tool_search remain available together for routed models", () => {
    const parsed = parseRequest({
      model: "newapi/gemini-3.6-pro",
      input: "search then use a client tool",
      tools: [
        { type: "web_search" },
        { type: "tool_search", description: "Search for additional client tools" },
      ],
    });

    expect(parsed._webSearch).toBeDefined();
    const toolSearch = parsed.context.tools?.find(tool => tool.name === "tool_search");
    expect(toolSearch?.toolSearch).toBe(true);

    const maps = buildToolBridgeMaps(parsed);
    expect(maps.toolSearchToolNames.has("tool_search")).toBe(true);
  });
});
