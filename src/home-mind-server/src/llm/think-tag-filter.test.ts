import { describe, it, expect } from "vitest";
import { stripThinkTags, ThinkTagFilter } from "./think-tag-filter.js";

describe("stripThinkTags", () => {
  it("removes a single <think> block", () => {
    const input = "<think>\nLet me think about this...\n</think>\nHello world!";
    expect(stripThinkTags(input)).toBe("Hello world!");
  });

  it("removes multiple <think> blocks", () => {
    const input = "<think>First thought</think>\n<think>Second thought</think>\nResult";
    expect(stripThinkTags(input)).toBe("Result");
  });

  it("is case insensitive", () => {
    const input = "<THINK>thinking</THINK>\nAnswer";
    expect(stripThinkTags(input)).toBe("Answer");
  });

  it("returns text unchanged when no think tags present", () => {
    const input = "Hello world! No thinking here.";
    expect(stripThinkTags(input)).toBe("Hello world! No thinking here.");
  });

  it("returns empty string for think-only content", () => {
    const input = "<think>All thinking, no output</think>";
    expect(stripThinkTags(input)).toBe("");
  });

  it("handles empty string", () => {
    expect(stripThinkTags("")).toBe("");
  });

  it("handles think block at end of text", () => {
    const input = "Hello<think>thinking</think>";
    expect(stripThinkTags(input)).toBe("Hello");
  });

  it("handles think block in the middle of text", () => {
    const input = "Before<think>middle</think>After";
    expect(stripThinkTags(input)).toBe("BeforeAfter");
  });

  it("handles multiline think block content", () => {
    const input = `<think>
Line 1
Line 2
Line 3
</think>
Got it, I'll remember that!`;
    expect(stripThinkTags(input)).toBe("Got it, I'll remember that!");
  });
});

describe("ThinkTagFilter", () => {
  it("passes through normal text without think tags", () => {
    const filter = new ThinkTagFilter();
    expect(filter.push("Hello world")).toBe("Hello world");
    expect(filter.flush()).toBe("");
  });

  it("filters out a complete think block in one chunk", () => {
    const filter = new ThinkTagFilter();
    const result = filter.push("<think>thinking</think>Hello!");
    expect(result).toBe("Hello!");
  });

  it("filters think block split across two chunks", () => {
    const filter = new ThinkTagFilter();
    expect(filter.push("<think>star")).toBe("");
    expect(filter.push("t thinking</think>Hello")).toBe("Hello");
    expect(filter.flush()).toBe("");
  });

  it("handles opening tag split across chunks", () => {
    const filter = new ThinkTagFilter();
    // "<thi" could be the start of "<think>"
    const r1 = filter.push("<thi");
    expect(r1).toBe("");
    // Complete the tag
    const r2 = filter.push("nk>inside</think>output");
    expect(r2).toBe("output");
  });

  it("handles closing tag split across chunks", () => {
    const filter = new ThinkTagFilter();
    expect(filter.push("<think>thinking</thi")).toBe("");
    expect(filter.push("nk>visible text")).toBe("visible text");
  });

  it("emits text before think block", () => {
    const filter = new ThinkTagFilter();
    const result = filter.push("before<think>hidden</think>after");
    expect(result).toBe("beforeafter");
  });

  it("handles multiple chunks of normal text", () => {
    const filter = new ThinkTagFilter();
    expect(filter.push("Hello")).toBe("Hello");
    expect(filter.push(" world")).toBe(" world");
    expect(filter.push("!")).toBe("!");
    expect(filter.flush()).toBe("");
  });

  it("handles think-only response", () => {
    const filter = new ThinkTagFilter();
    expect(filter.push("<think>only thinking</think>")).toBe("");
    expect(filter.flush()).toBe("");
  });

  it("flushes buffered non-think content", () => {
    const filter = new ThinkTagFilter();
    // This is not a complete think tag, so flush should emit it
    filter.push("Hello <");
    // The "<" at the end could be the start of "<think>", so it's buffered
    const flushed = filter.flush();
    expect(flushed).toBe("<");
  });

  it("discards buffered content inside think block on flush", () => {
    const filter = new ThinkTagFilter();
    filter.push("<think>unterminated thinking");
    expect(filter.flush()).toBe("");
  });

  it("simulates realistic streaming with Qwen3 response", () => {
    const filter = new ThinkTagFilter();
    const chunks = [
      "<think>\n",
      "Let me analyze this conversation.\n",
      "The user wants me to remember a passkey.\n",
      "</think>\n",
      "Got it, I'll",
      " remember the passkey",
      " 998877 for your LEGO bubble! 🧢",
    ];

    let output = "";
    for (const chunk of chunks) {
      output += filter.push(chunk);
    }
    output += filter.flush();

    expect(output).toBe("Got it, I'll remember the passkey 998877 for your LEGO bubble! 🧢");
  });

  it("handles case-insensitive tags in stream", () => {
    const filter = new ThinkTagFilter();
    expect(filter.push("<THINK>caps</THINK>text")).toBe("text");
  });
});
