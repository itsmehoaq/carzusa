// Python float formatting rounds the exact binary value, with ties to even.
function fixed(value, digits = 2, grouping = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || value == null || typeof value === 'string' && !value.trim()) throw new TypeError('Expected a finite source number.');
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, Math.abs(n));
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  const significand = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  const power = (exponent ? exponent - 1023 : -1022) - 52;
  let numerator = significand * 10n ** BigInt(digits);
  let denominator = 1n;
  if (power >= 0) numerator <<= BigInt(power); else denominator <<= BigInt(-power);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded % 2n) rounded++;
  let str = rounded.toString().padStart(digits + 1, '0');
  let whole = digits ? str.slice(0, -digits) : str;
  if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 || Object.is(n, -0) ? '-' : ''}${whole}${digits ? `.${str.slice(-digits)}` : ''}`;
}
const round = (n, digits = 0) => Number(fixed(n, digits));
const pyStr = value => value == null ? 'None' : typeof value === 'boolean' ? value ? 'True' : 'False' : String(value);
const floatStr = value => Number.isInteger(value) ? `${value}.0` : String(value);
const integer = value => {
  if (value == null || !Number.isFinite(Number(value)) || typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim())) throw new TypeError('Expected a source integer.');
  return Math.trunc(Number(value)).toLocaleString('en-US', { maximumFractionDigits: 0 });
};
function timeAgo(date, now = new Date()) {
  const start = new Date('0001-01-01T00:00:00Z').getTime();
  const then = new Date(date.includes('T') ? date : date.replace(' ', 'T') + 'Z');
  let delta = new Date(now).getTime() - then.getTime();
  // The source retries a future time with shifts of 2, then 8 hours.
  if (delta < 0) delta += 7200000;
  if (delta < 0) delta += 21600000;
  if (delta < 0 || !Number.isFinite(delta)) throw new RangeError('date value out of range');
  const result = new Date(start + delta);
  const parts = [result.getUTCFullYear() - 1, result.getUTCMonth(), result.getUTCDate() - 1, result.getUTCHours(), result.getUTCMinutes(), result.getUTCSeconds()];
  const labels = ['Year', 'Month', 'Day', 'Hour', 'Minute', 'Second'];
  let limit = 0, text = '';
  parts.forEach((value, i) => {
    if (i < 2 ? value !== 0 : limit !== 2 && (value !== 0 || i === 5)) {
      text += `${value} ${labels[i]}${value === 1 ? '' : 's'} `;
      limit++;
    }
  });
  return text;
}
function accuracy(score, mode) {
  const n = key => Number(score[`count_${key}`]);
  const total = mode === 1 ? n(300) + n(100) + n('miss') : n(300) + n(100) + n(50) + n('miss') + (mode === 2 || mode === 3 ? n('katu') : 0) + (mode === 3 ? n('geki') : 0);
  if (!total) throw new RangeError('float division by zero');
  if (mode === 2) return (n(300) + n(100) + n(50)) / total * 100;
  if (mode === 1) return (n(300) + n(100) * 0.5) * 300 / (total * 300) * 100;
  return (n(300) * 300 + n(100) * 100 + n(50) * 50 + (mode === 3 ? n('geki') * 300 + n('katu') * 200 : 0)) / (total * 300) * 100;
}
function breakdown(play, mode) {
  const keys = mode === 3 ? ['geki', 300, 'katu', 100, 50, 'miss'] : mode === 1 ? [300, 100, 'miss'] : [300, 100, 50, 'miss'];
  return `[${keys.map(k => pyStr(play[`count_${k}`])).join('/')}]`;
}
function keys(map, mode) {
  return mode === 3 && !map.version.toLowerCase().includes(`${pyStr(map.cs)}k`) ? `[${pyStr(map.cs)}k] ` : '';
}
function compare(data, a, b, digits = 2, single = false) {
  const first = Number(data[a]), second = Number(data[b]);
  if (data[a] == null || !Number.isFinite(first)) throw new TypeError(`Missing source attribute: ${a}.`);
  const changed = data[b] != null && Number.isFinite(second) && Math.abs(second - first) > Math.max(first, second) * .03 && second !== 0;
  return [changed ? single ? fixed(second, digits) : `${fixed(first, digits)}(${fixed(second, digits)})` : fixed(first, digits), changed];
}
function adjusted(info, param, mods, mode) {
  const { modList } = require('./sourceDataAdapter');
  const list = modList(mods).sort((a, b) => Number(['HT','DT','NC'].includes(b)) - Number(['HT','DT','NC'].includes(a)) || b.localeCompare(a));
  const str = fixed(round(info[param], 2));
  let result = str;
  for (const mod of list) {
    if (['HT','EZ'].includes(mod)) result = param === 'cs' && mod === 'HT' || mode === 3 && ['cs','od','hp'].includes(param) ? str : `${str}🠗`;
    else if (['DT','NC','HR'].includes(mod)) result = param === 'cs' && ['DT','NC'].includes(mod) || mode === 3 && ['cs','od','hp'].includes(param) ? str : `${str}🠕`;
  }
  return result;
}
const starArrow = str => str.includes('🠗') ? str.replaceAll('🠗', '') + '🠗' : str.includes('🠕') ? str.replaceAll('🠕', '') + '🠕' : str;
const accText = (score, mode, acc) => `${fixed(round(acc, 2))}%${mode === 3 ? ` ▸ ${Number(score.count_300) !== 0 ? fixed(Number(score.count_geki) / Number(score.count_300)) : '∞'}:1` : ''}`;
module.exports = { fixed, round, pyStr, floatStr, integer, timeAgo, accuracy, breakdown, keys, compare, adjusted, starArrow, accText };
