const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync, execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const render = require('../utils/osu/embeds');
const contracts = require('./fixtures/osuPresentation/contracts.json');
const pin = require('./fixtures/osuPresentation/provenance.json');
const json = value => JSON.parse(JSON.stringify(value));
function actual(c) {
  const options = { ...c.options, mode: c.mode, calculation: c.calculation };
  const score = { ...c.score, beatmap: c.map };
  switch (c.kind) {
    case 'process-error': return { content: render.sourceErrorMessage(c.command, c.username, c.mode, c.userExists) };
    case 'profile': return { embeds: [json(render.profileEmbed(c.user, c.mode, options))] };
    case 'recent': return { content: render.recentHeader(c.user, c.mode), embeds: [json(render.scoreEmbed(score, c.user, options))] };
    case 'top': return { content: '', embeds: [json(render.scoreListEmbed(c.scores.map((s, i) => ({ ...s, beatmap: c.maps[i] })), c.user, options))] };
    case 'map': return json(render.beatmapMessage(c.maps || c.map, options));
    case 'whatif': return { content: render.whatIfMessage(c.user, c.scores, c.newPP) };
    case 'link': return { content: c.username === 'NONE' ? render.unlinkMessage(c.options.discordName) : !Object.keys(c.user).length ? render.missingLinkUserMessage(c.username) : render.linkMessage(c.options.discordName, c.user.username, c.options.exists) };
    case 'attempt': return render.attemptNumber(c.scores, c.options.beatmapId);
    default: throw new Error(c.kind);
  }
}
// Compare every UTF-8 string in its entirety, including trailing whitespace;
// object key order is irrelevant to the Discord payload, absent keys are not.
function exactPayload(actual, expected) {
  if (typeof expected === 'string') {
    assert.deepEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'));
  } else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((e, i) => exactPayload(actual[i], e));
  } else if (expected !== null && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    for (const key of Object.keys(expected)) exactPayload(actual[key], expected[key]);
  } else assert.equal(actual, expected);
}
for (const c of contracts) {
  test(`template contract (synthetic assets/calculations): ${c.name}`, () => {
    if (c.expected?.error) {
      // External asset resolution is intentionally fail-closed, rather than
      // turning the source KeyError into fabricated rank or difficulty text.
      if (c.name === 'recent-missing-rank') assert.throws(() => actual(c), /requires rank asset: A/);
      else if (c.name === 'map-missing-diff') assert.throws(() => actual(c), /requires difficulty asset: insane/);
      else if (c.name === 'recent-zero-hits') assert.throws(() => actual(c), { message: c.expected.error.message });
      else assert.fail(`Unhandled source failure: ${JSON.stringify(c.expected)}`);
    } else exactPayload(actual(c), c.expected);
  });
}
test('live AST oracle matches every complete stored payload and pins source bytes', { skip: !process.env.PRESENTATION_SOURCE_ROOT }, () => {
  assert.equal(execFileSync('git', ['-C', process.env.PRESENTATION_SOURCE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pin.revision);
  for (const [relative, digest] of Object.entries(pin.sha256)) assert.equal(createHash('sha256').update(readFileSync(path.join(process.env.PRESENTATION_SOURCE_ROOT, relative))).digest('hex'), digest);
  const result = spawnSync('python3', [path.join(__dirname, 'helpers/referencePresentation.py')], { input: JSON.stringify(contracts), encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  exactPayload(JSON.parse(result.stdout), contracts.map(c => c.expected));
});
test('mapped scores/maps require calculation contracts instead of invented PP or omitted details', () => {
  const c = contracts.find(c => c.kind === 'recent');
  assert.throws(() => render.scoreEmbed({ ...c.score, beatmap: c.map }, c.user, c.options), /requires calculation data/);
  assert.throws(() => render.scoreListEmbed([{ ...c.score, beatmap: c.map }], c.user, c.options), /requires calculation data/);
  assert.throws(() => render.beatmapEmbed(c.map, c.options), /requires calculation data/);
});
const unmapped = require('./fixtures/osuPresentation/unmapped.json');
for (const [index, c] of unmapped.cases.entries()) {
  test(`unmapped baseline output stays byte-identical: ${c.name} ${index}`, () => {
    exactPayload(json(render[c.name](...c.args)), c.expected);
  });
}
for (const mode of [0, 1, 2, 3]) {
  test(`template-only v2 adapter produces the complete original recent payload in mode ${mode}`, () => {
    const c = contracts.find(c => c.name === `recent-${mode}-A`);
    const m = c.map, s = c.score;
    const map = { id: m.beatmap_id, max_combo: m.max_combo, cs: m.cs, ar: m.ar,
      difficulty_rating: m.difficulty_rating, version: m.version,
      beatmapset: { id: m.beatmapset_id, title: m.title, artist: m.artist } };
    const score = { id: 999, total_score: Number(s.score), max_combo: s.max_combo, rank: s.rank,
      mods: ['HD', 'DT'], pp: s.pp, accuracy: 0.5, beatmap: map,
      ended_at: s.date.replace(' ', 'T') + 'Z', sourceCalculation: c.calculation,
      statistics: { great: s.count_300, ok: s.count_100, meh: s.count_50, miss: s.count_miss,
        perfect: s.count_geki, good: s.count_katu,
        large_tick_hit: s.count_100, small_tick_hit: s.count_50, small_tick_miss: s.count_katu } };
    const payload = { content: render.recentHeader(c.user, mode),
      embeds: [json(render.scoreEmbed(score, c.user, { ...c.options, mode }))] };
    exactPayload(payload, c.expected);
  });
}
test('template-only v2 profile adapter preserves the entire original payload', () => {
  const c = contracts.find(c => c.name === 'profile-mode-0');
  const u = c.user;
  const v2 = { id: u.user_id, username: u.username, country_code: u.country,
    is_online: u.is_online, discord: u.discord,
    statistics: { pp: Number(u.pp_raw), global_rank: Number(u.pp_rank), country_rank: Number(u.pp_country_rank),
      hit_accuracy: Number(u.accuracy), play_count: Number(u.playcount), play_time: u.total_seconds_played,
      level: { current: 100, progress: 25 }, grade_counts: { ssh: 2, ss: 0, sh: 3, s: 4, a: 5 } } };
  exactPayload({ embeds: [json(render.profileEmbed(v2, 0, c.options))] }, c.expected);
});
