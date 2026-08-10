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

const { findFirstByKey, hasKeys, findReelContentNode, ownerFromNode, parseReelContent } =
  require("../utils/facebook");

test("findFirstByKey misses as undefined so hasKeys can actually reject", () => {
  assert.strictEqual(findFirstByKey({ a: 1 }, "missing"), undefined);
  assert.strictEqual(findFirstByKey({ a: { b: 2 } }, "b"), 2);
  assert.strictEqual(hasKeys({ a: 1 }, "a"), true);
  assert.strictEqual(hasKeys({ a: 1 }, "a", "missing"), false);
});

const block = (parsed) => ({ json: JSON.stringify(parsed), parsed });

test("findReelContentNode matches creation_story without browser_native_sd_url", () => {
  const blocks = [
    block({ unrelated: { creation_story: { id: "1" } } }),
    block({
      wrapper: {
        creation_story: {
          id: "42",
          short_form_video_context: { video_owner: { name: "Creator" } },
        },
      },
    }),
  ];

  assert.strictEqual(findReelContentNode(blocks).id, "42");
});

test("findReelContentNode also matches modern video-only creation_story", () => {
  const blocks = [
    block({
      creation_story: {
        id: "7",
        videoDeliveryResponseFragment: {
          videoDeliveryResponseResult: {
            progressive_urls: [{ progressive_url: "https://video.fbcdn.net/r.mp4" }],
          },
        },
      },
    }),
  ];

  assert.strictEqual(findReelContentNode(blocks).id, "7");
});

test("ownerFromNode prefers short_form_video_context.video_owner", () => {
  const node = {
    short_form_video_context: { video_owner: { name: "Right" } },
    owner: { name: "Wrong" },
  };
  assert.strictEqual(ownerFromNode(node).name, "Right");
});

test("parseReelContent gathers url, date and text from any block", () => {
  const blocks = [
    block({
      creation_story: {
        id: "42",
        videoDeliveryResponseFragment: {
          videoDeliveryResponseResult: {
            progressive_urls: [
              { progressive_url: "https://video.fbcdn.net/hd.mp4", metadata: { quality: "HD" } },
            ],
          },
        },
      },
    }),
    block({ short_form_video_context: { shareable_url: "https://www.facebook.com/reel/42" } }),
    block({ creation_time: 1750000000 }),
    block({ message: { text: "reel caption" } }),
    block({ owner: { name: "Creator", id: "9" } }),
  ];

  const reel = parseReelContent(blocks);
  assert.strictEqual(reel.authorName, "Creator");
  assert.deepStrictEqual(reel.videoCandidates, ["https://video.fbcdn.net/hd.mp4"]);
  assert.strictEqual(reel.postUrl, "https://www.facebook.com/reel/42");
  assert.strictEqual(reel.postDate, 1750000000);
  assert.strictEqual(reel.text, "reel caption");
});

const { cleanFacebookUrl, extractShareUrl } = require("../utils/facebook");

test("cleanFacebookUrl strips tracking params and keeps real ones", () => {
  const cleaned = cleanFacebookUrl(
    "https://www.facebook.com/story.php?story_fbid=123&id=456&mibextid=wwXIfr&__cft__%5B0%5D=abc&paipv=0"
  );
  assert.ok(cleaned.includes("story_fbid=123"));
  assert.ok(cleaned.includes("id=456"));
  assert.ok(!cleaned.includes("mibextid"));
  assert.ok(!cleaned.includes("__cft__"));
  assert.ok(!cleaned.includes("paipv"));
});

test("cleanFacebookUrl returns input unchanged when unparseable", () => {
  assert.strictEqual(cleanFacebookUrl("not a url"), "not a url");
});

test("extractShareUrl unwraps a facebook share_url and ignores foreign hosts", () => {
  assert.strictEqual(
    extractShareUrl(
      "https://www.facebook.com/reel/123/?share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fr%2Fabc%2F"
    ),
    "https://www.facebook.com/share/r/abc/"
  );
  assert.strictEqual(
    extractShareUrl("https://www.facebook.com/reel/123/?share_url=https%3A%2F%2Fevil.example%2Fx"),
    null
  );
  assert.strictEqual(extractShareUrl("https://www.facebook.com/reel/123/"), null);
});
