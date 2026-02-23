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
  return result;
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
  const result = { authorName: null, text: '', imageLinks: [], videoLinks: [] };

  try {
    const story = rootNode?.content?.story;
    if (!story) return result;

    if (story.actors && story.actors.length > 0) {
      result.authorName = story.actors[0].name || null;
    }

    if (story.message && story.message.text) {
      result.text = story.message.text;
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

        try {
          const videoNode = findFirstByKey(attachmentSet, 'videoDeliveryLegacyFields');
          if (videoNode) {
            for (const key of ['browser_native_hd_url', 'browser_native_sd_url']) {
              const vUrl = findFirstByKey(videoNode, key);
              if (vUrl && typeof vUrl === 'string' && vUrl.includes('fbcdn.net') && !vids.includes(vUrl)) {
                vids.push(vUrl);
                break;
              }
            }
          }
        } catch (e) {}
      }

      if (imgs.length === 0) {
        const resolvers = findAllByKey(storyNode, 'comet_photo_attachment_resolution_renderer');
        for (const resolver of resolvers) {
          if (resolver.image && resolver.image.uri && !imgs.includes(resolver.image.uri)) {
            imgs.push(resolver.image.uri);
          }
        }
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

      const sharedMedia = extractMediaFromStory(attachedStory);
      for (const img of sharedMedia.imgs) {
        if (!result.imageLinks.includes(img)) result.imageLinks.push(img);
      }
      for (const vid of sharedMedia.vids) {
        if (!result.videoLinks.includes(vid)) result.videoLinks.push(vid);
      }
    }
  } catch (e) {
    console.error('[Facebook] Error in extractAuthorAndText:', e.message);
  }

  return result;
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

