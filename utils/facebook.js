const axios = require("axios");

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const REQUEST_TIMEOUT = 30000;

const decodeHtmlEntitiesFull = (str) => {
  if (!str) return "";
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
};

const parseMetaTags = (html) => {
  const meta = {
    ogType: null,
    ogTitle: null,
    ogDescription: null,
    ogUrl: null,
    ogImage: null,
    ogImageAlt: null,
    canonicalUrl: null,
    twitterTitle: null,
    twitterDescription: null,
    twitterImage: null,
    description: null,
    title: null,
  };

  const ogTypeMatch = html.match(/<meta\s+property="og:type"\s+content="([^"]+)"/i);
  if (ogTypeMatch) meta.ogType = decodeHtmlEntitiesFull(ogTypeMatch[1]);

  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  if (ogTitleMatch) meta.ogTitle = decodeHtmlEntitiesFull(ogTitleMatch[1]);

  const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  if (ogDescMatch) meta.ogDescription = decodeHtmlEntitiesFull(ogDescMatch[1]);

  const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i);
  if (ogUrlMatch) meta.ogUrl = decodeHtmlEntitiesFull(ogUrlMatch[1]);

  const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (ogImageMatch) meta.ogImage = decodeHtmlEntitiesFull(ogImageMatch[1]);

  const ogImageAltMatch = html.match(/<meta\s+property="og:image:alt"\s+content="([^"]+)"/i);
  if (ogImageAltMatch) meta.ogImageAlt = decodeHtmlEntitiesFull(ogImageAltMatch[1]);

  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  if (canonicalMatch) meta.canonicalUrl = decodeHtmlEntitiesFull(canonicalMatch[1]);

  const twitterTitleMatch = html.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i);
  if (twitterTitleMatch) meta.twitterTitle = decodeHtmlEntitiesFull(twitterTitleMatch[1]);

  const twitterDescMatch = html.match(/<meta\s+name="twitter:description"\s+content="([^"]+)"/i);
  if (twitterDescMatch) meta.twitterDescription = decodeHtmlEntitiesFull(twitterDescMatch[1]);

  const twitterImageMatch = html.match(/<meta\s+name="twitter:image"\s+content="([^"]+)"/i);
  if (twitterImageMatch) meta.twitterImage = decodeHtmlEntitiesFull(twitterImageMatch[1]);

  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  if (descMatch) meta.description = decodeHtmlEntitiesFull(descMatch[1]);

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) meta.title = decodeHtmlEntitiesFull(titleMatch[1]);

  return meta;
};

const detectPostType = (ogType) => {
  if (!ogType) return 'unknown';
  
  if (ogType.includes('video')) return 'video';
  if (ogType.includes('photo') || ogType.includes('image')) return 'photo';
  if (ogType === 'article' || ogType === 'website') return 'article';
  
  return 'unknown';
};

/// Query keys Facebook adds for sharing/attribution. facebed-rusty: url_clean.rs.
const TRACKING_PARAMS = new Set([
  "fs", "mibextid", "rdid", "share_url", "paipv", "_rdr", "eav", "refsrc",
  "_ft_", "__tn__", "__cft__", "__xts__", "fref", "hc_ref", "hc_location",
  "notif_id", "notif_t", "ref", "sfnsn", "wtsid",
]);

const cleanFacebookUrl = (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || key.startsWith("__cft__") || key.startsWith("__xts__")) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
};

/// Mobile sometimes wraps the real post in ?share_url=<encoded>.
const extractShareUrl = (rawUrl) => {
  try {
    const wrapped = new URL(rawUrl).searchParams.get("share_url");
    if (wrapped && /^https?:\/\/(www\.|m\.)?facebook\.com\//.test(wrapped)) {
      return cleanFacebookUrl(wrapped);
    }
  } catch {}
  return null;
};

/// The video the user actually asked for: ?v= on /watch, else the last numeric
/// path segment. facebed-rusty: parsers/video_watch.rs.
const targetVideoId = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.pathname.replace(/^\//, "").startsWith("watch")) {
    const v = parsed.searchParams.get("v");
    if (v && /^\d+$/.test(v)) return v;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(segments[i])) return segments[i];
  }
  return null;
};

/// Which parser handles this URL, and the URL to fetch. facebed-rusty: routes.rs.
/// Only BARE /videos/<id> becomes a reel — <page>/videos/<slug>/<id> is a real
/// video viewer page and needs the watch parser.
const classifyFacebookUrl = (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: "post", url: rawUrl };
  }
  const path = parsed.pathname;

  if (parsed.searchParams.getAll("type").some((t) => t.includes("3"))) {
    return { kind: "photocom", url: rawUrl };
  }
  if (parsed.searchParams.get("comment_id")) return { kind: "comment", url: rawUrl };
  if (/^\/stories\/\d+\/[A-Za-z0-9=_-]+/.test(path)) return { kind: "stories", url: rawUrl };

  const bareVideo = path.match(/^\/videos\/(?:[^/]+\/)?(\d+)/);
  if (bareVideo) {
    parsed.pathname = `/reel/${bareVideo[1]}`;
    return { kind: "reel", url: parsed.toString() };
  }
  if (/^\/reel\/\d+/.test(path)) return { kind: "reel", url: rawUrl };
  if (/^\/photo(\.php)?\/?$/.test(path)) return { kind: "photo", url: rawUrl };
  if (/^\/watch/.test(path) || /^\/[a-zA-Z0-9\-._]+\/videos\/(?:[^/]+\/)?\d+/.test(path)) {
    return { kind: "watch", url: rawUrl };
  }
  return { kind: "post", url: rawUrl };
};

/// Group posts are the only place facebed trusts author markdown.
const isGroupPostUrl = (rawUrl) => {
  try {
    return new URL(rawUrl).pathname.startsWith("/groups/");
  } catch {
    return false;
  }
};

const parseGroupPostUrl = (url) => {
  if (!url) return null;
  
  const groupPostMatch = url.match(/\/groups\/(\d+)\/(posts|permalink)\/(\d+|pfbid[a-zA-Z0-9]+)/);
  if (groupPostMatch) {
    return {
      groupId: groupPostMatch[1],
      postId: groupPostMatch[3],
      isGroup: true,
    };
  }
  
  const groupNamePostMatch = url.match(/\/groups\/([^/]+)\/(posts|permalink)\/(\d+|pfbid[a-zA-Z0-9]+)/);
  if (groupNamePostMatch) {
    return {
      groupName: groupNamePostMatch[1],
      postId: groupNamePostMatch[3],
      isGroup: true,
    };
  }
  
  return null;
};

const extractGroupNameFromTitle = (ogTitle) => {
  if (!ogTitle) return null;
  
  const parts = ogTitle.split('|').map(p => p.trim());
  if (parts.length >= 2) {
    const groupName = parts[0];
    if (groupName.toLowerCase() !== 'facebook') {
      return groupName;
    }
  }
  
  return null;
};

const extractMobilePostInfo = (html) => {
  const meta = parseMetaTags(html);
  const postType = detectPostType(meta.ogType);
  const groupInfo = parseGroupPostUrl(meta.ogUrl || meta.canonicalUrl);
  const groupName = extractGroupNameFromTitle(meta.ogTitle);
  
  return {
    meta,
    postType,
    groupInfo,
    groupName,
    isVideo: postType === 'video',
    isPhoto: postType === 'photo',
    isGroupPost: groupInfo?.isGroup || false,
    thumbnailUrl: meta.ogImage,
    description: meta.ogDescription || meta.description,
    title: meta.ogTitle || meta.title,
    url: meta.ogUrl || meta.canonicalUrl,
  };
};

const collectObjects = (obj) => {
  const result = [];
  
  const collect = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result.push(value);
      for (const v of Object.values(value)) {
        if (Array.isArray(v)) collect(v);
      }
      for (const v of Object.values(value)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) collect(v);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) collect(item);
      }
      for (const item of value) {
        if (Array.isArray(item)) collect(item);
      }
    }
  };
  
  collect(obj);
  return result;
};

const findByKey = (obj, key, first = false) => {
  const result = [];
  for (const oo of collectObjects(obj)) {
    if (key in oo) {
      if (first) return oo[key];
      result.push(oo[key]);
    }
  }
  // Miss on a first-only lookup must be undefined, not []. Returning [] made
  // hasKeys() unconditionally true, so every block-selection check in this file
  // silently accepted whichever block came first.
  return first ? undefined : result;
};

const findAllByKey = (obj, key) => findByKey(obj, key, false);
const findFirstByKey = (obj, key) => findByKey(obj, key, true);

function hasKeys(obj, ...keys) {
  return keys.every(key => findFirstByKey(obj, key) !== undefined);
}

function findLastByKey(obj, key) {
  const results = findAllByKey(obj, key);
  if (results.length === 0) return undefined;
  return results[results.length - 1];
}

