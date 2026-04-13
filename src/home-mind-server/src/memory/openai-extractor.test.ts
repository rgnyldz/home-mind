import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

import { OpenAIFactExtractor } from "./openai-extractor.js";
import type { Fact } from "./types.js";

describe("OpenAIFactExtractor", () => {
  let extractor: OpenAIFactExtractor;

  beforeEach(() => {
    extractor = new OpenAIFactExtractor("test-key", "gpt-4o-mini");
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid JSON response into ExtractedFact[]", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                content: "User prefers 22°C",
                category: "preference",
                replaces: [],
              },
            ]),
          },
        },
      ],
    });

    const result = await extractor.extract("I prefer 22", "Got it!", []);

    expect(result).toEqual([
      { content: "User prefers 22°C", category: "preference", replaces: [] },
    ]);
  });

  it("filters out facts with invalid categories", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { content: "Valid", category: "preference", replaces: [] },
              { content: "Invalid", category: "unknown_cat", replaces: [] },
            ]),
          },
        },
      ],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("preference");
  });

  it("accepts all 6 valid categories", async () => {
    const categories = [
      "baseline",
      "preference",
      "identity",
      "device",
      "pattern",
      "correction",
    ];
    const facts = categories.map((c) => ({
      content: `Fact for ${c}`,
      category: c,
      replaces: [],
    }));

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(facts) } }],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toHaveLength(6);
  });

  it("handles replaces field correctly", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                content: "New pref",
                category: "preference",
                replaces: ["old-1", "old-2"],
              },
            ]),
          },
        },
      ],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result[0].replaces).toEqual(["old-1", "old-2"]);
  });

  it("defaults replaces to empty array when not an array", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([
              {
                content: "A fact",
                category: "preference",
                replaces: "not-an-array",
              },
            ]),
          },
        },
      ],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result[0].replaces).toEqual([]);
  });

  it("passes existing facts to the prompt", async () => {
    const existingFacts: Fact[] = [
      {
        id: "fact-1",
        userId: "user-1",
        content: "Old preference",
        category: "preference",
        confidence: 0.8,
        createdAt: new Date(),
        lastUsed: new Date(),
        useCount: 1,
      },
    ];

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "[]" } }],
    });

    await extractor.extract("msg", "resp", existingFacts);

    const callArgs = mockCreate.mock.calls[0][0];
    const promptContent = callArgs.messages[0].content;
    expect(promptContent).toContain("fact-1");
    expect(promptContent).toContain("Old preference");
  });

  it("returns empty array when API throws", async () => {
    mockCreate.mockRejectedValue(new Error("API error"));

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("strips markdown code fences from JSON response", async () => {
    const json = JSON.stringify([
      { content: "Daughter name is TOTO", category: "identity", replaces: [] },
    ]);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "```json\n" + json + "\n```" } }],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([
      { content: "Daughter name is TOTO", category: "identity", replaces: [] },
    ]);
  });

  it("returns empty array when response is invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json at all" } }],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("returns empty array when response is not an array", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"not": "array"}' } }],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("returns empty array when content is null", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("returns empty array when choices is empty", async () => {
    mockCreate.mockResolvedValue({ choices: [] });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("returns empty array when content is empty string", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("extracts JSON array from response with surrounding text", async () => {
    const json = JSON.stringify([
      { content: "User's name is Bob", category: "identity", replaces: [] },
    ]);
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `Here are the facts I extracted:\n${json}\nThat's all.`,
          },
        },
      ],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([
      { content: "User's name is Bob", category: "identity", replaces: [] },
    ]);
  });

  it("returns empty array when response has no JSON array anywhere", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "I could not extract any facts from this conversation.",
          },
        },
      ],
    });

    const result = await extractor.extract("msg", "resp", []);

    expect(result).toEqual([]);
  });

  it("strips <think> tags from thinking model responses (e.g. Qwen3)", async () => {
    const json = JSON.stringify([
      { content: "User's name is Jure", category: "identity", confidence: 1.0, replaces: [] },
    ]);
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `<think>\nLet me analyze this conversation...\nThe user told the assistant their name is Jure.\n</think>\n${json}`,
          },
        },
      ],
    });

    const result = await extractor.extract("My name is Jure", "Nice to meet you, Jure!", []);

    expect(result).toEqual([
      { content: "User's name is Jure", category: "identity", confidence: 1.0, replaces: [] },
    ]);
  });

  it("strips <think> tags with code fences from thinking model responses", async () => {
    const json = JSON.stringify([
      { content: "User prefers warm white lights", category: "preference", confidence: 0.9, replaces: [] },
    ]);
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `<think>\nAnalyzing...\n</think>\n\`\`\`json\n${json}\n\`\`\``,
          },
        },
      ],
    });

    const result = await extractor.extract("I like warm white", "Got it!", []);

    expect(result).toEqual([
      { content: "User prefers warm white lights", category: "preference", confidence: 0.9, replaces: [] },
    ]);
  });

  it("handles <think> tags with empty JSON array response", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "<think>\nThis is just a command, no facts to extract.\n</think>\n[]",
          },
        },
      ],
    });

    const result = await extractor.extract("turn on the light", "Done!", []);

    expect(result).toEqual([]);
  });

  it("handles multiple <think> blocks in response", async () => {
    const json = JSON.stringify([
      { content: "User's daughter is named Alice", category: "identity", confidence: 0.95, replaces: [] },
    ]);
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `<think>First thought</think>\n<think>Second thought</think>\n${json}`,
          },
        },
      ],
    });

    const result = await extractor.extract("My daughter Alice just started school", "That's exciting!", []);

    expect(result).toEqual([
      { content: "User's daughter is named Alice", category: "identity", confidence: 0.95, replaces: [] },
    ]);
  });

  it("passes baseUrl to OpenAI constructor", () => {
    // Just verifying construction doesn't throw
    const ext = new OpenAIFactExtractor(
      "key",
      "model",
      "https://proxy.example.com"
    );
    expect(ext).toBeDefined();
  });
});