function parseReelContent(jsonBlocks) {
  let contentNode = null;
  for (const block of jsonBlocks) {
    if (hasKeys(block.parsed, 'browser_native_sd_url', 'creation_story')) {
      contentNode = findFirstByKey(block.parsed, 'creation_story');
      break;
    }
  }
  if (!contentNode) throw new Error('Invalid reels link (cn)');

  const videoId = contentNode.id;
  const ownerInfo = contentNode.short_form_video_context?.video_owner;
  if (!ownerInfo) throw new Error('Invalid reels link (owner)');

  const isIg = ownerInfo.__typename?.startsWith('InstagramUser') || false;
  const opName = (isIg ? '📷 @' : '') + (isIg ? ownerInfo.username : ownerInfo.name);
  const postUrl = contentNode.short_form_video_context?.shareable_url || null;
  const postDate = contentNode.creation_time || null;
  const postText = contentNode.message ? contentNode.message.text || '' : '';

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

  let likes = null;
  let comments = null;
  let shares = null;

  try {
    const reactionBlocks = [];
    for (const block of jsonBlocks) {
      if (hasKeys(block.parsed, 'unified_reactors')) {
        const allIds = findAllByKey(block.parsed, 'id');
        if (allIds.some(id => String(id) === String(videoId))) {
          reactionBlocks.push(block.parsed);
        }
      }
    }

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
        } else {
          const totalComments = lastFb.total_comment_count;
          if (totalComments != null) comments = humanFormat(totalComments);
        }

        const shareCount = lastFb.share_count_reduced;
        if (shareCount != null) shares = humanFormat(shareCount);
      }
    }
  } catch (e) {
    console.error('[Facebook] Error getting reel reaction counts:', e.message);
  }

  return {
    authorName: opName,
    text: postText,
    postUrl,
    postDate: postDate ? parseInt(postDate, 10) : null,
    videoLink,
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

const extractVideoFromJson = (node) => {
  try {
    const videoNode = findFirstByKey(node, 'videoDeliveryLegacyFields');
    if (!videoNode) return null;
    
    for (const key of ['browser_native_hd_url', 'browser_native_sd_url']) {
      const url = findFirstByKey(videoNode, key);
      if (url && typeof url === 'string' && url.includes('fbcdn.net')) {
        return url;
      }
    }
  } catch (e) {}
  return null;
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
  
  try {
    const allAttachments = findAllByKey(postJson, 'attachment');
    
    for (const attachmentSet of allAttachments) {
      const link = extractVideoFromJson(attachmentSet);
      if (link && !videos.includes(link)) {
        videos.push(link);
      }
    }
  } catch (e) {}
  
  return videos;
};

const parseMediaFromJsonBlocks = (html) => {
  const result = { images: [], videos: [] };
  
  try {
    const blocks = getJsonBlocks(html, true);
    
    for (const block of blocks) {
      if (block.json.includes('i18n_reaction_count') || 
          block.json.includes('comet_ufi_summary_and_actions_renderer')) {
        const parsed = block.parsed;
        
        const images = extractImagesFromJson(parsed);
        if (images.length > 0 && result.images.length === 0) {
          result.images.push(...images);
        }
        
        const videos = extractVideosFromJson(parsed);
        if (videos.length > 0) {
          for (const v of videos) {
            if (!result.videos.includes(v)) {
              result.videos.push(v);
            }
          }
        }
      }
      
      if (block.json.includes('message_preferred_body') || 
          block.json.includes('container_story')) {
        const images = extractImagesFromJson(block.parsed);
        if (images.length > 0) {
          for (const img of images) {
            if (!result.images.includes(img)) {
              result.images.push(img);
            }
          }
        }
      }
      
      if (block.json.includes('browser_native_hd_url') || 
          block.json.includes('browser_native_sd_url')) {
        const videoFields = findAllByKey(block.parsed, 'videoDeliveryLegacyFields');
        for (const videoField of videoFields) {
          for (const key of ['browser_native_hd_url', 'browser_native_sd_url']) {
            if (videoField[key] && typeof videoField[key] === 'string' && 
                videoField[key].includes('fbcdn.net') && !result.videos.includes(videoField[key])) {
              result.videos.push(videoField[key]);
              break;
            }
          }
        }
        
        const videos = extractVideosFromJson(block.parsed);
        for (const v of videos) {
          if (!result.videos.includes(v)) {
            result.videos.push(v);
          }
        }
      }
      
      if (block.json.includes('video_view_count_renderer') || 
          block.json.includes('comment_rendering_instance')) {
        const videoFields = findAllByKey(block.parsed, 'videoDeliveryLegacyFields');
        for (const videoField of videoFields) {
          for (const key of ['browser_native_hd_url', 'browser_native_sd_url']) {
            if (videoField[key] && typeof videoField[key] === 'string' && 
                videoField[key].includes('fbcdn.net') && !result.videos.includes(videoField[key])) {
              result.videos.push(videoField[key]);
              break;
            }
          }
        }
      }
    }
    
    if (result.videos.length === 0) {
      const unsortedBlocks = getJsonBlocks(html, false);
      for (const block of unsortedBlocks) {
        if (block.json.includes('browser_native_hd_url') || 
            block.json.includes('browser_native_sd_url')) {
          const videoFields = findAllByKey(block.parsed, 'videoDeliveryLegacyFields');
          for (const videoField of videoFields) {
            for (const key of ['browser_native_hd_url', 'browser_native_sd_url']) {
              if (videoField[key] && typeof videoField[key] === 'string' && 
                  videoField[key].includes('fbcdn.net') && !result.videos.includes(videoField[key])) {
                result.videos.push(videoField[key]);
                break;
              }
            }
          }
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

  const jsonMedia = parseMediaFromJsonBlocks(html);
  
  if (jsonMedia.videos.length > 0) {
    for (const videoUrl of jsonMedia.videos) {
      if (!attachments.includes(videoUrl)) {
        attachments.push(videoUrl);
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
    const videoCount = attachments.filter(url => 
      url.includes('/v/') || url.includes('/o1/v/') || url.includes('.mp4')
    ).length;
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

  const hasImages = attachments.some(url => {
    const ext = url.match(/\.(png|webp|jpg|jpeg|gif)/i);
    return ext !== null;
  });
  
  if (!hasImages && !videoUrl) {
    const feedImages = parseFeedImages(html);
    if (feedImages.length > 0) {
      attachments.push(...feedImages);
    }
  }

  return attachments.filter((url) => url !== null);
};

const downloadMedia = async (url) => {
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
      normalizedUrl = directUrl.replace(/\/[^/]+\/videos\/(\d+)/, '/reel/$1').replace(/\/[^/]+\/watch\/(\d+)/, '/videos/$1');
      console.log('[Facebook] Converted /videos/ URL to /reel/ format');
    }

    const isReelUrl = /\/reel\/\d+/.test(normalizedUrl);
    const isWatchUrl = /\/watch/.test(normalizedUrl);

    const cacheBuster = `${normalizedUrl.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
    const response = await session.get(normalizedUrl + cacheBuster, {
      headers: {
        ...getBaseHeaders(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
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
      url: mobilePostInfo.url,
    };

    if (mobilePostInfo.isGroupPost) {
      console.log(`[Facebook] Detected group post: ${mobilePostInfo.groupName || 'Unknown group'}`);
    }
    if (mobilePostInfo.isVideo) {
      console.log('[Facebook] Detected video post from og:type');
    }

    let structuredParsingSucceeded = false;

    try {
      const jsonBlocks = getJsonBlocks(html, true);

      if (isReelUrl) {
        const reelData = parseReelContent(jsonBlocks);

        result.authorName = reelData.authorName;
        result.postDate = reelData.postDate;
        result.likes = reelData.likes;
        result.comments = reelData.comments;
        result.shares = reelData.shares;
        result.isReel = true;

        if (reelData.text) {
          let message = escapeMarkdown(reelData.text);
          if (message.length > 727) {
            message = message.substring(0, 727) + `... [View more](${url})`;
          }
          result.message = message;
        }

        const mediaUrls = [];
        if (reelData.videoLink) mediaUrls.push(reelData.videoLink);

        if (mediaUrls.length > 0) {
          const downloadPromises = mediaUrls.map((mediaUrl) => downloadMedia(mediaUrl));
          const downloads = await Promise.all(downloadPromises);

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
        }

        structuredParsingSucceeded = true;
      } else if (isWatchUrl) {
        const watchData = parseWatchContent(jsonBlocks);

        result.authorName = watchData.authorName;
        result.postDate = watchData.postDate;
        result.likes = watchData.likes;
        result.comments = watchData.comments;
        result.shares = watchData.shares;
        result.isReel = true;

        if (watchData.text) {
          let message = escapeMarkdown(watchData.text);
          if (message.length > 727) {
            message = message.substring(0, 727) + `... [View more](${url})`;
          }
          result.message = message;
        }

        const mediaUrls = [];
        if (watchData.videoLink) mediaUrls.push(watchData.videoLink);

        if (mediaUrls.length > 0) {
          const downloadPromises = mediaUrls.map((mediaUrl) => downloadMedia(mediaUrl));
          const downloads = await Promise.all(downloadPromises);

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
        }

        structuredParsingSucceeded = true;
      } else {
        const postJson = getPostJson(jsonBlocks);
        const rootNode = getRootNode(postJson);
        const counts = getInteractionCounts(postJson);
        const authorAndText = extractAuthorAndText(rootNode);
        const postDate = extractPostDate(rootNode);
        const groupName = getGroupNameFromJson(jsonBlocks);

        result.authorName = authorAndText.authorName;
        result.postDate = postDate;
        result.likes = counts.likes;
        result.comments = counts.comments;
        result.shares = counts.shares;
        result.groupName = groupName;
        result.isReel = false;

        if (authorAndText.text) {
          let message = escapeMarkdown(authorAndText.text);
          if (message.length > 727) {
            message = message.substring(0, 727) + `... [View more](${url})`;
          }
          result.message = message;
        }

        const mediaUrls = [];
        for (const vid of authorAndText.videoLinks) {
          if (!mediaUrls.includes(vid)) mediaUrls.push(vid);
        }
        for (const img of authorAndText.imageLinks) {
          if (!mediaUrls.includes(img)) mediaUrls.push(img);
        }

        if (mediaUrls.length > 0) {
          const downloadPromises = mediaUrls.map((mediaUrl) => downloadMedia(mediaUrl));
          const downloads = await Promise.all(downloadPromises);

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
        }

        structuredParsingSucceeded = true;
      }
    } catch (structuredError) {
      console.log('[Facebook] Structured parsing failed, falling back to regex:', structuredError.message);
      structuredParsingSucceeded = false;
    }

    if (!structuredParsingSucceeded) {
      result.authorName = null;
      result.postDate = null;
      result.likes = null;
      result.comments = null;
      result.shares = null;
      result.groupName = null;
      result.isReel = false;

      const msgMatch = html.match(/"message":{"text":"(([^\\"]|\\.)*)"/);
      if (msgMatch && msgMatch[1] && msgMatch[1] !== "Explore more in Video") {
        let message = parseEscapedString(msgMatch[1]);
        message = escapeMarkdown(message);

        if (message.length > 727) {
          message = message.substring(0, 727) + `... [View more](${url})`;
        }
        result.message = message;
      }
      
      if (!result.message && mobilePostInfo.description) {
        console.log('[Facebook] Using og:description as message fallback');
        let message = escapeMarkdown(mobilePostInfo.description);
        if (message.length > 727) {
          message = message.substring(0, 727) + `... [View more](${url})`;
        }
        result.message = message;
      }

      const attachmentUrls = await parseAttachments(html);
      
      if (attachmentUrls.length === 0 && mobilePostInfo.thumbnailUrl) {
        console.log('[Facebook] No media from parsing, using og:image thumbnail as fallback');
        if (mobilePostInfo.thumbnailUrl.includes('fbcdn.net')) {
          attachmentUrls.push(mobilePostInfo.thumbnailUrl);
        }
      }

      const downloadPromises = attachmentUrls.map((mediaUrl) =>
        downloadMedia(mediaUrl)
      );
      const downloads = await Promise.all(downloadPromises);

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
};
