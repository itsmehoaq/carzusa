const COMMAND_ALIASES = {
  // recent
  rs: { command: "recent" },
  recent: { command: "recent" },
  r: { command: "recent" },
  rsm: { command: "recent", defaultMode: "mania" },
  rm: { command: "recent", defaultMode: "mania" },
  recentm: { command: "recent", defaultMode: "mania" },
  rst: { command: "recent", defaultMode: "taiko" },
  rt: { command: "recent", defaultMode: "taiko" },
  recentt: { command: "recent", defaultMode: "taiko" },
  rsc: { command: "recent", defaultMode: "fruits" },
  rc: { command: "recent", defaultMode: "fruits" },
  recentc: { command: "recent", defaultMode: "fruits" },

  // top
  top: { command: "top" },
  osutop: { command: "top" },
  best: { command: "top" },
  topm: { command: "top", defaultMode: "mania" },
  bestm: { command: "top", defaultMode: "mania" },
  topt: { command: "top", defaultMode: "taiko" },
  bestt: { command: "top", defaultMode: "taiko" },
  topc: { command: "top", defaultMode: "fruits" },
  bestc: { command: "top", defaultMode: "fruits" },

  // profile
  osu: { command: "profile" },
  profile: { command: "profile" },
  user: { command: "profile" },
  u: { command: "profile" },
  me: { command: "profile" },
  osum: { command: "profile", defaultMode: "mania" },
  osut: { command: "profile", defaultMode: "taiko" },
  osuc: { command: "profile", defaultMode: "fruits" },
  maniaprofile: { command: "profile", defaultMode: "mania" },
  taikoprofile: { command: "profile", defaultMode: "taiko" },
  ctbprofile: { command: "profile", defaultMode: "fruits" },
  fruitsprofile: { command: "profile", defaultMode: "fruits" },

  // map
  map: { command: "map" },
  m: { command: "map" },
  beatmap: { command: "map" },

  // whatif
  whatif: { command: "whatif" },
  wi: { command: "whatif" },

  // bws
  bws: { command: "bws" },

  // matchcost
  mc: { command: "matchcost" },
  matchcost: { command: "matchcost" },

  // link
  link: { command: "link" },
  set: { command: "link" },

  // unlink
  unlink: { command: "unlink" },
  avatar: { command: "avatar" }, av: { command: "avatar" }, pfp: { command: "avatar" },
  pinned: { command: "pinned" }, pin: { command: "pinned" }, p: { command: "pinned" },
  tpin: { command: "pinned", defaultMode: "taiko" },
  cpin: { command: "pinned", defaultMode: "fruits" },
  mpin: { command: "pinned", defaultMode: "mania" },
  mostplayed: { command: "mostplayed" }, mp: { command: "mostplayed" },
  checkname: { command: "checkname" }, cn: { command: "checkname" },
  namecheck: { command: "checkname" }, claimname: { command: "checkname" },
  badge: { command: "badge" }, badges: { command: "badge" }, badgelist: { command: "badge" },
  reach: { command: "reach" },
  treach: { command: "reach", defaultMode: "taiko" },
  creach: { command: "reach", defaultMode: "fruits" },
  mreach: { command: "reach", defaultMode: "mania" },
  rank: { command: "rank" },
  trank: { command: "rank", defaultMode: "taiko" },
  crank: { command: "rank", defaultMode: "fruits" },
  mrank: { command: "rank", defaultMode: "mania" },
  pp: { command: "pp" },
  tpp: { command: "pp", defaultMode: "taiko" },
  cpp: { command: "pp", defaultMode: "fruits" },
  mpp: { command: "pp", defaultMode: "mania" },
  scorepost: { command: "scorepost" }, post: { command: "scorepost" },
};

function normalizeMode(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (["osu", "standard", "std", "s"].includes(s)) return "osu";
  if (["taiko", "t"].includes(s)) return "taiko";
  if (["fruits", "catch", "ctb", "c"].includes(s)) return "fruits";
  if (["mania", "m"].includes(s)) return "mania";
  return null;
}

function tokenize(input) {
  if (!input) return [];
  const tokens = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}

