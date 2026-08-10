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

const { classifyFacebookUrl, targetVideoId, parseWatchContent } = require("../utils/facebook");

test("classifyFacebookUrl rewrites bare /videos/<id> to a reel", () => {
  const out = classifyFacebookUrl("https://www.facebook.com/videos/123456");
  assert.strictEqual(out.kind, "reel");
  assert.strictEqual(out.url, "https://www.facebook.com/reel/123456");
});

test("classifyFacebookUrl keeps page video posts on the watch parser", () => {
  const out = classifyFacebookUrl("https://www.facebook.com/somepage/videos/some-title/123456/");
  assert.strictEqual(out.kind, "watch");
  assert.strictEqual(out.url, "https://www.facebook.com/somepage/videos/some-title/123456/");

  assert.strictEqual(classifyFacebookUrl("https://www.facebook.com/watch/?v=99").kind, "watch");
  assert.strictEqual(classifyFacebookUrl("https://www.facebook.com/reel/99").kind, "reel");
  assert.strictEqual(classifyFacebookUrl("https://www.facebook.com/photo/?fbid=99").kind, "photo");
  assert.strictEqual(classifyFacebookUrl("https://www.facebook.com/page/posts/99").kind, "post");
});

test("targetVideoId reads ?v= and the last numeric path segment", () => {
  assert.strictEqual(targetVideoId("https://www.facebook.com/watch/?v=2000020650901604"), "2000020650901604");
  assert.strictEqual(targetVideoId("https://www.facebook.com/page/videos/some-title/123456/"), "123456");
  assert.strictEqual(targetVideoId("https://www.facebook.com/page/videos/some-title/"), null);
});

test("parseWatchContent prefers the requested video over a related one", () => {
  const blocks = [
    block({
      result: {
        data: {
          id: "999",
          title: { text: "related" },
          feedback: { comment_rendering_instance: {}, video_view_count_renderer: {} },
        },
      },
    }),
    block({
      result: {
        data: {
          id: "123",
          title: { text: "requested" },
          owner: { name: "Right Page" },
          feedback: {
            comment_rendering_instance: {},
            video_view_count_renderer: {},
            reaction_count: { count: 19 },
            total_comment_count: 77,
          },
          videoDeliveryResponseFragment: {
            videoDeliveryResponseResult: {
              progressive_urls: [{ progressive_url: "https://video.fbcdn.net/right.mp4" }],
            },
          },
        },
      },
    }),
    block({ creation_time: 1750000000 }),
  ];

  const watch = parseWatchContent(blocks, "123", {});
  assert.strictEqual(watch.text, "requested");
  assert.strictEqual(watch.authorName, "Right Page");
  assert.deepStrictEqual(watch.videoCandidates, ["https://video.fbcdn.net/right.mp4"]);
  assert.strictEqual(watch.likes, "19");
  assert.strictEqual(watch.comments, "77");
  assert.strictEqual(watch.postDate, 1750000000);
});

test("parseWatchContent reports the generic watch feed distinctly", () => {
  assert.throws(
    () => parseWatchContent([], "123", { canonicalUrl: "https://www.facebook.com/watch/" }),
    /generic watch feed/
  );
});

const { parseStoriesContent } = require("../utils/facebook");

