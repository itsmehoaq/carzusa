const test = require("node:test");
const assert = require("node:assert");

const {
  videoCandidatesInNode,
  videoLinkInNode,
  thumbnailInNode,
} = require("../utils/facebook");

test("videoCandidatesInNode reads modern progressive_urls, HD before SD", () => {
  const node = {
    media: {
      videoDeliveryResponseFragment: {
        videoDeliveryResponseResult: {
          progressive_urls: [
            { progressive_url: "https://video.fbcdn.net/sd.mp4", metadata: { quality: "SD" } },
            { progressive_url: "https://video.fbcdn.net/hd.mp4", metadata: { quality: "HD" } },
          ],
        },
      },
    },
  };

  assert.deepStrictEqual(videoCandidatesInNode(node), [
    "https://video.fbcdn.net/hd.mp4",
    "https://video.fbcdn.net/sd.mp4",
  ]);
  assert.strictEqual(videoLinkInNode(node), "https://video.fbcdn.net/hd.mp4");
});

test("videoCandidatesInNode still reads legacy and playable_url shapes", () => {
  const legacy = {
    videoDeliveryLegacyFields: {
      browser_native_hd_url: "https://video.fbcdn.net/legacy-hd.mp4",
      browser_native_sd_url: "https://video.fbcdn.net/legacy-sd.mp4",
    },
  };
  assert.deepStrictEqual(videoCandidatesInNode(legacy), [
    "https://video.fbcdn.net/legacy-hd.mp4",
    "https://video.fbcdn.net/legacy-sd.mp4",
  ]);

  const story = { playable_url: "https://video.fbcdn.net/story.mp4" };
  assert.deepStrictEqual(videoCandidatesInNode(story), ["https://video.fbcdn.net/story.mp4"]);
});

test("videoCandidatesInNode ignores non-http junk and returns [] when empty", () => {
  assert.deepStrictEqual(videoCandidatesInNode({ playable_url: null }), []);
  assert.deepStrictEqual(videoCandidatesInNode({ playable_url: "blob:whatever" }), []);
  assert.strictEqual(videoLinkInNode({}), null);
});

test("thumbnailInNode prefers preferred_thumbnail then falls back to nested scan", () => {
  assert.strictEqual(
    thumbnailInNode({ preferred_thumbnail: { image: { uri: "https://img.fbcdn.net/t.jpg" } } }),
    "https://img.fbcdn.net/t.jpg"
  );
  assert.strictEqual(
    thumbnailInNode({ deep: { thumbnailImage: { uri: "https://img.fbcdn.net/n.jpg" } } }),
    "https://img.fbcdn.net/n.jpg"
  );
  assert.strictEqual(thumbnailInNode({}), null);
});