const QUALITY_RANK = { HD: 0, SD: 1 };

/// Every playable URL under `node`, best-quality-first. Mirrors facebed-rusty
/// video_link_in_node (parsers/util.rs) but keeps ALL variants so an oversized
/// HD file can fall back to SD instead of being dropped.
const videoCandidatesInNode = (node) => {
  const out = [];
  const push = (url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url) && !out.includes(url)) {
      out.push(url);
    }
  };

  for (const fragment of findAllByKey(node, "videoDeliveryResponseFragment")) {
    for (const list of findAllByKey(fragment, "progressive_urls")) {
      if (!Array.isArray(list)) continue;
      const ranked = [...list].sort(
        (a, b) =>
          (QUALITY_RANK[a?.metadata?.quality] ?? 2) - (QUALITY_RANK[b?.metadata?.quality] ?? 2)
      );
      for (const entry of ranked) push(entry?.progressive_url);
    }
  }

  for (const legacy of findAllByKey(node, "videoDeliveryLegacyFields")) {
    if (!legacy || typeof legacy !== "object") continue;
    push(findFirstByKey(legacy, "browser_native_hd_url"));
    push(findFirstByKey(legacy, "browser_native_sd_url"));
  }

  push(findFirstByKey(node, "playable_url_quality_hd"));
  push(findFirstByKey(node, "playable_url"));

  return out;
};

const videoLinkInNode = (node) => videoCandidatesInNode(node)[0] ?? null;

/// Best-effort preview image for a video node.
const thumbnailInNode = (node) => {
  const paths = [
    ["preferred_thumbnail", "image", "uri"],
    ["thumbnailImage", "uri"],
    ["image", "uri"],
  ];
  for (const path of paths) {
    let cur = node;
    for (const seg of path) cur = cur?.[seg];
    if (typeof cur === "string" && cur) return cur;
  }
  for (const key of ["preferred_thumbnail", "thumbnailImage"]) {
    const t = findFirstByKey(node, key);
    const uri = t?.image?.uri || t?.uri;
    if (typeof uri === "string" && uri) return uri;
  }
  return null;
};

function humanFormat(num) {
  if (num === null || num === undefined) return null;
  if (typeof num === 'number' || /^\d+$/.test(String(num))) {
    num = parseFloat(parseFloat(num).toPrecision(3));
    let magnitude = 0;
    while (Math.abs(num) >= 1000) {
      magnitude += 1;
      num /= 1000.0;
    }
    const suffixes = ['', 'K', 'M', 'B', 'T'];
    const formatted = parseFloat(num.toFixed(6)).toString();
    return `${formatted}${suffixes[magnitude]}`;
  }
  return String(num);
}

const getJsonBlocks = (html, sort = true) => {
  const blocks = [];
  const scriptPattern = /<script[^>]*type="application\/json"[^>]*data-content-len="(\d+)"[^>]*data-sjs[^>]*>([^<]+)<\/script>/gi;
  let match;
  
  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const contentLen = parseInt(match[1], 10);
      const jsonContent = match[2];
      blocks.push({ contentLen, json: jsonContent, parsed: null });
    } catch (e) {}
  }
  
  const altPattern = /<script[^>]*data-sjs[^>]*data-content-len="(\d+)"[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/gi;
  while ((match = altPattern.exec(html)) !== null) {
    try {
      const contentLen = parseInt(match[1], 10);
      const jsonContent = match[2];
      if (!blocks.some(b => b.json === jsonContent)) {
        blocks.push({ contentLen, json: jsonContent, parsed: null });
      }
    } catch (e) {}
  }
  
  if (sort) {
    blocks.sort((a, b) => b.contentLen - a.contentLen);
  }
  
  return blocks.map(b => {
    if (!b.parsed) {
      try {
        b.parsed = JSON.parse(b.json);
      } catch (e) {
        b.parsed = null;
      }
    }
    return { ...b };
  }).filter(b => b.parsed !== null);
};

const POST_ID_RE =
  /\/posts\/(?:[^/?]+\/)?([A-Za-z0-9]+)|\/permalink\/([A-Za-z0-9]+)|[?&]story_fbid=([A-Za-z0-9]+)|[?&]multi_permalinks=([A-Za-z0-9]+)|\/videos\/(?:[^/?]+\/)?([A-Za-z0-9]+)|\/reel\/([A-Za-z0-9]+)/;

const extractPostId = (pathOrUrl) => {
  const match = POST_ID_RE.exec(pathOrUrl || '');
  return match ? match.slice(1).find(Boolean) || null : null;
};

const isValidPostId = (id) => typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id);

