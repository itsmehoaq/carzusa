"""One bounded, stdlib-only calculation. No bot imports, HTTP, or persistent state."""
import asyncio
import io
import json
import math
import sys

if sys.platform.startswith('linux'):
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
elif sys.platform == 'darwin':
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (10, resource.RLIM_INFINITY))
    # Darwin does not support RLIMIT_AS; the parent bounds resident memory.
else:
    raise RuntimeError('Unsupported performance worker platform')

import formulas
import score_utils
from vendor import engine


def validate_raw(raw):
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > 4 * 1024 * 1024:
        raise ValueError('Invalid beatmap size')
    if not raw.lstrip('\ufeff').startswith('osu file format v') or '[HitObjects]' not in raw:
        raise ValueError('Invalid beatmap file')
    section = None
    objects = 0
    for line in raw.splitlines():
        if len(line) > 65536:
            raise ValueError('Beatmap line is too large')
        if line.startswith('['):
            section = line.strip()
        elif section == '[HitObjects]' and line.strip() and not line.startswith('//'):
            objects += 1
            fields = line.split(',')
            if len(fields) < 5 or objects > 100000:
                raise ValueError('Invalid beatmap objects')
            if int(fields[3]) & 2:
                if len(fields) < 8 or not 1 <= int(fields[6]) <= 10000 or not 0 <= float(fields[7]) <= 10000000:
                    raise ValueError('Invalid slider limits')
    if not objects:
        raise ValueError('Empty beatmap')


async def calculate(request):
    raw = request['raw']
    validate_raw(raw)
    metadata = request['map']
    mode = int(metadata['mode'])
    if mode not in range(4):
        raise ValueError('Invalid ruleset')
    mods = request.get('mods', 0)
    mods = int(mods) if isinstance(mods, (int, float)) else score_utils.mod_to_num(mods)
    if not 0 <= mods < 2 ** 31:
        raise ValueError('Invalid mods')
    extra = request.get('extra', {})
    accs = request.get('accs', [95, 99, 100])
    if not 1 <= len(accs) <= 16 or any(not math.isfinite(a) or not 0 <= a <= 100 for a in accs):
        raise ValueError('Invalid accuracies')
    if mode == 0:
        parsed = engine.parser().map(io.StringIO(raw))
        result, _ = await formulas.get_std_data(metadata, parsed, accs=accs, mods=mods, extra_info=extra)
    else:
        method = [None, formulas.get_taiko_data, formulas.get_ctb_data, formulas.get_mania_data][mode]
        result, _ = await method(metadata, accs=accs, mods=mods, extra_info=extra)
    # Match owoAPI.get_full_beatmap_info: calculate first, then API metadata wins.
    if 'pp_mod' not in result:
        raise ValueError('Source engine did not calculate performance')
    result.update(metadata)
    return result


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError('Calculation input too large')
        result = asyncio.run(calculate(json.loads(data)))
        print(json.dumps(result, allow_nan=False, separators=(',', ':')))
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error)[:300], file=sys.stderr)
        sys.exit(1)
