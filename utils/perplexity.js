const axios = require("axios");

const PPLX_BASE_URL =
  process.env.PPLX_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const PPLX_MODEL = process.env.PPLX_MODEL || "models/gemma-4-31b-it";
const MAX_REPLY_CHARS = 1024;

const SYSTEM_INSTRUCTION =
  "Answer search queries directly and concisely. Return ONLY the final answer. " +
  "Maximum 255 characters. No analysis, reasoning, explanation, or greetings. " +
  "Discord markdown is allowed. Prioritize current facts, dates, names, and numbers.";

async function getAIReply(query) {
  const apiKey = process.env.PPLX_KEY;

  if (!apiKey) {
    return {
      content: null,
      citations: [],
      error: "PPLX_KEY not configured",
    };
  }

  try {
    const response = await axios.post(
      `${PPLX_BASE_URL}/interactions`,
      {
        model: PPLX_MODEL,
        system_instruction: SYSTEM_INSTRUCTION,
        input: query,
        tools: [{ type: "google_search" }],
        generation_config: {
          temperature: 1,
          max_output_tokens: 1024,
          thinking_level: "high",
          thinking_summaries: "none",
        },
      },
      {
        headers: buildHeaders(apiKey),
        timeout: 30000,
      },
    );

    const data = response.data;
    const aiContent = truncateReply(extractModelOutput(data));

    if (!aiContent) {
      return {
        content: null,
        citations: [],
        error: `No model output (status: ${data?.status ?? "unknown"})`,
      };
    }

    return {
      content: aiContent,
      citations: parseCitations(aiContent, extractSearchResults(data)),
      error: null,
    };
  } catch (error) {
    console.error("Google AI search error:", error.response?.data || error.message);
    return {
      content: null,
      citations: [],
      error: error.message || "Failed to get AI response",
    };
  }
}

function buildHeaders(apiKey) {
  return {
    accept: "*/*",
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

/// The answer is the `model_output` step; every other step is thinking or the
/// search tool call. Joins all text parts in case the model emits more than one.
function extractModelOutput(data) {
  const step = (data?.steps || []).find((s) => s.type === "model_output");
  return (step?.content || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/// google_search_result steps carry the grounding sources. Shape varies and is
/// often empty, so anything without a url is dropped.
function extractSearchResults(data) {
  return (data?.steps || [])
    .filter((s) => s.type === "google_search_result" && Array.isArray(s.result))
    .flatMap((s) => s.result)
    .filter((r) => r && typeof r.url === "string");
}

function truncateReply(content) {
  return content.length > MAX_REPLY_CHARS
    ? content.slice(0, MAX_REPLY_CHARS)
    : content;
}

function parseCitations(content, searchResults) {
  if (!content || !searchResults || searchResults.length === 0) {
    return [];
  }

  const citationPattern = /\[(\d+)\]/g;
  const foundIndices = new Set();
  let match;

  while ((match = citationPattern.exec(content)) !== null) {
    const index = parseInt(match[1], 10);
    if (index >= 1 && index <= searchResults.length) {
      foundIndices.add(index);
    }
  }

  const citations = [];
  for (const index of Array.from(foundIndices).sort((a, b) => a - b)) {
    const result = searchResults[index - 1];
    if (result) {
      citations.push({
        index,
        url: result.url,
        title: result.title || `Source ${index}`,
      });
    }
  }

  return citations;
}

function formatContentWithCitations(content, citations) {
  if (!content || !citations || citations.length === 0) {
    return content || "";
  }

  const citationMap = new Map();
  for (const c of citations) {
    citationMap.set(c.index, c.url);
  }

  return content.replace(/\[(\d+)\]/g, (match, num) => {
    const index = parseInt(num, 10);
    const url = citationMap.get(index);
    if (url) {
      return `[[${index}]](${url})`;
    }
    return match;
  });
}

module.exports = {
  getAIReply,
  parseCitations,
  formatContentWithCitations,
  extractModelOutput,
  extractSearchResults,
};