function parsePrefixCommand(content) {
  if (!content || typeof content !== "string") return null;
  const trimmed = content.trim();
  if (trimmed.length < 2) return null;

  const prefix = trimmed[0];
  if (prefix !== ">" && prefix !== "<") return null;

  const match = trimmed.match(/^([><])([a-zA-Z0-9_]+)(?:[\s\r\n]+(.*))?$/s);
  if (!match) return null;

  const rawCmd = match[2].toLowerCase();
  const aliasDef = COMMAND_ALIASES[rawCmd];
  if (!aliasDef) return null;

  const command = aliasDef.command;
  if (command === "checkname") {
    // Preserve whitespace so an invalid name cannot become a different, valid lookup.
    const raw = match[3] || "";
    const query = /^(".*"|'.*')$/.test(raw) ? raw.slice(1, -1) : raw;
    return { isCommand: true, prefix, alias: rawCmd, command, options: { query: query || null } };
  }
  let mode = aliasDef.defaultMode || null;
  let include_fails = null;
  let index = null;
  let badges = null;
  let warmups = null;
  let skip = null;
  let ez = null;
  let plays = null;
  let each = null;

  const rawTokens = tokenize(match[3] || "");
  const positional = [];

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    const lower = token.toLowerCase();
    if (["reach", "rank", "pp"].includes(command) && ["-plays", "--plays", "-each", "--each"].includes(lower) && i + 1 < rawTokens.length) {
      const value = Number(rawTokens[++i]);
      if (lower.endsWith("plays")) plays = value;
      else each = value;
      continue;
    }

    // Mode flags
    if ((lower === "-m" || lower === "-mode" || lower === "--mode") && i + 1 < rawTokens.length) {
      const parsed = normalizeMode(rawTokens[i + 1]);
      if (parsed) {
        mode = parsed;
        i++;
        continue;
      }
    }
    if (["-osu", "--osu", "-std", "--std"].includes(lower)) {
      mode = "osu";
      continue;
    }
    if (["-taiko", "--taiko"].includes(lower)) {
      mode = "taiko";
      continue;
    }
    if (["-fruits", "--fruits", "-catch", "--catch", "-ctb", "--ctb"].includes(lower)) {
      mode = "fruits";
      continue;
    }
    if (["-mania", "--mania"].includes(lower)) {
      mode = "mania";
      continue;
    }

    // Fails flags (recent)
    if (["-nofail", "--nofail", "-nf", "+nf", "-fails:false", "-fails:no"].includes(lower)) {
      include_fails = false;
      continue;
    }
    if (["-fails:true", "-fails:yes"].includes(lower)) {
      include_fails = true;
      continue;
    }

    // Page and index flags require a complete positive integer token.
    if (["-i", "-index", "--index", "-p", "-page", "--page"].includes(lower)) {
      const value = rawTokens[++i];
      if (!/^[1-9]\d*$/.test(value)) return null;
      index = Number(value);
      if (!Number.isSafeInteger(index)) return null;
      continue;
    }

    // Badges flags (bws)
    if ((lower === "-b" || lower === "-badge" || lower === "-badges") && i + 1 < rawTokens.length) {
      const val = parseInt(rawTokens[i + 1], 10);
      if (!isNaN(val)) {
        badges = val;
        i++;
        continue;
      }
    }

    // Matchcost flags
    if ((lower === "-w" || lower === "-warmup" || lower === "-warmups") && i + 1 < rawTokens.length) {
      const val = parseInt(rawTokens[i + 1], 10);
      if (!isNaN(val)) {
        warmups = val;
        i++;
        continue;
      }
    }
    if ((lower === "-s" || lower === "-skip") && i + 1 < rawTokens.length) {
      const val = parseInt(rawTokens[i + 1], 10);
      if (!isNaN(val)) {
        skip = val;
        i++;
        continue;
      }
    }
    if (lower === "-ez" && i + 1 < rawTokens.length) {
      const val = parseFloat(rawTokens[i + 1]);
      if (!isNaN(val)) {
        ez = val;
        i++;
        continue;
      }
    }

    positional.push(token);
  }

  let options = {};

  if (command === "unlink") {
    options = {};
  } else if (command === "scorepost") {
    options = { score_id_or_url: positional[0] || null };
  } else if (["reach", "rank", "pp"].includes(command)) {
    const target = positional.shift() || null;
    if (positional.length > 1 && !mode) {
      const possibleMode = normalizeMode(positional[positional.length - 1]);
      if (possibleMode) { mode = possibleMode; positional.pop(); }
    }
    options = { username: positional.join(" ") || null, mode, plays, each };
    if (command === "rank") options.rank = target;
    else if (command === "reach") options.target_user = target;
    else options.target_pp = target === null ? null : Number(target);
  } else if (command === "link") {
    let username = null;
    if (positional.length > 0) {
      if (positional.length > 1 && !mode) {
        const possibleMode = normalizeMode(positional[positional.length - 1]);
        if (possibleMode) {
          mode = possibleMode;
          username = positional.slice(0, -1).join(" ");
        } else {
          username = positional.join(" ");
        }
      } else {
        username = positional.join(" ");
      }
    }
    options = { username: username || null, mode: mode || null };
  } else if (command === "map") {
    options = { beatmap_id_or_url: positional[0] || null };
  } else if (command === "matchcost") {
    options = {
      match_id_or_url: positional[0] || null,
      warmups: warmups !== null ? warmups : null,
      skip: skip !== null ? skip : null,
      ez: ez !== null ? ez : null,
    };
  } else if (command === "whatif") {
    let pp = null;
    const remaining = [];
    for (const tok of positional) {
      if (pp === null && /^-?\d+(?:\.\d+)?$/.test(tok)) {
        pp = parseFloat(tok);
      } else {
        remaining.push(tok);
      }
    }
    let username = null;
    if (remaining.length > 0) {
      if (remaining.length > 1 && !mode) {
        const possibleMode = normalizeMode(remaining[remaining.length - 1]);
        if (possibleMode) {
          mode = possibleMode;
          username = remaining.slice(0, -1).join(" ");
        } else {
          username = remaining.join(" ");
        }
      } else {
        username = remaining.join(" ");
      }
    }
    options = {
      pp,
      username: username || null,
      mode: mode || null,
    };
  } else if (command === "bws") {
    let username = null;
    if (positional.length > 0) {
      if (positional.length > 1 && !mode) {
        const possibleMode = normalizeMode(positional[positional.length - 1]);
        if (possibleMode) {
          mode = possibleMode;
          username = positional.slice(0, -1).join(" ");
        } else {
          username = positional.join(" ");
        }
      } else {
        username = positional.join(" ");
      }
    }
    options = {
      badges: badges !== null ? badges : null,
      username: username || null,
      mode: mode || null,
    };
  } else if (["recent", "top", "pinned"].includes(command)) {
    let username = null;
    const maxIndex = command === "recent" ? 50 : 100;

    if (index === null) {
      if (positional.length === 1) {
        const tok = positional[0];
        if (/^\d+$/.test(tok) && !tok.startsWith("<@")) {
          const num = parseInt(tok, 10);
          if (num >= 1 && num <= maxIndex) {
            index = num;
          } else {
            username = tok;
          }
        } else {
          username = tok;
        }
      } else if (positional.length >= 2) {
        const firstNum = /^\d+$/.test(positional[0]) ? parseInt(positional[0], 10) : null;
        const lastNum = /^\d+$/.test(positional[positional.length - 1]) ? parseInt(positional[positional.length - 1], 10) : null;
        if (lastNum !== null && lastNum >= 1 && lastNum <= maxIndex) {
          index = lastNum;
          username = positional.slice(0, -1).join(" ");
        } else if (firstNum !== null && firstNum >= 1 && firstNum <= maxIndex) {
          index = firstNum;
          username = positional.slice(1).join(" ");
        } else {
          if (!mode) {
            const possibleMode = normalizeMode(positional[positional.length - 1]);
            if (possibleMode) {
              mode = possibleMode;
              username = positional.slice(0, -1).join(" ");
            } else {
              username = positional.join(" ");
            }
          } else {
            username = positional.join(" ");
          }
        }
      }
    } else {
      if (positional.length > 0) {
        if (positional.length > 1 && !mode) {
          const possibleMode = normalizeMode(positional[positional.length - 1]);
          if (possibleMode) {
            mode = possibleMode;
            username = positional.slice(0, -1).join(" ");
          } else {
            username = positional.join(" ");
          }
        } else {
          username = positional.join(" ");
        }
      }
    }

    if (username && !mode) {
      const words = username.split(/\s+/);
      if (words.length > 1) {
        const possibleMode = normalizeMode(words[words.length - 1]);
        if (possibleMode) {
          mode = possibleMode;
          username = words.slice(0, -1).join(" ");
        }
      }
    }

    options = {
      username: username || null,
      mode: mode || null,
      index: index !== null ? index : 1,
    };
    if (command === "recent") {
      options.include_fails = include_fails !== null ? include_fails : true;
    }
  } else if (["profile", "avatar", "mostplayed", "badge"].includes(command)) {
    let username = null;
    if (positional.length > 0) {
      if (positional.length > 1 && !mode) {
        const possibleMode = normalizeMode(positional[positional.length - 1]);
        if (possibleMode) {
          mode = possibleMode;
          username = positional.slice(0, -1).join(" ");
        } else {
          username = positional.join(" ");
        }
      } else {
        username = positional.join(" ");
      }
    }
    options = {
      username: username || null,
      mode: mode || null,
    };
    if (["mostplayed", "badge"].includes(command)) options.page = index ?? 1;
  }

  return {
    isCommand: true,
    prefix,
    alias: rawCmd,
    command,
    options,
  };
}

module.exports = {
  parsePrefixCommand,
  COMMAND_ALIASES,
  normalizeMode,
  tokenize,
};
