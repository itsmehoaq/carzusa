const axios = require("axios");

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const REQUEST_TIMEOUT = 30000;

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

const getBaseHeaders = () => ({
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Cookie: process.env.FB_COOKIES || "",
  Dpr: "1",
  Pragma: "no-cache",
  "Sec-Ch-Prefers-Color-Scheme": "dark",
  "Sec-Ch-Ua":
    '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
  "Sec-Ch-Ua-Full-Version-List":
    '"Not_A Brand";v="8.0.0.0", "Chromium";v="120.0.6099.35", "Microsoft Edge";v="120.0.2210.39"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Model": '""',
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Ch-Ua-Platform-Version": '"15.0.0"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "Viewport-Width": "628",
});

const createSession = () => {
  return axios.create({
    timeout: REQUEST_TIMEOUT,
    headers: getBaseHeaders(),
    maxRedirects: 5,
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
      maxRedirects: 0,
      validateStatus: (status) => status < 400 || status === 302,
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

  const att1 = html.match(/\\"photo_attachments_list\\":\[([^\]]+)/);
  const att2 = html.match(/\\"photo_attachments_list\\":\\([^\]^,]+)/);
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

    const cacheBuster = `${directUrl.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
    const response = await session.get(directUrl + cacheBuster, {
      headers: {
        ...getBaseHeaders(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
    const html = response.data;

    const msgMatch = html.match(/"message":{"text":"(([^\\"]|\\.)*)"/);
    if (msgMatch && msgMatch[1] && msgMatch[1] !== "Explore more in Video") {
      let message = parseEscapedString(msgMatch[1]);
      message = escapeMarkdown(message);

      if (message.length > 1800) {
        message = message.substring(0, 1800) + `... [View more](${url})`;
      }
      result.message = message;
    }

    const attachmentUrls = await parseAttachments(html);

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
};
