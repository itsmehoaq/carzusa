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

function getPostJson(jsonBlocks) {
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

function getInteractionCounts(postJson) {
  const postFeedback = findFirstByKey(postJson, 'comet_ufi_summary_and_actions_renderer');
  if (!postFeedback || !postFeedback.feedback) {
    return { likes: null, comments: null, shares: null };
  }

  const fb = postFeedback.feedback;
  const reactions = fb.i18n_reaction_count != null ? String(fb.i18n_reaction_count) : null;
  const shares = fb.i18n_share_count != null ? String(fb.i18n_share_count) : null;

  let comments = null;
  try {
    const totalCount = fb.comment_rendering_instance?.comments?.total_count;
    if (totalCount != null) comments = String(totalCount);
  } catch (e) {}

  return { likes: reactions, comments, shares };
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

function parseWatchContent(jsonBlocks) {
  let contentData = null;
  for (const block of jsonBlocks) {
    if (hasKeys(block.parsed, 'comment_rendering_instance', 'video_view_count_renderer')) {
      const resultNode = findFirstByKey(block.parsed, 'result');
      if (resultNode && resultNode.data) {
        contentData = resultNode.data;
        break;
      }
    }
  }
  if (!contentData) throw new Error('Invalid watch link (cn)');

  const postText = contentData.title?.text || '';
  const reactionCount = contentData.feedback?.reaction_count?.count;
  const totalComments = contentData.feedback?.total_comment_count;

  const likes = reactionCount != null ? humanFormat(reactionCount) : null;
  const comments = totalComments != null ? humanFormat(totalComments) : null;
  const shares = null;

  let videoLink = null;
  for (const block of jsonBlocks) {
    if (hasKeys(block.parsed, 'browser_native_hd_url') || hasKeys(block.parsed, 'browser_native_sd_url')) {
      const videoNode = findFirstByKey(block.parsed, 'videoDeliveryLegacyFields');
      if (videoNode) {
        for (const key of ['browser_native_hd_url', 'browser_native_sd_url']) {
          const vUrl = findFirstByKey(videoNode, key);
          if (vUrl && typeof vUrl === 'string' && vUrl.includes('fbcdn.net')) {
            videoLink = vUrl;
            break;
          }
        }
        if (videoLink) break;
      }
    }
  }

  let opName = null;
  for (const block of jsonBlocks) {
    if (hasKeys(block.parsed, 'is_additional_profile_plus')) {
      const owner = findFirstByKey(block.parsed, 'owner');
      if (owner && owner.name) {
        opName = owner.name;
        break;
      }
    }
  }

  let postDate = null;
  for (const block of jsonBlocks) {
    const ct = findFirstByKey(block.parsed, 'creation_time');
    if (ct != null) {
      postDate = parseInt(ct, 10);
      break;
    }
  }

  return {
    authorName: opName,
    text: postText,
    videoLink,
    postDate,
    likes,
    comments,
    shares,
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

  const setMessage = (text, sourceUrl) => {
    if (!text) return;
    let message = escapeMarkdown(text.trim());
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

    const directUrl = await getDirectUrl(url);
    if (!directUrl) {
      result.error = "Could not resolve Facebook URL (cookies may be expired)";
      return result;
    }

    let normalizedUrl = directUrl;
    const videosMatch = directUrl.match(/\/([^/]+)\/videos\/(\d+)/);
    if (videosMatch) {
      normalizedUrl = directUrl.replace(/\/[^/]+\/videos\/(\d+)/, "/reel/$1").replace(/\/[^/]+\/watch\/(\d+)/, "/videos/$1");
      console.log("[Facebook] Converted /videos/ URL to /reel/ format");
    }

    const isReelUrl = /\/reel\/\d+/.test(normalizedUrl);
    const isWatchUrl = /\/watch/.test(normalizedUrl);
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

      if (isReelUrl) {
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
      } else if (isWatchUrl) {
        const watchData = parseWatchContent(jsonBlocks);

        result.authorName = watchData.authorName;
        result.postDate = watchData.postDate;
        result.likes = watchData.likes;
        result.comments = watchData.comments;
        result.shares = watchData.shares;
        result.isReel = true;

        setMessage(watchData.text, result.postInfo.url || url);
        await addMediaDownloads(watchData.videoLink ? [watchData.videoLink] : []);
        structuredParsingSucceeded = true;
      } else {
        const postJson = getPostJson(jsonBlocks);
        const rootNode = getRootNode(postJson);
        const counts = getInteractionCounts(rootNode);
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

        setMessage(authorAndText.text, result.postInfo.url || url);
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
    /https?:\/\/(www\.|m\.)?facebook\.com\/stories\/\d+/,
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
  videoCandidatesInNode,
  videoLinkInNode,
  thumbnailInNode,
  findReelContentNode,
  ownerFromNode,
  blockMentionsId,
  parseReelContent,
};
