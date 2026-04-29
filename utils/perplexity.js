const axios = require("axios");

const PPLX_BASE_URL = process.env.PPLX_BASE_URL || "http://localhost:20128/v1";
const PPLX_MODEL = process.env.PPLX_MODEL || "pplx-web/pplx-auto";
const MAX_REPLY_CHARS = 400;

const SYSTEM_PROMPT = `You answer search-style queries with concise, useful results.

Rules:
- HARD LIMIT: ≤255 characters total (truncate if needed)
- Answer directly; no greetings or filler
- Use Discord markdown: **bold**, *italic*, \`code\`, newlines
- Emojis allowed when useful
- Prioritize key facts (dates, names, numbers)
- Prefer brevity over completeness
- If unclear, answer the most common interpretation
- For time-sensitive queries, use the latest info
- If exceeding limit, cut off mid-sentence`;

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
      `${PPLX_BASE_URL}/chat/completions`,
      {
        model: PPLX_MODEL,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: query,
          },
        ],
        max_tokens: 80,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const data = response.data;
    const aiContent = truncateReply(data.choices?.[0]?.message?.content || "");
    const searchResults = data.search_results || [];

    const citations = parseCitations(aiContent, searchResults);

    return {
      content: aiContent,
      citations,
      error: null,
    };
  } catch (error) {
    console.error("Perplexity API error:", error.response?.data || error.message);
    return {
      content: null,
      citations: [],
      error: error.message || "Failed to get AI response",
    };
  }
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
};