/// The post id a story's own wwwURL points at. facebed-rusty: json_post.rs.
const canonicalStoryPostId = (storyUrl) => {
  let parsed;
  try {
    parsed = new URL(storyUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/.test(parsed.hostname)) return null;

  const segments = parsed.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  const [a, b, c, d] = segments;

  if (a === 'groups' && (c === 'posts' || c === 'permalink') && segments.length === 4) {
    return isValidPostId(d) ? d : null;
  }
  if (a !== 'groups' && b === 'posts' && segments.length === 3) return isValidPostId(c) ? c : null;
  if (a !== 'groups' && b === 'posts' && segments.length === 4) return isValidPostId(d) ? d : null;
  if (a === 'permalink' && segments.length === 2) return isValidPostId(b) ? b : null;
  if (segments.length === 1 && (a === 'story.php' || a === 'permalink.php')) {
    const id = parsed.searchParams.get('story_fbid');
    return isValidPostId(id) ? id : null;
  }
  if (a === 'groups' && segments.length === 2) {
    const id = parsed.searchParams.get('multi_permalinks');
    return isValidPostId(id) ? id : null;
  }
  return null;
};

const canonicalPagePostId = (meta) =>
  canonicalStoryPostId(meta?.canonicalUrl || '') || canonicalStoryPostId(meta?.ogUrl || '');

const storyMatchesPostId = (story, postId) =>
  String(story?.post_id ?? '') === String(postId) ||
  (typeof story?.wwwURL === 'string' && canonicalStoryPostId(story.wwwURL) === String(postId));

/// Pick the block holding the REQUESTED story. Pages with several stories
/// (group feeds, related posts) otherwise hand back whichever came first.
/// Deviation from facebed: it returns nothing when an id is given and no block
/// matches; we still fall back to the first reaction block, so a Facebook shape
/// change degrades instead of breaking.
function getPostJson(jsonBlocks, postId, canonicalPostId) {
  if (postId) {
    for (const block of jsonBlocks) {
      const mentionsCandidate =
        block.json.includes(postId) || (canonicalPostId && block.json.includes(canonicalPostId));
      if (!mentionsCandidate) continue;

      let story;
      try {
        story = getRootNode(block.parsed)?.content?.story;
      } catch (e) {
        continue;
      }
      if (!story) continue;
      if (
        storyMatchesPostId(story, postId) ||
        (canonicalPostId && storyMatchesPostId(story, canonicalPostId))
      ) {
        return block.parsed;
      }
    }
  }

  for (const block of jsonBlocks) {
    if (hasKeys(block.parsed, 'i18n_reaction_count')) {
      return block.parsed;
    }
  }
  throw new Error('cannot find post json');
}

function getRootNode(postJson) {
  const workNormalPost = () => {
    const dataBlob = findFirstByKey(postJson, 'data');
    if (!dataBlob || typeof dataBlob !== 'object') return null;
    if ('comet_ufi_summary_and_actions_renderer' in dataBlob) {
      return dataBlob;
    }
    if ('node_v2' in dataBlob && dataBlob.node_v2?.comet_sections) {
      return dataBlob.node_v2.comet_sections;
    }
    if ('node' in dataBlob && dataBlob.node?.comet_sections) {
      return dataBlob.node.comet_sections;
    }
    return null;
  };

  const workGroupPost = () => {
    const hoistedFeed = findFirstByKey(postJson, 'group_hoisted_feed');
    if (!hoistedFeed) return null;
    const cometSection = findFirstByKey(hoistedFeed, 'comet_sections');
    return cometSection || null;
  };

  const methods = [workNormalPost, workGroupPost];

  for (const method of methods) {
    try {
      const ret = method();
      if (ret) return ret;
    } catch (e) {
      continue;
    }
  }

  throw new Error('Cannot process post - no root node found');
}

/// Newer pages zero out the legacy i18n_* fields and put the real numbers in
/// feedback.adaptive_ufi_action_renderers[]. facebed-rusty: parsers/util.rs.
function getInteractionCounts(postJson, postId) {
  const renderers = findAllByKey(postJson, 'comet_ufi_summary_and_actions_renderer');
  const focal =
    (postId &&
      renderers.find(
        (r) => String(r?.feedback?.subscription_target_id ?? '') === String(postId)
      )) ||
    renderers[0];

  const fb = focal?.feedback;
  if (!fb) return { likes: null, comments: null, shares: null };

  const adaptive = Array.isArray(fb.adaptive_ufi_action_renderers)
    ? fb.adaptive_ufi_action_renderers
    : [];
  const fromAdaptive = (key, pick) => {
    for (const item of adaptive) {
      const value = pick(findFirstByKey(item, key));
      if (value != null) return humanFormat(value);
    }
    return null;
  };

  const likes =
    fromAdaptive('reaction_count', (n) => n?.count) ??
    (fb.i18n_reaction_count != null ? String(fb.i18n_reaction_count) : null);
  const shares =
    fromAdaptive('share_count', (n) => n?.count) ??
    (fb.i18n_share_count != null ? String(fb.i18n_share_count) : null);
  const comments =
    fromAdaptive('comment_rendering_instance', (n) => n?.comments?.total_count) ??
    (fb.comment_rendering_instance?.comments?.total_count != null
      ? String(fb.comment_rendering_instance.comments.total_count)
      : null);

  return { likes, comments, shares };
}

function getGroupNameFromJson(jsonBlocks) {
  for (const block of jsonBlocks) {
    if (hasKeys(block.parsed, 'group_member_profiles', 'formatted_count_text')) {
      const groupObjects = findAllByKey(block.parsed, 'group');
      for (const groupObj of groupObjects) {
        if (groupObj && typeof groupObj === 'object' && 'name' in groupObj) {
          return groupObj.name;
        }
      }
    }
  }
  return null;
}

function extractAuthorAndText(rootNode) {
  const result = { authorName: null, text: '', imageLinks: [], videoLinks: [], postUrl: null };

  try {
    const story = rootNode?.content?.story;
    if (!story) return result;

    if (story.actors && story.actors.length > 0) {
      result.authorName = story.actors[0].name || null;
    }

    if (story.message && story.message.text) {
      result.text = story.message.text;
    }

    result.postUrl = story.wwwURL || null;

    const linkCard = extractLinkCard(story);
    if (linkCard.url) {
      result.text += linkCard.title ? `\n🔗 ${linkCard.title}: ${linkCard.url}` : `\n🔗 ${linkCard.url}`;
    }

    const extractMediaFromStory = (storyNode) => {
      const imgs = [];
      const vids = [];

      const allAttachments = findAllByKey(storyNode, 'attachment');
      for (const attachmentSet of allAttachments) {
        const hasSubattachments = Object.keys(attachmentSet).some(k => k.endsWith('subattachments'));

        if (hasSubattachments) {
          const subsets = Object.entries(attachmentSet)
            .filter(([k, v]) => k.endsWith('subattachments') && v && v.nodes)
            .map(([_, v]) => v);

          if (subsets.length > 0) {
            const maxImageCount = Math.max(...subsets.map(s => s.nodes?.length || 0));
            const validSubsets = subsets.filter(subset =>
              subset.nodes?.length === maxImageCount &&
              findAllByKey(subset, 'viewer_image').length > 0
            );

            if (validSubsets.length > 0) {
              const viewerImages = findAllByKey(validSubsets[0], 'viewer_image');
              for (const img of viewerImages) {
                if (img && img.uri && !imgs.includes(img.uri)) {
                  imgs.push(img.uri);
                }
              }
            }
          }
        } else if (attachmentSet.media && !JSON.stringify(attachmentSet).includes("'__typename': 'Sticker'")) {
          const photoImages = findAllByKey(attachmentSet, 'photo_image');
          for (const img of photoImages) {
            if (img && img.uri && !imgs.includes(img.uri)) {
              imgs.push(img.uri);
            }
          }
        }

        const candidates = videoCandidatesInNode(attachmentSet);
        if (candidates.length > 0 && !vids.some((entry) => entry[0] === candidates[0])) {
          vids.push(candidates);
        }
      }

      if (imgs.length === 0) {
        const resolvers = findAllByKey(storyNode, 'comet_photo_attachment_resolution_renderer');
        for (const resolver of resolvers) {
          if (resolver.image && resolver.image.uri && !imgs.includes(resolver.image.uri)) {
            imgs.push(resolver.image.uri);
          }
        }
      }

      if (imgs.length === 0) {
        const linkCardImage = extractLinkCardImage(storyNode);
        if (linkCardImage) imgs.push(linkCardImage);
      }

      return { imgs, vids };
    };

    const mainMedia = extractMediaFromStory(story);
    result.imageLinks.push(...mainMedia.imgs);
    result.videoLinks.push(...mainMedia.vids);

    if (story.attached_story && story.attached_story.actors) {
      const attachedStory = story.attached_story;
      const sharedAuthor = attachedStory.actors?.[0]?.name || '';
      const sharedText = (attachedStory.message && attachedStory.message.text) ? attachedStory.message.text : '';

      if (sharedAuthor || sharedText) {
        result.text += `\n╰┈➤ ${sharedAuthor}\n${sharedText}`;
      }

      if (!result.postUrl && attachedStory.wwwURL) {
        result.postUrl = attachedStory.wwwURL;
      }

      const sharedLinkCard = extractLinkCard(attachedStory);
      if (sharedLinkCard.url) {
        result.text += sharedLinkCard.title ? `\n🔗 ${sharedLinkCard.title}: ${sharedLinkCard.url}` : `\n🔗 ${sharedLinkCard.url}`;
      }

      const sharedMedia = extractMediaFromStory(attachedStory);
      for (const img of sharedMedia.imgs) {
        if (!result.imageLinks.includes(img)) result.imageLinks.push(img);
      }
      for (const vid of sharedMedia.vids) {
        if (!result.videoLinks.some((entry) => entry[0] === vid[0])) result.videoLinks.push(vid);
      }
    }
  } catch (e) {
    console.error('[Facebook] Error in extractAuthorAndText:', e.message);
  }

  return result;
}

function extractLinkCard(postJson) {
  const attachments = findAllByKey(postJson, 'attachment');
  for (const attachment of attachments) {
    const target = attachment?.target;
    if (!target || typeof target !== 'object' || !target.external_url) continue;
    const titleObj = attachment.title_with_entities;
    return {
      title: titleObj && typeof titleObj === 'object' ? titleObj.text || '' : '',
      url: target.external_url,
    };
  }
  return { title: '', url: '' };
}

function extractLinkCardImage(postJson) {
  const attachments = findAllByKey(postJson, 'attachment');
  for (const attachment of attachments) {
    const media = attachment?.media;
    if (!media || typeof media !== 'object') continue;
    for (const imgKey of ['large_share_image', 'flexible_height_share_image']) {
      const img = media[imgKey];
      if (img && typeof img === 'object' && img.uri) return img.uri;
    }
  }
  return '';
}

function extractPostDate(rootNode) {
  try {
    const metadata = rootNode?.context_layout?.story?.comet_sections?.metadata;
    if (!metadata) return null;
    const creationTime = findFirstByKey(metadata, 'creation_time');
    if (creationTime != null) return parseInt(creationTime, 10);
  } catch (e) {}
  return null;
}

/// Bug-1 fix: match creation_story on ANY modern video marker, not on the
/// long-gone browser_native_sd_url. facebed-rusty: parsers/reels.rs.
const findReelContentNode = (jsonBlocks) => {
  for (const block of jsonBlocks) {
    for (const cs of findAllByKey(block.parsed, 'creation_story')) {
      if (!cs || typeof cs !== 'object') continue;
      if (
        hasKeys(cs, 'short_form_video_context') ||
        findFirstByKey(cs, 'videoDeliveryResponseFragment') !== undefined ||
        findFirstByKey(cs, 'videoDeliveryLegacyFields') !== undefined ||
        findFirstByKey(cs, 'playable_url') !== undefined
      ) {
        return cs;
      }
    }
  }
  return null;
};

const ownerHasName = (owner) => typeof owner?.name === 'string' && owner.name.length > 0;

const ownerFromNode = (node) => {
  const ctxOwner = findFirstByKey(node, 'short_form_video_context')?.video_owner;
  if (ownerHasName(ctxOwner)) return ctxOwner;
  for (const key of ['video_owner', 'owner']) {
    if (ownerHasName(node?.[key])) return node[key];
  }
  for (const key of ['video_owner', 'owner']) {
    for (const owner of findAllByKey(node, key)) {
      if (ownerHasName(owner)) return owner;
    }
  }
  return null;
};

const blockMentionsId = (node, id) =>
  !!id && findAllByKey(node, 'id').some((value) => String(value) === String(id));

/// FB pages carry unrelated owner objects for sidebars and recommendations —
/// prefer the one attached to the matched video.
const findOwnerWithName = (jsonBlocks, contentNode, videoId) => {
  const direct = ownerFromNode(contentNode);
  if (direct) return direct;
  if (videoId) {
    for (const block of jsonBlocks) {
      if (!blockMentionsId(block.parsed, videoId)) continue;
      const owner = ownerFromNode(block.parsed);
      if (owner) return owner;
    }
  }
  for (const block of jsonBlocks) {
    const owner = ownerFromNode(block.parsed);
    if (owner) return owner;
  }
  return null;
};

const findShareableUrl = (jsonBlocks) => {
  for (const block of jsonBlocks) {
    for (const ctx of findAllByKey(block.parsed, 'short_form_video_context')) {
      if (typeof ctx?.shareable_url === 'string' && ctx.shareable_url) return ctx.shareable_url;
    }
  }
  return null;
};

const findCreationTime = (jsonBlocks) => {
  for (const block of jsonBlocks) {
    for (const ct of findAllByKey(block.parsed, 'creation_time')) {
      const parsedTime = parseInt(ct, 10);
      if (!Number.isNaN(parsedTime)) return parsedTime;
    }
  }
  return null;
};

const findMessageText = (jsonBlocks) => {
  for (const block of jsonBlocks) {
    for (const msg of findAllByKey(block.parsed, 'message')) {
      if (typeof msg?.text === 'string' && msg.text) return msg.text;
    }
  }
  return '';
};

const findVideoCandidates = (jsonBlocks, contentNode) => {
  const fromContent = videoCandidatesInNode(contentNode);
  if (fromContent.length > 0) return fromContent;
  for (const block of jsonBlocks) {
    const candidates = videoCandidatesInNode(block.parsed);
    if (candidates.length > 0) return candidates;
  }
  return [];
};

function parseReelContent(jsonBlocks) {
  const contentNode = findReelContentNode(jsonBlocks);
  if (!contentNode) throw new Error('Invalid reels link (cn)');

  const videoId = contentNode.id;
  const videoCandidates = findVideoCandidates(jsonBlocks, contentNode);
  if (videoCandidates.length === 0) throw new Error('Invalid reels link (vn)');

  const ownerInfo = findOwnerWithName(jsonBlocks, contentNode, videoId);
  if (!ownerInfo) throw new Error('Invalid reels link (owner)');

  const isIg = ownerInfo.__typename?.startsWith('InstagramUser') || false;
  const opName = isIg && ownerInfo.username ? `📷 @${ownerInfo.username}` : ownerInfo.name;

  const postUrl =
    contentNode.short_form_video_context?.shareable_url || findShareableUrl(jsonBlocks) || null;
  const postDate =
    (contentNode.creation_time != null ? parseInt(contentNode.creation_time, 10) : null) ??
    findCreationTime(jsonBlocks);
  const postText = contentNode.message?.text || findMessageText(jsonBlocks);

  let likes = null;
  let comments = null;
  let shares = null;

  try {
    const reactionBlocks = jsonBlocks
      .filter((block) => hasKeys(block.parsed, 'unified_reactors'))
      .filter((block) => blockMentionsId(block.parsed, videoId))
      .map((block) => block.parsed);

    if (reactionBlocks.length > 0) {
      const bloc = reactionBlocks[0];
      let firstFb = findFirstByKey(bloc, 'feedback');
      let lastFb = findLastByKey(bloc, 'feedback');

      if (firstFb && lastFb) {
        if (JSON.stringify(firstFb).includes('cross_universe_feedback_info')) {
          const temp = firstFb;
          firstFb = lastFb;
          lastFb = temp;
        }

        const reactorCount = firstFb.unified_reactors?.count;
        if (reactorCount != null) likes = humanFormat(reactorCount);

        if (isIg && lastFb.cross_universe_feedback_info) {
          const igCmts = lastFb.cross_universe_feedback_info.ig_comment_count;
          if (igCmts != null) comments = humanFormat(igCmts);
        } else if (lastFb.total_comment_count != null) {
          comments = humanFormat(lastFb.total_comment_count);
        }

        if (lastFb.share_count_reduced != null) shares = humanFormat(lastFb.share_count_reduced);
      }
    }
  } catch (e) {
    console.error('[Facebook] Error getting reel reaction counts:', e.message);
  }

  return {
    authorName: opName,
    text: postText,
    postUrl,
    postDate: postDate ?? null,
    videoCandidates,
    thumbnail: thumbnailInNode(contentNode),
    likes,
    comments,
    shares,
  };
}

const watchContentNode = (jsonBlocks, videoId) => {
  const hasWatchKeys = (data) =>
    data && hasKeys(data, 'comment_rendering_instance', 'video_view_count_renderer');

  if (videoId) {
    for (const block of jsonBlocks) {
      const data = findFirstByKey(block.parsed, 'result')?.data;
      if (hasWatchKeys(data) && blockMentionsId(data, videoId)) return data;
    }
  }
  for (const block of jsonBlocks) {
    if (!hasKeys(block.parsed, 'comment_rendering_instance', 'video_view_count_renderer')) continue;
    const data = findFirstByKey(block.parsed, 'result')?.data;
    if (data) return data;
  }
  return null;
};

const watchOwnerInNode = (node) => {
  const keys = ['video_owner', 'owner', 'owning_profile', 'owner_as_page'];
  for (const key of keys) {
    if (ownerHasName(node?.[key])) return node[key];
    if (ownerHasName(node?.[key]?.owner_as_page)) return node[key].owner_as_page;
  }
  for (const key of keys) {
    for (const owner of findAllByKey(node, key)) {
      if (ownerHasName(owner)) return owner;
      if (ownerHasName(owner?.owner_as_page)) return owner.owner_as_page;
    }
  }
  for (const actors of findAllByKey(node, 'actors')) {
    if (!Array.isArray(actors)) continue;
    for (const actor of actors) {
      if (ownerHasName(actor)) return actor;
    }
  }
  return null;
};

const watchOwner = (jsonBlocks, contentNode, videoId) => {
  const direct = watchOwnerInNode(contentNode);
  if (direct) return direct;
  if (videoId) {
    for (const block of jsonBlocks) {
      if (!blockMentionsId(block.parsed, videoId)) continue;
      const owner = watchOwnerInNode(block.parsed);
      if (owner) return owner;
    }
  }
  for (const block of jsonBlocks) {
    if (!hasKeys(block.parsed, 'is_additional_profile_plus')) continue;
    const owner = findFirstByKey(block.parsed, 'owner');
    if (ownerHasName(owner)) return owner;
  }
  for (const block of jsonBlocks) {
    const owner = findFirstByKey(block.parsed, 'owner');
    if (ownerHasName(owner)) return owner;
  }
  return null;
};

function parseWatchContent(jsonBlocks, videoId, meta = {}) {
  const contentData = watchContentNode(jsonBlocks, videoId);
  if (!contentData) {
    // FB sometimes serves the generic /watch feed instead of the requested
    // video. Distinct message so callers can tell "no data" from "broken parse".
    if (/^https?:\/\/[^/]+\/watch\/?$/.test(meta.canonicalUrl || '')) {
      throw new Error('Facebook served the generic watch feed, not this video');
    }
    throw new Error('Invalid watch link (cn)');
  }

  let videoCandidates = videoCandidatesInNode(contentData);
  if (videoCandidates.length === 0 && videoId) {
    for (const block of jsonBlocks) {
      if (!blockMentionsId(block.parsed, videoId)) continue;
      videoCandidates = videoCandidatesInNode(block.parsed);
      if (videoCandidates.length > 0) break;
    }
  }
  if (videoCandidates.length === 0) {
    for (const block of jsonBlocks) {
      videoCandidates = videoCandidatesInNode(block.parsed);
      if (videoCandidates.length > 0) break;
    }
  }

  const owner = watchOwner(jsonBlocks, contentData, videoId);
  const reactionCount = contentData.feedback?.reaction_count?.count;
  const totalComments = contentData.feedback?.total_comment_count;

  return {
    authorName: owner?.name || null,
    text: contentData.title?.text || '',
    videoCandidates,
    thumbnail: thumbnailInNode(contentData),
    postDate: findCreationTime(jsonBlocks),
    likes: reactionCount != null ? humanFormat(reactionCount) : null,
    comments: totalComments != null ? humanFormat(totalComments) : null,
    shares: null,
  };
}

/// 24h stories: data.bucket.unified_stories_with_notes.edges[0].node.
/// facebed-rusty: parsers/stories.rs.
function parseStoriesContent(jsonBlocks) {
  for (const block of jsonBlocks) {
    for (const usn of findAllByKey(block.parsed, 'unified_stories_with_notes')) {
      const node = usn?.edges?.[0]?.node;
      if (!node?.attachments) continue;

      const bucket =
        collectObjects(block.parsed).find((obj) => obj.unified_stories_with_notes === usn) || {};
      const owner = bucket.owner || {};
      const media = node.attachments?.[0]?.media;
      if (!media) continue;

      const videoCandidates = videoCandidatesInNode(media);
      const preview = media.preferred_thumbnail?.image?.uri || media.image?.uri || null;

      return {
        authorName: owner.name || null,
        text: '',
        postUrl: node.story_card_info?.permalink_info?.uri || null,
        postDate: node.creation_time != null ? parseInt(node.creation_time, 10) : null,
        imageLinks: videoCandidates.length === 0 && preview ? [preview] : [],
        videoCandidates,
        thumbnail: videoCandidates.length > 0 ? preview : null,
      };
    }
  }
  throw new Error('Story unavailable (expired or restricted)');
}

/// Image posted inside a comment (photo.php?...&type=3). Caption and image live
/// under attached_comment / currMedia, not the normal photo keys.
/// facebed-rusty: parsers/photocom.rs.
function parsePhotocomContent(jsonBlocks) {
  const contentBlock = jsonBlocks.find(
    (b) => hasKeys(b.parsed, 'attached_comment') && !hasKeys(b.parsed, 'unified_reactors')
  );
  const data = contentBlock ? findFirstByKey(contentBlock.parsed, 'result')?.data : null;
  if (!data) throw new Error('Cannot process photocom (cn)');

  const mediaBlock = jsonBlocks.find((b) =>
    hasKeys(b.parsed, 'attached_comment', 'unified_reactors')
  );
  const currMedia = mediaBlock ? findFirstByKey(mediaBlock.parsed, 'currMedia') : null;
  const image = currMedia?.image?.uri;
  if (!image) throw new Error('Cannot process photocom (iau)');

  const reactions = mediaBlock
    ? findFirstByKey(mediaBlock.parsed, 'unified_reactors')?.count
    : null;

  return {
    authorName: `${data.owner?.name || ''} (💬)`,
    text: data.attached_comment?.preferred_body?.text || '',
    postUrl: currMedia?.attached_comment?.feedback?.url || null,
    postDate: data.created_time != null ? parseInt(data.created_time, 10) : null,
    imageLinks: [image],
    likes: reactions != null ? humanFormat(reactions) : null,
  };
}

/// /photo/ and /photo.php pages have no content.story — the caption lives in
/// message_preferred_body / container_story and the image in prefetch_uris_v2.
/// facebed-rusty: parsers/single_photo.rs.
function parseSinglePhotoContent(jsonBlocks) {
  const contentBlock = jsonBlocks.find((b) =>
    hasKeys(b.parsed, 'message_preferred_body', 'container_story')
  );
  const data = contentBlock ? findFirstByKey(contentBlock.parsed, 'data') : null;
  if (!data) throw new Error('Cannot process single photo (cn)');

  const text =
    [data.message_preferred_body?.text, data.container_story?.message?.text, data.message?.text]
      .filter((t) => typeof t === 'string' && t.trim())
      .sort((a, b) => b.length - a.length)[0] || '';

  const imageBlock = jsonBlocks.find((b) => hasKeys(b.parsed, 'prefetch_uris_v2'));
  const image = imageBlock
    ? findFirstByKey(imageBlock.parsed, 'prefetch_uris_v2')?.[0]?.uri
    : null;
  if (!image) throw new Error('Cannot process single photo (img)');

  const interactionBlock = jsonBlocks.find((b) =>
    hasKeys(b.parsed, 'comet_ufi_summary_and_actions_renderer')
  );
  const counts = interactionBlock
    ? getInteractionCounts(interactionBlock.parsed)
    : { likes: null, comments: null, shares: null };

  return {
    authorName: data.owner?.name || null,
    text: text.trim(),
    postDate: data.created_time != null ? parseInt(data.created_time, 10) : null,
    imageLinks: [image],
    likes: counts.likes,
    comments: counts.comments,
    shares: counts.shares,
  };
}

const commentIdIn = (rawUrl) => {
  try {
    return new URL(rawUrl).searchParams.get('comment_id') || null;
  } catch {
    return null;
  }
};

/// FB comment `id` fields are base64 of `comment:<post_fbid>_<comment_fbid>`.
const b64DecodeAscii = (s) => {
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return null;
  }
};

