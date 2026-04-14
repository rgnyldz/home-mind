/**
 * Utilities for stripping <think>...</think> blocks from thinking-model
 * LLM responses (e.g. Qwen3, DeepSeek-R1).
 *
 * Used in two places:
 * 1. Chat response text — strip before storing, returning, or passing to the fact extractor
 * 2. Streaming — suppress think-block content from being sent to the user via SSE
 */

/**
 * Strip all <think>...</think> blocks from text.
 * Safe to call on text that has no think tags (returns it unchanged).
 */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

/**
 * Streaming-aware think-tag filter.
 *
 * Because stream chunks can split tags across boundaries (e.g. "<thi" in one
 * chunk and "nk>" in the next), this filter buffers content that looks like
 * a partial tag and only emits confirmed non-thinking content.
 */
export class ThinkTagFilter {
  /** True while we're inside a <think> block */
  private insideThink = false;
  /** Buffer for potential partial tags at chunk boundaries */
  private buffer = "";

  /**
   * Process a streaming chunk. Returns the text that should be emitted
   * to the user (empty string if everything was inside a think block
   * or is being buffered for partial-tag detection).
   */
  push(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    while (this.buffer.length > 0) {
      if (this.insideThink) {
        // Look for closing </think> tag
        const closeIdx = this.buffer.search(/<\/think>/i);
        if (closeIdx === -1) {
          // Check if the buffer ends with a partial "</thi..." that could become </think>
          const partialClose = this.findPartialTag(this.buffer, "</think>");
          if (partialClose >= 0) {
            // Keep the potential partial tag in the buffer, discard everything before it
            this.buffer = this.buffer.slice(partialClose);
            return output;
          }
          // No closing tag found — discard all (it's thinking content)
          this.buffer = "";
          return output;
        }
        // Found closing tag — skip everything up to and including </think>
        const afterClose = closeIdx + "</think>".length;
        this.buffer = this.buffer.slice(afterClose);
        this.insideThink = false;
        // Skip any whitespace immediately after </think>
        const wsMatch = this.buffer.match(/^\s+/);
        if (wsMatch) {
          this.buffer = this.buffer.slice(wsMatch[0].length);
        }
      } else {
        // Look for opening <think> tag
        const openIdx = this.buffer.search(/<think>/i);
        if (openIdx === -1) {
          // Check if the buffer ends with a partial "<thi..." that could become <think>
          const partialOpen = this.findPartialTag(this.buffer, "<think>");
          if (partialOpen >= 0) {
            // Emit everything before the partial tag, keep the rest buffered
            output += this.buffer.slice(0, partialOpen);
            this.buffer = this.buffer.slice(partialOpen);
            return output;
          }
          // No opening tag — emit everything
          output += this.buffer;
          this.buffer = "";
          return output;
        }
        // Found opening tag — emit everything before it
        output += this.buffer.slice(0, openIdx);
        this.buffer = this.buffer.slice(openIdx + "<think>".length);
        this.insideThink = true;
      }
    }

    return output;
  }

  /**
   * Flush any remaining buffered content. Call when the stream ends.
   * Returns any content that was being buffered for partial-tag detection.
   */
  flush(): string {
    const remaining = this.insideThink ? "" : this.buffer;
    this.buffer = "";
    this.insideThink = false;
    return remaining;
  }

  /**
   * Check if `text` ends with a prefix of `tag`.
   * Returns the index where the partial match starts, or -1 if no match.
   *
   * Example: findPartialTag("abc<thi", "<think>") → 3
   */
  private findPartialTag(text: string, tag: string): number {
    const lowerText = text.toLowerCase();
    const lowerTag = tag.toLowerCase();

    // Check suffixes of text against prefixes of tag
    // Start from the longest possible partial match
    const maxLen = Math.min(lowerText.length, lowerTag.length - 1);
    for (let len = maxLen; len >= 1; len--) {
      if (lowerText.endsWith(lowerTag.slice(0, len))) {
        return lowerText.length - len;
      }
    }
    return -1;
  }
}
