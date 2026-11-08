"""Independent oracle: execute the original research snapshot, never the port."""
import ast
import asyncio
import io
import json
import math
from pathlib import Path
import types

root = Path(__file__).parent
tree = ast.parse((root / 'oracle.py').read_text())
payload = ast.literal_eval(next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'payload' for t in n.targets)))
engine = types.ModuleType('pyttanko')
exec(payload['engine'], engine.__dict__)
utils = types.ModuleType('utils')
exec(payload['utils'], utils.__dict__)
ns = {'math': math, 'utils': utils, 'pyttanko': engine}
exec(payload['calc'], ns)


async def main():
    results = []
    for case in json.loads((root / 'cases.json').read_text()):
        request = case['request']
        metadata = request['map']
        mode = metadata['mode']
        fun = ns[['get_std_data', 'get_taiko_data', 'get_ctb_data', 'get_mania_data'][mode]]
        args = [metadata]
        if mode == 0:
            args.append(engine.parser().map(io.StringIO((root / case['rawFile']).read_text())))
        try:
            result, _ = await fun(*args, mods=request['mods'], accs=request.get('accs', [95, 99, 100]), extra_info=request['extra'])
            result.update(metadata)
            results.append({'name': case['name'], 'result': result})
        except Exception as error:
            results.append({'name': case['name'], 'error': type(error).__name__ + ':' + str(error)})
    print(json.dumps(results, sort_keys=True))


asyncio.run(main())