const commentCandidateNodes = (parsed) => {
  const out = [];
  const accept = (node) => {
    if (node?.preferred_body && node?.author) out.push(node);
  };
  for (const edges of findAllByKey(parsed, 'edges')) {
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) accept(edge?.node);
  }
  for (const key of ['comment', 'attached_comment']) {
    for (const node of findAllByKey(parsed, key)) accept(node);
  }
  return out;
};

const commentNodeMatches = (node, commentId) => {
  if (node.legacy_fbid != null && String(node.legacy_fbid) === commentId) return true;
  const needle = `comment_id=${commentId}`;
  if (findAllByKey(node, 'url').some((u) => typeof u === 'string' && u.includes(needle))) {
    return true;
  }
  if (typeof node.id === 'string') {
    const decoded = b64DecodeAscii(node.id);
    if (decoded?.startsWith('comment:') && decoded.endsWith(`_${commentId}`)) return true;
  }
  return false;
};

/// facebed-rusty: parsers/comment.rs. Returns null (not an error) when the
/// comment isn't server-rendered — the caller then embeds the parent post.
function parseCommentContent(jsonBlocks, commentId) {
  if (!commentId) return null;

  let node = null;
  for (const b of jsonBlocks) {
    node = commentCandidateNodes(b.parsed).find((n) => commentNodeMatches(n, commentId));
    if (node) break;
  }
  if (!node) return null;

  const videoCandidates = videoCandidatesInNode(node);
  const permalink =
    findAllByKey(node, 'url').find(
      (u) => typeof u === 'string' && u.startsWith('https://') && u.includes('comment_id=')
    ) || null;
  const reactions = node.reactors?.count ?? findFirstByKey(node, 'unified_reactors')?.count;

  return {
    authorName: `${node.author?.name || ''} (💬)`,
    text: node.preferred_body?.text || '',
    postUrl: permalink,
    postDate: node.created_time != null ? parseInt(node.created_time, 10) : null,
    imageLinks: videoCandidates.length > 0 ? [] : extractImagesFromJson(node),
    videoCandidates,
    thumbnail: videoCandidates.length > 0 ? thumbnailInNode(node) : null,
    likes: reactions != null ? humanFormat(reactions) : null,
  };
}

