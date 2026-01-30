const axios = require("axios");

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
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
                "You are a quick search engine. Search the keyword and return a comprehensive answer.\n\nRules:\n- Max 255 characters (including spaces, markdown, emojis)\n- Use Discord-compatible markdown: **bold**, *italic*, `code`, ...\n- Use any emojis available\n- Answer directly — no greetings or filler\n- Prioritize key facts; abbreviate if needed\n- If query is unclear, answer the most common interpretation",
          },
          {
            role: "user",
            content: query,
          },
        ],
        temperature: 0.2,
        top_k: 0,
        top_p: 0.9,
        response_format: {
          type: "text",
        },
        tool_choice: "none",
        parallel_tool_calls: false,
        web_search_options: {
          search_context_size: "low",
          search_type: "fast",
          image_results_enhanced_relevance: false,
        },
        search_mode: "web",
        return_images: false,
        return_related_questions: false,
        stream: false,
        presence_penalty: 0,
        frequency_penalty: 0,
        disable_search: false,
        enable_search_classifier: false,
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
    const aiContent = data.choices?.[0]?.message?.content || "";
    const searchResults = data.search_results || [];

    const citations = parseCitations(aiContent, searchResults);

    return {
      content: aiContent,
      citations,
      error: null,
    };
  } catch (error) {
    console.error("Perplexity API error:", error.message);
    return {
      content: null,
      citations: [],
      error: error.message || "Failed to get AI response",
    };
  }
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