test("parseStoriesContent reads a video story with its preview", () => {
  const blocks = [
    block({
      data: {
        bucket: {
          owner: { id: "9", name: "Story Owner" },
          unified_stories_with_notes: {
            edges: [
              {
                node: {
                  creation_time: 1750000000,
                  story_card_info: {
                    permalink_info: { uri: "https://www.facebook.com/stories/9/abc" },
                  },
                  attachments: [
                    {
                      media: {
                        playable_url: "https://video.fbcdn.net/story.mp4",
                        preferred_thumbnail: { image: { uri: "https://img.fbcdn.net/story.jpg" } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    }),
  ];

  const story = parseStoriesContent(blocks);
  assert.strictEqual(story.authorName, "Story Owner");
  assert.strictEqual(story.postUrl, "https://www.facebook.com/stories/9/abc");
  assert.strictEqual(story.postDate, 1750000000);
  assert.deepStrictEqual(story.videoCandidates, ["https://video.fbcdn.net/story.mp4"]);
  assert.deepStrictEqual(story.imageLinks, []);
  assert.strictEqual(story.thumbnail, "https://img.fbcdn.net/story.jpg");
});

test("parseStoriesContent reads a photo story", () => {
  const blocks = [
    block({
      bucket: {
        owner: { name: "Owner" },
        unified_stories_with_notes: {
          edges: [
            { node: { attachments: [{ media: { image: { uri: "https://img.fbcdn.net/s.jpg" } } }] } },
          ],
        },
      },
    }),
  ];

  const story = parseStoriesContent(blocks);
  assert.deepStrictEqual(story.imageLinks, ["https://img.fbcdn.net/s.jpg"]);
  assert.deepStrictEqual(story.videoCandidates, []);
});

test("parseStoriesContent reports expired stories distinctly", () => {
  assert.throws(() => parseStoriesContent([block({ nothing: true })]), /expired or restricted/);
});

const { parsePhotocomContent } = require("../utils/facebook");

test("parsePhotocomContent reads comment body, image and reaction count", () => {
  const blocks = [
    block({
      attached_comment: {},
      result: {
        data: {
          owner: { id: "55", name: "Comment Owner" },
          created_time: 1750000000,
          attached_comment: { preferred_body: { text: "look at this" } },
        },
      },
    }),
    block({
      attached_comment: {},
      unified_reactors: { count: 5 },
      currMedia: {
        image: { uri: "https://img.fbcdn.net/comment.jpg" },
        attached_comment: { feedback: { url: "https://www.facebook.com/c" } },
      },
    }),
  ];

  const post = parsePhotocomContent(blocks);
  assert.strictEqual(post.authorName, "Comment Owner (\u{1F4AC})");
  assert.strictEqual(post.text, "look at this");
  assert.deepStrictEqual(post.imageLinks, ["https://img.fbcdn.net/comment.jpg"]);
  assert.strictEqual(post.postUrl, "https://www.facebook.com/c");
  assert.strictEqual(post.likes, "5");
  assert.strictEqual(post.postDate, 1750000000);
});

test("classifyFacebookUrl gives type=3 photos top priority", () => {
  assert.strictEqual(
    classifyFacebookUrl("https://www.facebook.com/photo.php?fbid=1&type=3").kind,
    "photocom"
  );
});

const { parseSinglePhotoContent } = require("../utils/facebook");

test("parseSinglePhotoContent takes the longest caption and the prefetch image", () => {
  const blocks = [
    block({
      message_preferred_body: {},
      container_story: {},
      data: {
        owner: { id: "44", name: "Photog" },
        created_time: 1750000000,
        message: { text: "Short preview..." },
        message_preferred_body: { text: "Full caption with every paragraph preserved." },
        container_story: { message: { text: "Medium caption" } },
      },
      prefetch_uris_v2: [{ uri: "https://img.fbcdn.net/single.jpg" }],
    }),
    block({
      comet_ufi_summary_and_actions_renderer: {
        feedback: {
          i18n_reaction_count: "12",
          i18n_share_count: "3",
          comment_rendering_instance: { comments: { total_count: 4 } },
        },
      },
    }),
  ];

  const photo = parseSinglePhotoContent(blocks);
  assert.strictEqual(photo.authorName, "Photog");
  assert.strictEqual(photo.text, "Full caption with every paragraph preserved.");
  assert.deepStrictEqual(photo.imageLinks, ["https://img.fbcdn.net/single.jpg"]);
  assert.strictEqual(photo.likes, "12");
  assert.strictEqual(photo.comments, "4");
  assert.strictEqual(photo.shares, "3");
  assert.strictEqual(photo.postDate, 1750000000);
});