const getBaseHeaders = () => ({
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  Cookie: process.env.FB_COOKIES || "",
  Dpr: "0.8",
  Pragma: "no-cache",
  "priority": "u=0, i",
  "Sec-Ch-Prefers-Color-Scheme": "dark",
  "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
  "sec-ch-ua-full-version-list": "\"Chromium\";v=\"134.0.6998.136\", \"Not:A-Brand\";v=\"24.0.0.0\", \"Google Chrome\";v=\"134.0.6998.136\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-model": "\"\"",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-ch-ua-platform-version": "\"10.0.0\"",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Viewport-Width": "2019",
});

const createSession = () => {
  return axios.create({
    timeout: REQUEST_TIMEOUT,
    headers: getBaseHeaders(),
    validateStatus: (status) => status < 500,
  });
};

let session = createSession();

const validateCookies = () => {
  const cookies = process.env.FB_COOKIES;
  if (!cookies || cookies.trim() === "") {
    console.warn("[Facebook] FB_COOKIES not configured in .env");
    return false;
  }
  return true;
};

const getDirectUrl = async (url) => {
  try {
    if (/m\.facebook/.test(url)) {
      url = url.replace("m.facebook", "www.facebook");
    }

    const response = await session.get(url, {
      headers: getBaseHeaders(),
    });

    let finalUrl = response.request?.res?.responseUrl || response.config.url;

    if (finalUrl.includes("login")) {
      const nextMatch = finalUrl.match(/next=(.+)/);
      if (nextMatch) {
        finalUrl = decodeURIComponent(nextMatch[1]);
        if (finalUrl.includes("login")) {
          console.warn("[Facebook] Cookies may be expired - login redirect detected");
          return null;
        }
      } else {
        return null;
      }
    }

    return finalUrl;
  } catch (error) {
    console.error("[Facebook] Error resolving URL:", error.message);
    return null;
  }
};

