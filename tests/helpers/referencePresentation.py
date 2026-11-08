"""Execute pinned original AST bodies. External services/Discord/clock only are stubbed.

PRESENTATION_SOURCE_ROOT must point to the original checkout. Fixtures are template
contracts; their injected emote tokens and calculation values are not runtime proof.
"""
import ast
import asyncio
import datetime
import hashlib
import json
import os
from pathlib import Path
import random
import sys
import types
import operator

ROOT = Path(os.environ['PRESENTATION_SOURCE_ROOT'])
PIN = json.loads((Path(__file__).parent.parent / 'fixtures/osuPresentation/provenance.json').read_text())
SOURCES = {}
for relative, digest in PIN['sha256'].items():
    source = (ROOT / relative).read_bytes()
    if hashlib.sha256(source).hexdigest() != digest:
        raise RuntimeError('Reference source hash mismatch: ' + relative)
    SOURCES[relative] = ast.parse(source)


def find(tree, name):
    return next(n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)


def load(nodes, namespace):
    # Nodes/bodies are compiled unchanged, rather than reimplementing templates.
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), '<pinned-reference>', 'exec'), namespace)


class Embed:
    def __init__(self, description=None, colour=None):
        self.data = {'type': 'rich'}
        if description is not None:
            self.description = description
        if colour is not None:
            self.colour = colour

    def __setattr__(self, name, value):
        if name in ('description', 'colour'):
            self.data['color' if name == 'colour' else name] = value
        else:
            object.__setattr__(self, name, value)

    def set_author(self, name, url=None, icon_url=None):
        self.data['author'] = dict(name=str(name))
        if url is not None:
            self.data['author']['url'] = str(url)
        if icon_url is not None:
            self.data['author']['icon_url'] = str(icon_url)

    def set_footer(self, text, icon_url=None):
        self.data['footer'] = dict(text=str(text))
        if icon_url is not None:
            self.data['footer']['icon_url'] = str(icon_url)

    def set_thumbnail(self, url):
        self.data['thumbnail'] = dict(url=str(url))

    def set_image(self, url):
        self.data['image'] = dict(url=str(url))

    def add_field(self, name, value, inline=True):
        self.data.setdefault('fields', []).append(dict(name=str(name), value=str(value), inline=inline))


class Clock(datetime.datetime):
    current = '2026-11-08T12:00:00'
    @classmethod
    def utcnow(cls):
        return cls.fromisoformat(cls.current)


utils_ns = {'datetime': datetime}
load([find(SOURCES['cogs/osu/osu_utils/utils.py'], name) for name in
      ['time_ago', 'determine_plural', 'get_gamemode_text', 'calculate_acc', 'fix_mods', 'num_to_mod', 'mod_to_num']], utils_ns)
utils = types.SimpleNamespace(**utils_ns)
METHODS = ['create_user_embed', '_get_online_icon', 'create_recent_play_embed',
           '_get_attempt_num', 'create_play_list_embed', 'disp_beatmap', '_fix_star_arrow',
           'adjust_val_str_mod', 'compare_val_params', '_get_dl_links',
           '_determine_status_color', '_get_score_breakdown', '_get_keys', '_determine_emote_name', 'process_set_user']
namespace = {'discord': types.SimpleNamespace(Embed=Embed), 'utils': utils,
             'datetime': types.SimpleNamespace(datetime=Clock), 'operator': operator,
             'asyncio': types.SimpleNamespace(sleep=lambda _: noop()),
             'map_utils': types.SimpleNamespace(handle_status=lambda b: b['status'])}
load([find(SOURCES['cogs/osu/osu.py'], name) for name in METHODS], namespace)
Reference = type('Reference', (), {name: namespace[name] for name in METHODS})
# Extract the complete original wif branch without changing its arithmetic/body.
branch = next(n for n in ast.walk(find(SOURCES['cogs/osu/osu.py'], 'process_user_top'))
              if isinstance(n, ast.If) and ast.unparse(n.test) == "options['wif'] is not None")
wrapper = ast.parse('async def whatif(ctx, options, userinfo, full_play_list):\n    pass').body[0]
wrapper.body = [branch]
load([wrapper], namespace)

api_ns = {'random': types.SimpleNamespace(randint=lambda a, b: 7)}
API_METHODS = ['get_beatmap_thumbnail', 'get_beatmap_url', 'get_server_avatar', 'get_server_name',
               'get_user_avatar', 'get_country_flag_url', 'get_user_url']
load([find(SOURCES['cogs/osu/osu_utils/owoAPI.py'], name) for name in API_METHODS], api_ns)
API = type('API', (), {name: api_ns[name] for name in API_METHODS})
# Original Bancho constructor constant assignments, unchanged AST.
api_tree = SOURCES['cogs/osu/osu_utils/owoAPI.py']
ctor = next(n for n in ast.walk(api_tree) if isinstance(n, ast.FunctionDef) and n.name == '__init__'
            and any(isinstance(x, ast.Assign) and isinstance(x.value, ast.Constant) and x.value.value == 'Bancho' for x in n.body))
attrs = ['name', 'symbol_url', 'user_url_base', 'avatar_url']
constants = [n for n in ctor.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Attribute) and n.targets[0].attr in attrs]
server = types.SimpleNamespace()
load(constants, dict(self=server))


