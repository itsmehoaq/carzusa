const test = require("node:test");
const assert = require("node:assert");

const { extractModelOutput, extractSearchResults } = require("../utils/perplexity");

// Trimmed copy of a real /v1beta/interactions response: thought and
// google_search steps come before the answer, and the answer is the last step.
const sampleResponse = {
  id: "v1_Chdoemg2YXNDekhOSFRyZmNQMjhLYWlRZxIXaHpoNmFzQ3pITkhUcmZjUDI4S2FpUWc",
  status: "completed",
  steps: [
    {
      type: "thought",
      summary: [{ text: "I will search for today's date...", type: "text" }],
    },
    {
      type: "google_search_call",
      id: "v5l3tbvn",
      arguments: { queries: ["today's date", "Samsung Galaxy Z Fold 8"] },
      search_type: "web_search",
    },
    { type: "google_search_result", call_id: "v5l3tbvn", result: [], is_error: false },
    { type: "thought", summary: [{ text: "I have all the necessary information.", type: "text" }] },
    {
      type: "model_output",
      content: [
        {
          text: "Today is **Monday, August 10, 2026**.\n\n*   **Price:** ~$1,899 (Fold 8)",
          annotations: [],
          type: "text",
        },
      ],
    },
  ],
  object: "interaction",
  model: "models/gemma-4-31b-it",
};

test("extractModelOutput returns the answer, not the thinking steps", () => {
  assert.strictEqual(
    extractModelOutput(sampleResponse),
    "Today is **Monday, August 10, 2026**.\n\n*   **Price:** ~$1,899 (Fold 8)"
  );
});

test("extractModelOutput joins multiple text parts and skips non-text ones", () => {
  const multi = {
    steps: [
      {
        type: "model_output",
        content: [
          { text: "first", type: "text" },
          { type: "image", uri: "https://example/x.png" },
          { text: "second", type: "text" },
        ],
      },
    ],
  };
  assert.strictEqual(extractModelOutput(multi), "first\nsecond");
});

test("extractModelOutput is empty when the interaction produced no answer", () => {
  assert.strictEqual(extractModelOutput({ status: "failed", steps: [] }), "");
  assert.strictEqual(extractModelOutput({}), "");
  assert.strictEqual(extractModelOutput(undefined), "");
});

test("extractSearchResults keeps only grounding entries that carry a url", () => {
  assert.deepStrictEqual(extractSearchResults(sampleResponse), []);

  const grounded = {
    steps: [
      {
        type: "google_search_result",
        result: [
          { url: "https://example.com/a", title: "A" },
          { title: "no url" },
        ],
      },
    ],
  };
  assert.deepStrictEqual(extractSearchResults(grounded), [
    { url: "https://example.com/a", title: "A" },
  ]);
});