const parseEscapedString = (str) => {
  try {
    const cleaned = str.replace(/\\\//g, "/");
    return JSON.parse(`"${cleaned}"`);
  } catch {
    return str.replace(/\\\//g, "/");
  }
};

const decodeHtmlEntities = (str) => {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
};

const parseFeedImages = (html) => {
  const images = [];
  const feedImagePattern = /<img[^>]*data-imgperflogname="feedImage"[^>]*src="([^"]+)"[^>]*>/gi;
  const matches = [...html.matchAll(feedImagePattern)];
  
  for (const match of matches) {
    if (match[1]) {
      const url = decodeHtmlEntities(match[1]);
      if (url.includes('fbcdn.net') && !url.includes('emoji')) {
        images.push(url);
      }
    }
  }
  
  const altFeedImagePattern = /<img[^>]*src="([^"]+)"[^>]*data-imgperflogname="feedImage"[^>]*>/gi;
  const altMatches = [...html.matchAll(altFeedImagePattern)];
  
  for (const match of altMatches) {
    if (match[1]) {
      const url = decodeHtmlEntities(match[1]);
      if (url.includes('fbcdn.net') && !url.includes('emoji') && !images.includes(url)) {
        images.push(url);
      }
    }
  }
  
  return images;
};

const extractImagesFromJson = (postJson) => {
  const images = [];
  
  try {
    const allAttachments = findAllByKey(postJson, 'attachment');
    
    for (const attachmentSet of allAttachments) {
      const hasSubattachments = Object.keys(attachmentSet).some(k => k.endsWith('subattachments'));
      
      if (hasSubattachments) {
        const subsets = Object.entries(attachmentSet)
          .filter(([k, v]) => k.endsWith('subattachments') && v && v.nodes)
          .map(([_, v]) => v);
        
        if (subsets.length > 0) {
          const maxImageCount = Math.max(...subsets.map(s => s.nodes?.length || 0));
          const validSubsets = subsets.filter(subset => 
            subset.nodes?.length === maxImageCount && 
            findAllByKey(subset, 'viewer_image').length > 0
          );
          
          if (validSubsets.length > 0) {
            const viewerImages = findAllByKey(validSubsets[0], 'viewer_image');
            for (const img of viewerImages) {
              if (img && img.uri && !images.includes(img.uri)) {
                images.push(img.uri);
              }
            }
            if (images.length > 0) return images;
          }
        }
      } else if (attachmentSet.media && !JSON.stringify(attachmentSet).includes("'__typename': 'Sticker'")) {
        const photoImages = findAllByKey(attachmentSet, 'photo_image');
        for (const img of photoImages) {
          if (img && img.uri && !images.includes(img.uri)) {
            images.push(img.uri);
          }
        }
        if (images.length > 0) return images;
      }
    }
    
    const resolvers = findAllByKey(postJson, 'comet_photo_attachment_resolution_renderer');
    for (const resolver of resolvers) {
      if (resolver.image && resolver.image.uri && !images.includes(resolver.image.uri)) {
        images.push(resolver.image.uri);
      }
    }
    
    const prefetchUris = findFirstByKey(postJson, 'prefetch_uris_v2');
    if (prefetchUris && Array.isArray(prefetchUris) && prefetchUris.length > 0) {
      if (prefetchUris[0].uri && !images.includes(prefetchUris[0].uri)) {
        images.push(prefetchUris[0].uri);
      }
    }
    
  } catch (e) {
    console.error('[Facebook] Error extracting images from JSON:', e.message);
  }
  
  return images;
};

const extractVideosFromJson = (postJson) => {
  const videos = [];
  for (const attachmentSet of findAllByKey(postJson, 'attachment')) {
    const candidates = videoCandidatesInNode(attachmentSet);
    if (candidates.length > 0 && !videos.some((entry) => entry[0] === candidates[0])) {
      videos.push(candidates);
    }
  }
  return videos;
};

const VIDEO_BLOCK_MARKERS = [
  'browser_native_hd_url',
  'browser_native_sd_url',
  'progressive_url',
  'video_view_count_renderer',
  'comment_rendering_instance',
  'i18n_reaction_count',
  'comet_ufi_summary_and_actions_renderer',
];

const parseMediaFromJsonBlocks = (html) => {
  const result = { images: [], videos: [] };

  // Video entries are candidate lists (best quality first), not bare URLs.
  const pushVideos = (parsed) => {
    const add = (entry) => {
      if (entry.length > 0 && !result.videos.some((existing) => existing[0] === entry[0])) {
        result.videos.push(entry);
      }
    };
    for (const entry of extractVideosFromJson(parsed)) add(entry);
    add(videoCandidatesInNode(parsed));
  };

  try {
    const blocks = getJsonBlocks(html, true);

    for (const block of blocks) {
      if (block.json.includes('i18n_reaction_count') ||
          block.json.includes('comet_ufi_summary_and_actions_renderer')) {
        const images = extractImagesFromJson(block.parsed);
        if (images.length > 0 && result.images.length === 0) {
          result.images.push(...images);
        }
      }

      if (block.json.includes('message_preferred_body') ||
          block.json.includes('container_story')) {
        for (const img of extractImagesFromJson(block.parsed)) {
          if (!result.images.includes(img)) result.images.push(img);
        }
      }

      if (VIDEO_BLOCK_MARKERS.some((marker) => block.json.includes(marker))) {
        pushVideos(block.parsed);
      }
    }

    if (result.videos.length === 0) {
      for (const block of getJsonBlocks(html, false)) {
        if (VIDEO_BLOCK_MARKERS.some((marker) => block.json.includes(marker))) {
          pushVideos(block.parsed);
        }
      }
    }
  } catch (e) {
    console.log('[Facebook] Error parsing media from JSON blocks:', e.message);
  }

  return result;
};

const parseProgressiveUrls = (html) => {
  try {
    const hdPattern = /"progressive_url"\s*:\s*"([^"]+)"[^}]*?"metadata"\s*:\s*\{\s*"quality"\s*:\s*"HD"\s*}/g;
    const hdMatches = [...html.matchAll(hdPattern)];
    
    for (const match of hdMatches) {
      if (match[1]) {
        const url = parseEscapedString(match[1]);
        if (url && url.includes('fbcdn.net') && (url.includes('.mp4') || url.includes('/v/'))) {
          return url;
        }
      }
    }

    const sdPattern = /"progressive_url"\s*:\s*"([^"]+)"[^}]*?"metadata"\s*:\s*\{\s*"quality"\s*:\s*"SD"\s*}/g;
    const sdMatches = [...html.matchAll(sdPattern)];
    
    for (const match of sdMatches) {
      if (match[1]) {
        const url = parseEscapedString(match[1]);
        if (url && url.includes('fbcdn.net') && (url.includes('.mp4') || url.includes('/v/'))) {
          return url;
        }
      }
    }

    const arrayPattern = /"progressive_urls"\s*:\s*\[([\s\S]*?)]/g;
    const arrayMatches = [...html.matchAll(arrayPattern)];
    
    for (const arrayMatch of arrayMatches) {
      const block = arrayMatch[1];
      
      const urlPattern = /"progressive_url"\s*:\s*"([^"]+)"/g;
      const qualityPattern = /"quality"\s*:\s*"(HD|SD)"/g;
      
      const urls = [...block.matchAll(urlPattern)].map(m => parseEscapedString(m[1]));
      const qualities = [...block.matchAll(qualityPattern)].map(m => m[1]);
      
      for (let i = 0; i < urls.length && i < qualities.length; i++) {
        if (qualities[i] === "HD" && urls[i] && urls[i].includes('fbcdn.net')) {
          return urls[i];
        }
      }
      
      for (let i = 0; i < urls.length && i < qualities.length; i++) {
        if (qualities[i] === "SD" && urls[i] && urls[i].includes('fbcdn.net')) {
          return urls[i];
        }
      }
      
      for (const url of urls) {
        if (url && url.includes('fbcdn.net')) {
          return url;
        }
      }
    }

    return null;
  } catch (error) {
    console.error("[Facebook] Error parsing progressive URLs:", error.message);
    return null;
  }
};

const parseVideoUrl = (html) => {
  const urlPattern =
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&\/=]*)/;

  const progressiveUrlResult = parseProgressiveUrls(html);
  if (progressiveUrlResult) {
    return progressiveUrlResult;
  }

  const hdMatch = html.match(/"browser_native_hd_url":"(([^\\"]|\\.)*)"/);
  if (hdMatch && hdMatch[1] && !hdMatch[1].includes("null")) {
    const parsed = parseEscapedString(hdMatch[1]);
    const extracted = parsed.match(urlPattern);
    if (extracted) {
      console.log('[Facebook] Found HD video URL');
      return extracted[0];
    }
  }

  const sdMatch = html.match(/"browser_native_sd_url":"(([^\\"]|\\.)*)"/);
  if (sdMatch && sdMatch[1] && !sdMatch[1].includes("null")) {
    const parsed = parseEscapedString(sdMatch[1]);
    const extracted = parsed.match(urlPattern);
    if (extracted) {
      console.log('[Facebook] Found SD video URL (HD not available)');
      return extracted[0];
    }
  }

  return null;
};