async def noop(*args, **kwargs):
    return None


async def render(case):
    opts = case.get('options', {})
    Clock.current = opts.get('now', '2026-11-08T12:00:00Z').removesuffix('Z')
    api_ns['random'].randint = lambda a, b: opts.get('randomInt', 7)
    user = case.get('user', {})
    maps = case.get('maps', [case.get('map', {})])
    scores = case.get('scores', [case.get('score', {})])
    sent = []
    async def send(content=None, embed=None, **kwargs):
        payload = {}
        if content is not None:
            payload['content'] = content
        if embed is not None:
            payload['embeds'] = [embed.data]
        sent.append(payload)
        return payload
    author = types.SimpleNamespace(name=opts.get('discordName', 'Tester'), discriminator='0',
                                   id=1, colour=opts.get('color', 0))
    author.guild = types.SimpleNamespace(id=1)
    ctx = types.SimpleNamespace(message=types.SimpleNamespace(author=author, guild=author.guild,
                               channel=types.SimpleNamespace(send=send)), send=send)
    api = API()
    api.get_api = lambda _: server
    api.is_online = lambda *a: user.get('is_online', False)
    async def get_map(*a, **kw):
        return maps
    async def get_calc(b, **kw):
        index = next((i for i, m in enumerate(maps) if m['beatmap_id'] == b['beatmap_id']), 0)
        calc = case.get('calculations', [case.get('calculation')])[index]
        if calc is None:
            raise RuntimeError('missing calculation')
        return calc, None, None
    api.get_beatmap = get_map
    api.get_full_beatmap_info = get_calc
    ref = Reference()
    ref.owoAPI = api
    ref.RANK_EMOTES = opts.get('rankEmotes', {})
    ref.DIFF_EMOTES = opts.get('diffEmotes', {})
    ref.MAX_MAP_DISP = 3
    mode = case.get('mode', 0)
    kind = case['kind']
    if kind == 'process-error':
        # Execute original error send statements, with only their external
        # username/mode/API data supplied. No parser or branch body is rewritten.
        method = {'profile': 'process_user_info', 'recent': 'process_user_recent', 'top': 'process_user_top'}[case['command']]
        prefix = {
            ('profile', False): ':red_circle:',
            ('recent', False): '**`{}` was not found or no recent plays',
            ('recent', True): '**`{}` has no recent plays',
            ('top', False): '**`{}` not found in',
            ('top', True): '**`{}` was not found or not enough plays',
        }[(case['command'], case['userExists'])]
        body = find(SOURCES['cogs/osu/osu.py'], method)
        statement = next(n for n in sorted(ast.walk(body), key=lambda n: getattr(n, 'lineno', 0)) if isinstance(n, (ast.Return, ast.Expr))
                         and isinstance(n.value, ast.Await)
                         and isinstance(n.value.value, ast.Call)
                         and any(isinstance(c, ast.Constant) and isinstance(c.value, str) and c.value.startswith(prefix)
                                 for c in ast.walk(n.value.value)))
        wrapper = ast.parse('async def error_statement(self, ctx, username, gamemode, api="bancho"):\n    pass').body[0]
        wrapper.body = [statement]
        load([wrapper], namespace)
        await namespace['error_statement'](ref, ctx, case['username'], mode)
        return sent[0]
    if kind == 'profile':
        embed = await ref.create_user_embed(ctx, user, mode)
        return dict(embeds=[embed.data])
    if kind == 'recent':
        content, embed, _ = await ref.create_recent_play_embed(ctx, user, case['score'], mode, attempt_num=opts.get('attemptNum'))
        return dict(content=content, embeds=[embed.data])
    if kind == 'top':
        content, embed = await ref.create_play_list_embed(ctx, user, scores, maps, mode,
                      header_txt=opts['header'], page_info=opts.get('pageInfo'))
        return dict(content=content, embeds=[embed.data])
    if kind == 'map':
        await ref.disp_beatmap(ctx.message, maps, mods=opts.get('mods', ''), extra_info=opts.get('extraInfo', {}))
        return sent[0]
    if kind == 'whatif':
        return await namespace['whatif'](ctx, dict(wif=case['newPP']), user, scores)
    if kind == 'link':
        ref.update_user_servers_list = noop
        ref.determine_api = lambda _: 'bancho'
        ref.remove_api_suffix = lambda a: a
        ref.players = types.SimpleNamespace(update_one=noop)
        ref.create_new_user = noop
        async def exists(*a):
            return opts.get('exists', False)
        ref.check_user_exists = exists
        async def get_user(*a, **kw):
            return [user] if user else []
        api.get_user = get_user
        await ref.process_set_user(ctx, case['username'], {})
        return sent[0]
    if kind == 'attempt':
        return ref._get_attempt_num(scores, mode, opts.get('beatmapId'))
    raise ValueError(kind)


async def main():
    cases = json.load(sys.stdin)
    output = []
    for case in cases:
        try:
            output.append(await render(case))
        except Exception as exc:
            output.append({'error': {'type': type(exc).__name__, 'message': str(exc)}})
    print(json.dumps(output, ensure_ascii=False))

asyncio.run(main())
