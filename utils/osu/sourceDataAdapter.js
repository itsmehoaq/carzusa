// Presentation-only boundary. Calculation producers supply the original calc_info
// shape through score.sourceCalculation/map.sourceCalculation (or options.calculation).
const MODES = ['osu', 'taiko', 'fruits', 'mania'];
const MODS = ['NF','EZ','TD','HD','HR','SD','DT','RX','HT','NC','FL','Auto','SO','AP','PF','4K','5K','6K','7K','8K','FI','RDM','CI','TG','9K','10K','1K','3K','2K','V2','MI'];
const modeNumber = mode => typeof mode === 'number' || /^[0-3]$/.test(mode) ? Number(mode) : MODES.indexOf(mode);
const modeText = mode => ['osu! Standard', 'Taiko', 'Catch the Beat!', 'osu! Mania'][modeNumber(mode)] || 'osu! Standard';
function modNumber(mods) {
  if (typeof mods === 'number' || /^\d+$/.test(mods)) return Number(mods);
  let input = (Array.isArray(mods) ? mods.map(m => typeof m === 'string' ? m : m.acronym).join('') : mods || '').toUpperCase();
  let total = 0;
  if (input.includes('TD')) { total += 4; input = input.replaceAll('TD', ''); }
  for (let i = MODS.length - 1; i >= 0; i--) {
    if (input.includes(MODS[i])) {
      total += ({ NC: 576, PF: 16416 })[MODS[i]] || 2 ** i;
      input = input.replaceAll(MODS[i], '');
    }
  }
  return total;
}
function modList(value) {
  let number = Number(value);
  const list = [];
  for (let i = MODS.length - 1; i >= 0; i--) {
    if (MODS[i] === 'NC' && number >= 576) {
      number -= 576; list.push(MODS[i]); continue;
    } else if (MODS[i] === 'PF' && number >= 16416) {
      number -= 16416; list.push(MODS[i]); continue;
    }
    if (number >= 2 ** i) { number -= 2 ** i; list.push(MODS[i]); }
  }
  return list;
}
function fixMods(mods) {
  if (mods === 'PFSOFLNCHTRXDTSDHRHDEZNF') return '? KEY';
  mods = mods.replaceAll('DTHRHD', 'HDHRDT').replaceAll('DTHD', 'HDDT').replaceAll('HRHD', 'HDHR');
  if (mods.includes('PF') && mods.includes('SD')) mods = mods.replaceAll('SD', '');
  if (mods.includes('NC') && mods.includes('DT')) mods = mods.replaceAll('DT', '');
  return mods;
}
const dateText = value => value == null ? value : new Date(value).toISOString().slice(0, 19).replace('T', ' ');
function userData(user) {
  if ('user_id' in user) return user;
  const stats = user.statistics || {};
  const data = { user_id: user.id, username: user.username, country: user.country_code };
  for (const [source, target] of Object.entries({ pp: 'pp_raw', global_rank: 'pp_rank', country_rank: 'pp_country_rank', hit_accuracy: 'accuracy', play_count: 'playcount', play_time: 'total_seconds_played' })) {
    if (source in stats) data[target] = stats[source];
  }
  if (stats.level) data.level = stats.level.current + stats.level.progress / 100;
  for (const [source, target] of Object.entries({ ssh: 'ssh', ss: 'ss', xh: 'ssh', x: 'ss', sh: 'sh', s: 's', a: 'a' })) {
    if (source in (stats.grade_counts || {})) data[`count_rank_${target}`] = stats.grade_counts[source];
  }
  if ('is_online' in user) data.is_online = user.is_online;
  if (user.discord !== undefined || user.discord_tag !== undefined) data.discord = user.discord ?? user.discord_tag;
  return data;
}
function mapData(map) {
  if ('beatmap_id' in map) return map;
  const set = map.beatmapset || {};
  const data = { ...map, beatmap_id: map.id, beatmapset_id: set.id ?? map.beatmapset_id,
    title: set.title, artist: set.artist, creator: set.creator, user_id: set.user_id ?? map.user_id,
    mode: modeNumber(map.mode ?? map.mode_int ?? 0), od: map.accuracy, hp: map.drain,
    favourite_count: set.favourite_count, last_update: dateText(set.last_updated ?? map.last_updated),
    ranked_date: dateText(set.ranked_date), video: set.video };
  return data;
}
function scoreData(score, index = 1, mode = null) {
  if ('count_300' in score) return { ...score, play_idx: score.play_idx ?? index,
    enabled_mods: score.enabled_mods ?? modNumber(score.mods) };
  const stats = score.statistics || {};
  const data = { ...score, beatmap_id: score.beatmap?.id ?? score.beatmap_id,
    enabled_mods: score.enabled_mods ?? modNumber(score.mods), score: score.total_score,
    date: dateText(score.ended_at || score.created_at), play_idx: score.play_idx ?? index };
  const catchMode = (modeNumber(mode) === 2 || score.mode === 'fruits' || score.ruleset_id === 2 || score.mode_int === 2);
  for (const [key, modern] of Object.entries({ count_geki: 'perfect', count_300: 'great', count_katu: catchMode ? 'small_tick_miss' : 'good', count_100: catchMode ? 'large_tick_hit' : 'ok', count_50: catchMode ? 'small_tick_hit' : 'meh', count_miss: 'miss' })) data[key] = stats[key] ?? stats[modern] ?? 0;
  return data;
}
function calculationFor(score, map, options = {}) {
  const result = options.calculation ?? score?.sourceCalculation ?? map?.sourceCalculation;
  if (!result) throw new Error('Source presentation requires calculation data.');
  return result;
}
function asset(mapping, key, kind) {
  if (typeof mapping?.[key] !== 'string') throw new Error(`Source presentation requires ${kind} asset: ${key}.`);
  return mapping[key];
}
function emptyAssets() {
  return {
    rankEmotes: Object.fromEntries(['XH', 'X', 'SSH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F'].map(rank => [rank, ''])),
    diffEmotes: Object.fromEntries(MODES.map((_, mode) => [mode, Object.fromEntries(['easy', 'normal', 'hard', 'insane', 'expert', 'expertplus'].map(difficulty => [difficulty, '']))])),
  };
}
module.exports = { modeNumber, modeText, modNumber, modList, fixMods, userData, mapData, scoreData, calculationFor, asset, emptyAssets };