const fetchPhotoUrl = async (url) => {
  try {
    const response = await session.get(url);
    const match = response.data.match(/"image":{"uri":"(([^\\"]|\\.)*)"/);
    if (match && match[1]) {
      return parseEscapedString(match[1]);
    }
    return null;
  } catch (error) {
    console.error("[Facebook] Error fetching photo:", error.message);
    return null;
  }
};

const parseAttachments = async (html) => {
  const attachments = [];
  const urlPattern =
    /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&\/=]*)/;

  // Entries are either a URL string (images) or a candidate list (videos).
  const firstUrl = (entry) => (Array.isArray(entry) ? entry[0] : entry);

  const jsonMedia = parseMediaFromJsonBlocks(html);

  if (jsonMedia.videos.length > 0) {
    for (const videoEntry of jsonMedia.videos) {
      if (!attachments.some((a) => firstUrl(a) === firstUrl(videoEntry))) {
        attachments.push(videoEntry);
      }
    }
  }

  if (jsonMedia.images.length > 0) {
    for (const imageUrl of jsonMedia.images) {
      if (!attachments.includes(imageUrl)) {
        attachments.push(imageUrl);
      }
    }
  }
  
  const hasVideoFromJson = jsonMedia.videos.length > 0;
  
  if (!hasVideoFromJson) {
    console.log('[Facebook] No videos from JSON parsing, trying regex fallback for videos');
    const videoUrl = parseVideoUrl(html);
    if (videoUrl && !attachments.includes(videoUrl)) {
      attachments.unshift(videoUrl);
    }
  }
  
  if (attachments.length > 0) {
    const videoCount = attachments.filter((entry) => {
      const url = firstUrl(entry);
      return url.includes('/v/') || url.includes('/o1/v/') || url.includes('.mp4');
    }).length;
    const imageCount = attachments.length - videoCount;
    console.log(`[Facebook] Found ${videoCount} videos, ${imageCount} images`);
    return attachments.filter((url) => url !== null);
  }

  console.log('[Facebook] No media found, falling back to full regex methods');

  const postIdMatch = html.match(/"post_id":"(\d+)"/);
  const postId = postIdMatch ? postIdMatch[1] : null;

  const videoUrl = parseVideoUrl(html);
  if (videoUrl) {
    attachments.push(videoUrl);
  }

  let photoIds = [];

  const att1 = html.match(/\\\\"photo_attachments_list\\\\":\[([^\]]+)/);
  const att2 = html.match(/\\\\"photo_attachments_list\\\\":\\\\([^\]^,]+)/);
  const att3 = html.match(/"photo_image":{"uri":"([^"]+)"/);

  let attString = "";
  if (att1) attString += att1[1];
  if (att2) attString += att2[1];

  if (att3 && !att1 && !att2) {
    const directUrl = parseEscapedString(att3[1]);
    if (urlPattern.test(directUrl)) {
      attachments.push(directUrl);
    }
  }

  const vid3 = html.match(/"video_id":"(\d+)"/);
  const videoIds = vid3 ? [vid3[1]] : [];

  const allIds = attString.match(/\d+/g) || [];
  photoIds = allIds.filter((id) => !videoIds.includes(id));

  if (photoIds.length > 0 && postId) {
    const photoPromises = photoIds.map((fbid) => {
      const photoUrl = `https://www.facebook.com/photo/?fbid=${fbid}&set=pcb.${postId}`;
      return fetchPhotoUrl(photoUrl);
    });

    const photoUrls = await Promise.all(photoPromises);
    attachments.push(...photoUrls.filter((url) => url !== null));
  }

  if (urlPattern.test(attString)) {
    attachments.push(attString);
  }

  const hasImages = attachments.some((entry) => firstUrl(entry).match(/\.(png|webp|jpg|jpeg|gif)/i) !== null);
  
  if (!hasImages && !videoUrl) {
    const feedImages = parseFeedImages(html);
    if (feedImages.length > 0) {
      attachments.push(...feedImages);
    }
  }

  return attachments.filter((url) => url !== null);
};

const downloadOne = async (url) => {
  try {
    const imageMatch = url.match(/\.(png|webp|jpg|jpeg|gif)/i);
    const videoMatch = url.match(/\.(mp4|mov|webm)/i);
    let extension = imageMatch?.[1] || videoMatch?.[1];
    
    if (!extension && url.includes('fbcdn.net') && (url.includes('/v/') || url.includes('/o1/v/'))) {
      extension = 'mp4';
    }
    
    if (!extension) {
      extension = 'jpg';
    }

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: REQUEST_TIMEOUT,
      headers: {
        "User-Agent": getBaseHeaders()["User-Agent"],
      },
    });

    const buffer = Buffer.from(response.data);
    const size = buffer.length;

    if (size > MAX_FILE_SIZE) {
      console.warn(`[Facebook] File too large (${(size / 1024 / 1024).toFixed(2)}MB), skipping`);
      return { buffer: null, extension, size, tooLarge: true };
    }

    return { buffer, extension, size, tooLarge: false };
  } catch (error) {
    console.error("[Facebook] Error downloading media:", error.message);
    return null;
  }
};

/// Try quality candidates in order; first one under MAX_FILE_SIZE wins.
/// Accepts a bare URL (images) or an ordered candidate list (videos).
/// ponytail: no HEAD pre-check — FB usually omits Content-Length, so the probe
/// costs a round-trip and answers "unknown". Add one if download volume hurts.
const downloadMedia = async (candidates) => {
  const urls = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
  let oversized = null;
  for (const url of urls) {
    const result = await downloadOne(url);
    if (!result) continue;
    if (!result.tooLarge) return result;
    oversized = result;
    console.warn("[Facebook] Candidate over size limit, trying lower quality");
  }
  return oversized;
};

const escapeMarkdown = (text) => {
  if (!text) return "";
  const replacements = {
    "*": "\\*",
    _: "\\_",
    "~": "\\~",
    "|": "\\|",
    "`": "\\`",
    ">": "\\>",
  };
  let escaped = text;
  for (const [char, replacement] of Object.entries(replacements)) {
    escaped = escaped.split(char).join(replacement);
  }
  return escaped;
};

const scrapePost = async (url) => {
  const result = {
    files: [],
    message: "",
    error: null,
    skippedLargeFiles: 0,
    postInfo: null,
    authorName: null,
    postDate: null,
    likes: null,
    comments: null,
    shares: null,
    groupName: null,
    isReel: false,
  };

  const addMediaDownloads = async (mediaEntries) => {
    const seen = new Set();
    const entries = [];
    for (const entry of mediaEntries) {
      const urls = (Array.isArray(entry) ? entry : [entry]).filter(Boolean);
      if (urls.length === 0 || seen.has(urls[0])) continue;
      seen.add(urls[0]);
      entries.push(urls);
    }
    if (entries.length === 0) return;

    const downloads = await Promise.all(entries.map((entry) => downloadMedia(entry)));
    for (const download of downloads) {
      if (!download) continue;
      if (download.tooLarge) {
        result.skippedLargeFiles++;
        continue;
      }
      if (download.buffer) {
        result.files.push({
          buffer: download.buffer,
          extension: download.extension,
        });
      }
    }
  };

  const setMessage = (text, sourceUrl, allowMarkdown = false) => {
    if (!text) return;
    let message = allowMarkdown ? text.trim() : escapeMarkdown(text.trim());
    if (message.length > 727) {
      message = message.substring(0, 727) + "... [View more](" + sourceUrl + ")";
    }
    result.message = message;
  };

  if (!validateCookies()) {
    result.error = "Facebook cookies not configured";
    return result;
  }

  try {
    session = createSession();

    const requestUrl = extractShareUrl(url) || url;
    const directUrl = await getDirectUrl(requestUrl);
    if (!directUrl) {
      result.error = "Could not resolve Facebook URL (cookies may be expired)";
      return result;
    }

    const cleanedUrl = cleanFacebookUrl(directUrl);

    const routed = classifyFacebookUrl(cleanedUrl);
    const normalizedUrl = routed.url;
    const videoId = targetVideoId(normalizedUrl);
    console.log(`[Facebook] Routed as ${routed.kind}: ${normalizedUrl}`);

    const cacheBuster = (normalizedUrl.includes("?") ? "&" : "?") + "_cb=" + Date.now();
    const response = await session.get(normalizedUrl + cacheBuster, {
      headers: {
        ...getBaseHeaders(),
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
    const html = response.data;
    const mobilePostInfo = extractMobilePostInfo(html);

    result.postInfo = {
      postType: mobilePostInfo.postType,
      isVideo: mobilePostInfo.isVideo,
      isPhoto: mobilePostInfo.isPhoto,
      isGroupPost: mobilePostInfo.isGroupPost,
      groupInfo: mobilePostInfo.groupInfo,
      groupName: mobilePostInfo.groupName,
      title: mobilePostInfo.title,
      url: mobilePostInfo.url || normalizedUrl,
    };

    let structuredParsingSucceeded = false;

    try {
      const jsonBlocks = getJsonBlocks(html, true);
      const unsortedJsonBlocks = getJsonBlocks(html, false);

      // null when the comment isn't server-rendered (deep replies, stale ids) —
      // we then fall through and embed the parent post instead.
      const commentData =
        routed.kind === "comment"
          ? parseCommentContent(jsonBlocks, commentIdIn(normalizedUrl))
          : null;

      if (commentData) {
        result.authorName = commentData.authorName;
        result.postDate = commentData.postDate;
        result.likes = commentData.likes;
        result.isReel = commentData.videoCandidates.length > 0;
        result.postInfo.url = commentData.postUrl || result.postInfo.url;

        setMessage(commentData.text, result.postInfo.url || url);
        await addMediaDownloads([
          ...(commentData.videoCandidates.length > 0 ? [commentData.videoCandidates] : []),
          ...commentData.imageLinks,
        ]);
        structuredParsingSucceeded = true;
      } else if (routed.kind === "reel") {
        const reelData = parseReelContent(unsortedJsonBlocks.length > 0 ? unsortedJsonBlocks : jsonBlocks);

        result.authorName = reelData.authorName;
        result.postDate = reelData.postDate;
        result.likes = reelData.likes;
        result.comments = reelData.comments;
        result.shares = reelData.shares;
        result.isReel = true;
        result.postInfo.url = reelData.postUrl || result.postInfo.url;

        setMessage(reelData.text, result.postInfo.url || url);
        await addMediaDownloads(reelData.videoCandidates.length > 0 ? [reelData.videoCandidates] : []);
        structuredParsingSucceeded = true;
      } else if (routed.kind === "watch") {
        const watchData = parseWatchContent(jsonBlocks, videoId, mobilePostInfo.meta);

        result.authorName = watchData.authorName;
        result.postDate = watchData.postDate;
        result.likes = watchData.likes;
        result.comments = watchData.comments;
        result.shares = watchData.shares;
        result.isReel = true;

        setMessage(watchData.text, result.postInfo.url || url);
        await addMediaDownloads(
          watchData.videoCandidates.length > 0 ? [watchData.videoCandidates] : []
        );
        structuredParsingSucceeded = true;
      } else if (routed.kind === "photocom") {
        const photocom = parsePhotocomContent(jsonBlocks);

        result.authorName = photocom.authorName;
        result.postDate = photocom.postDate;
        result.likes = photocom.likes;
        result.postInfo.url = photocom.postUrl || result.postInfo.url;

        setMessage(photocom.text, result.postInfo.url || url);
        await addMediaDownloads(photocom.imageLinks);
        structuredParsingSucceeded = true;
      } else if (routed.kind === "photo") {
        const photo = parseSinglePhotoContent(jsonBlocks);

        result.authorName = photo.authorName;
        result.postDate = photo.postDate;
        result.likes = photo.likes;
        result.comments = photo.comments;
        result.shares = photo.shares;

        setMessage(photo.text, result.postInfo.url || url);
        await addMediaDownloads(photo.imageLinks);
        structuredParsingSucceeded = true;
      } else if (routed.kind === "stories") {
        const storyData = parseStoriesContent(jsonBlocks);

        result.authorName = storyData.authorName;
        result.postDate = storyData.postDate;
        result.isReel = storyData.videoCandidates.length > 0;
        result.postInfo.url = storyData.postUrl || result.postInfo.url;

        await addMediaDownloads([
          ...(storyData.videoCandidates.length > 0 ? [storyData.videoCandidates] : []),
          ...storyData.imageLinks,
        ]);
        structuredParsingSucceeded = true;
      } else {
        const postId = extractPostId(normalizedUrl);
        const canonicalPostId = canonicalPagePostId(mobilePostInfo.meta);
        const postJson = getPostJson(jsonBlocks, postId, canonicalPostId);
        const rootNode = getRootNode(postJson);
        const counts = getInteractionCounts(rootNode, postId);
        const authorAndText = extractAuthorAndText(rootNode);
        const postDate = extractPostDate(rootNode);
        const groupName = getGroupNameFromJson(jsonBlocks) || mobilePostInfo.groupName;

        result.authorName = authorAndText.authorName;
        result.postDate = postDate;
        result.likes = counts.likes;
        result.comments = counts.comments;
        result.shares = counts.shares;
        result.groupName = groupName;
        result.isReel = authorAndText.videoLinks.length > 0 && authorAndText.imageLinks.length === 0;
        result.postInfo.url = authorAndText.postUrl || result.postInfo.url || normalizedUrl;

        setMessage(authorAndText.text, result.postInfo.url || url, isGroupPostUrl(normalizedUrl));
        await addMediaDownloads([...authorAndText.videoLinks, ...authorAndText.imageLinks]);
        structuredParsingSucceeded = true;
      }
    } catch (structuredError) {
      console.log("[Facebook] Structured parsing failed, falling back to regex:", structuredError.message);
    }

    if (!structuredParsingSucceeded) {
      result.authorName = null;
      result.postDate = null;
      result.likes = null;
      result.comments = null;
      result.shares = null;
      result.groupName = mobilePostInfo.groupName || null;
      result.isReel = false;

      const msgMatch = html.match(/"message":{"text":"(([^\\"]|\\.)*)"/);
      if (msgMatch && msgMatch[1] && msgMatch[1] !== "Explore more in Video") {
        setMessage(parseEscapedString(msgMatch[1]), result.postInfo?.url || url);
      }

      if (!result.message && mobilePostInfo.description) {
        console.log("[Facebook] Using og:description as message fallback");
        setMessage(mobilePostInfo.description, result.postInfo?.url || url);
      }

      const attachmentUrls = await parseAttachments(html);
      if (attachmentUrls.length === 0 && mobilePostInfo.thumbnailUrl?.includes("fbcdn.net")) {
        console.log("[Facebook] No media from parsing, using og:image thumbnail as fallback");
        attachmentUrls.push(mobilePostInfo.thumbnailUrl);
      }

      await addMediaDownloads(attachmentUrls);
    }

    return result;
  } catch (error) {
    console.error("[Facebook] Scrape error:", error.message);
    result.error = error.message;
    return result;
  }
};

const isFacebookUrl = (url) => {
  const patterns = [
    /https?:\/\/(www\.|m\.)?facebook\.com\/reel\/\d+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/share\/p\/([a-zA-Z0-9]+)/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/share\/v\/([a-zA-Z0-9]+)/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/share\/r\/([a-zA-Z0-9]+)/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/share\/([a-zA-Z0-9]+)\/?$/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/share\/[a-zA-Z0-9]+\/?\?mibextid=/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/[^/]+\/posts\/(\d+|pfbid[a-zA-Z0-9]+)/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/watch\/?\?v=\d+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/photo\/?\?fbid=\d+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/photo\.php\?/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/[^\s]*[?&]comment_id=\d+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/stories\/\d+\/[A-Za-z0-9=_-]+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/permalink\.php\?story_fbid=/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/groups\/[^/]+\/permalink\/\d+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/groups\/\d+\/?\?multi_permalinks=\d+/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/groups\/[^/]+\/posts\/(\d+|pfbid[a-zA-Z0-9]+)/,
    /https?:\/\/(www\.|m\.)?facebook\.com\/[^/]+\/videos\/\d+/,
  ];

  return patterns.some((pattern) => pattern.test(url));
};

const extractFacebookUrl = (content) => {
  if (/\|\|[^|]*facebook\.com[^|]*\|\|/.test(content)) {
    return null;
  }

  const urlPattern =
    /https?:\/\/(www\.|m\.)?facebook\.com\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = content.match(urlPattern);

  if (matches) {
    for (const url of matches) {
      if (isFacebookUrl(url)) {
        return url;
      }
    }
  }

  return null;
};

const resetSession = () => {
  session = createSession();
};

module.exports = {
  scrapePost,
  isFacebookUrl,
  extractFacebookUrl,
  validateCookies,
  resetSession,
  escapeMarkdown,
  parseMetaTags,
  extractMobilePostInfo,
  detectPostType,
  parseGroupPostUrl,
  extractGroupNameFromTitle,
  findFirstByKey,
  findAllByKey,
  hasKeys,
  cleanFacebookUrl,
  extractShareUrl,
  isGroupPostUrl,
  targetVideoId,
  classifyFacebookUrl,
  parseWatchContent,
  parseStoriesContent,
  parsePhotocomContent,
  parseSinglePhotoContent,
  commentIdIn,
  parseCommentContent,
  extractPostId,
  canonicalStoryPostId,
  getPostJson,
  getInteractionCounts,
  videoCandidatesInNode,
  videoLinkInNode,
  thumbnailInNode,
  findReelContentNode,
  ownerFromNode,
  blockMentionsId,
  parseReelContent,
};
