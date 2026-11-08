# Copied verbatim from owo-bot f7651f3; see THIRD_PARTY_NOTICES.md.
import math
import score_utils as utils
from vendor import engine as pyttanko


async def get_std_data(beatmap_info, bmp_parsed,
    accs=[95, 99, 100], mods=0, extra_info={}):

    bmap = bmp_parsed

    key_append = '_mod'
    beatmap_id = beatmap_info['beatmap_id']

    # let pyttanko handle calculations
    ret_json = {}
    try:
        stars = pyttanko.diff_calc().calc(bmap, mods=mods)
    except:
        return beatmap_info, None

    ret_json['stars'+key_append] = float(stars.total)
    ret_json['aim_stars'+key_append] = float(stars.aim)
    ret_json['speed_stars'+key_append] = float(stars.speed)
    # print(beatmap_info.keys())
    if 'max_combo' not in beatmap_info:
        # print('Using parsed max combo')
        ret_json['max_combo'] = bmap.max_combo()
    else:
        # print('Using bmp max combo')
        ret_json['max_combo'] = beatmap_info['max_combo']
    ret_json['cs'] = float(bmap.cs)
    ret_json['od'] = float(bmap.od)
    ret_json['ar'] = float(bmap.ar)
    ret_json['hp'] = float(bmap.hp)
    _, ar_mod, od_mod, cs_mod, hp_mod = pyttanko.mods_apply(mods, 
        ar=bmap.ar, od=bmap.od, cs=bmap.cs, hp=bmap.hp)
    ret_json['cs'+key_append] = float(cs_mod)
    ret_json['od'+key_append] = float(od_mod)
    ret_json['ar'+key_append] = float(ar_mod)
    ret_json['hp'+key_append] = float(hp_mod)

    ret_json['accs'] = accs
    ret_json['pp'+key_append] = []
    ret_json['aim_pp'+key_append] = []
    ret_json['speed_pp'+key_append] = []
    ret_json['acc_pp'+key_append] = [] 

    ret_json["hit_length"+key_append], _ = time_mod(
        beatmap_info["hit_length"], beatmap_info['bpm'], mods)
    ret_json["total_length"+key_append], ret_json["bpm_mod"] = \
        time_mod(beatmap_info["total_length"], beatmap_info['bpm'], mods)

    for acc in accs:
        misses = 0
        n300, n100, n50 = pyttanko.acc_round(acc, len(bmap.hitobjects), misses)
        pp, aim_pp, speed_pp, acc_pp, _ = pyttanko.ppv2(
            stars.aim, stars.speed, bmap=bmap, mods=mods,
            n300=n300, n100=n100, n50=n50, nmiss=misses, combo=bmap.max_combo())
        ret_json['pp'+key_append].append(float(pp))
        ret_json['aim_pp'+key_append].append(float(aim_pp))
        ret_json['speed_pp'+key_append].append(float(speed_pp))
        ret_json['acc_pp'+key_append].append(float(acc_pp))
    
    ret_json['extra_info'] = {}
    if extra_info:
        if 'play_info' in extra_info.keys():
            play_info = extra_info['play_info']

            # clean up the data
            for hit_type in ['300', '100', '50', 'miss', 'geki', 'katu']:
                if 'count_{}'.format(hit_type) not in play_info.keys():
                    play_info['count_{}'.format(hit_type)] = 0

            # get fc data
            fc_info = {}
            missing_hits = int(bmap.max_combo()) - (
                int(play_info['count_300']) + int(play_info['count_100']) + \
                int(play_info['count_50']) + int(play_info['count_miss']))
            fc_info['count_300'] = int(play_info['count_300']) + \
                int(play_info['count_miss']) + missing_hits
            fc_info['count_100'] = int(play_info['count_100'])
            fc_info['count_50'] = int(play_info['count_50'])
            fc_info['count_miss'] = 0
            ret_json['extra_info']['fc_pp'], _, _, _, _ = pyttanko.ppv2(
                stars.aim, stars.speed, bmap=bmap, mods=mods,
                n300=fc_info['count_300'], n100=fc_info['count_100'], 
                n50=fc_info['count_50'], nmiss=fc_info['count_miss'], 
                combo=int(bmap.max_combo()))
            ret_json['extra_info']['fc_acc'] = float(utils.calculate_acc(fc_info, 0))

            # calculate play pp
            total_hits = int(play_info['count_300']) + int(play_info['count_geki']) + \
                    int(play_info['count_100']) + int(play_info['count_katu']) + \
                    int(play_info['count_50'])
            total_misses = int(play_info['count_miss']) # + bmap.max_combo() - total_hits
            ret_json['extra_info']['play_pp'], _, _, _, _ = pyttanko.ppv2(
                stars.aim, stars.speed, bmap=bmap, mods=mods,
                n300=int(play_info['count_300']) + int(play_info['count_geki']), 
                n100=int(play_info['count_100']) + int(play_info['count_katu']), 
                n50=int(play_info['count_50']), nmiss=total_misses, 
                combo=int(play_info['max_combo']))
            ret_json['extra_info']['play_acc'] = float(utils.calculate_acc(play_info, 0))

            # get map completion
            if play_info['rank'] == 'F':
                completion_hits = int(play_info['count_50']) + \
                int(play_info['count_100']) + \
                int(play_info['count_300']) + \
                int(play_info['count_miss'])

                numobj = completion_hits - 1
                timing = int(bmap.hitobjects[-1].time) - int(bmap.hitobjects[0].time)
                point = int(bmap.hitobjects[numobj].time) - int(bmap.hitobjects[0].time)
                ret_json['extra_info']['map_completion'] = (point / timing) * 100
            else:
                ret_json['extra_info']['map_completion'] = 100

    return ret_json, bmap


async def get_taiko_data(beatmap_info, accs=[95, 99, 100], mods=0, extra_info={}):
    key_append = '_mod'
    beatmap_id = beatmap_info['beatmap_id']
    """
    file_path = await download_beatmap(beatmap_id, 
        status=handle_status(beatmap_info))"""

    mods_list = utils.num_to_mod(mods)    

    ret_json = {}
    ret_json['accs'] = accs
    # handle mod specifics
    if 'beatmap_mod' in extra_info.keys():
        beatmap_mod = extra_info['beatmap_mod']
    else:
        beatmap_mod = beatmap_info

    ret_json["stars"+key_append] = float(beatmap_mod['difficulty_rating'])
    ret_json["hit_length"+key_append], _ = time_mod(
        beatmap_mod["hit_length"], beatmap_mod['bpm'], mods)
    ret_json["total_length"+key_append], ret_json["bpm_mod"] = time_mod(
        beatmap_mod["total_length"], beatmap_mod['bpm'], mods)
    ret_json['pp'+key_append] = await _get_taiko_pp(beatmap_info, beatmap_mod, mods=mods)
    ret_json['cs'+key_append] = beatmap_mod['cs']
    ret_json['od'+key_append] = beatmap_mod['od']
    ret_json['ar'+key_append] = beatmap_mod['ar']
    ret_json['hp'+key_append] = beatmap_mod['hp']

    ret_json['extra_info'] = {}
    if extra_info:
        if 'play_info' in extra_info.keys():
            play_info = extra_info['play_info']

            # print(play_info)

            # get fc data
            fc_info = {}
            fc_info['count_300'] = int(play_info['count_300']) + \
                int(play_info['count_miss'])
            fc_info['count_100'] = int(play_info['count_100'])
            fc_info['count_50'] = int(play_info['count_50'])
            fc_info['count_miss'] = 0
            fc_pp = await _get_taiko_pp(beatmap_info, beatmap_mod,
                play_info=fc_info)
            ret_json['extra_info']['fc_pp'] = fc_pp[0]
            ret_json['extra_info']['fc_acc'] = float(utils.calculate_acc(fc_info, 1))

            # calculate play pp
            total_hits = int(play_info['count_300']) + int(play_info['count_geki']) + \
                    int(play_info['count_100']) + int(play_info['count_katu']) + \
                    int(play_info['count_50'])
            total_misses = int(play_info['count_miss']) # + bmap.max_combo() - total_hits
            play_pp = await _get_taiko_pp(beatmap_info, beatmap_mod,
                play_info=play_info)
            ret_json['extra_info']['play_pp'] = play_pp[0]
            ret_json['extra_info']['play_acc'] = float(utils.calculate_acc(play_info, 1))

    return ret_json, None


async def _get_taiko_pp(beatmap_info, beatmap_mod, 
    mods=0, play_info=None, accs=[95,99,100]):
    mods_list = utils.num_to_mod(mods)

    stars = float(beatmap_mod['difficulty_rating'])
    try:
        total_hits = int(beatmap_info['count_circles'])
    except:
        total_hits = int(beatmap_info['max_combo'])
    od_mod = _get_hit_window(float(beatmap_info['od']), mods_list)
    max_combo = total_hits

    strain = float(beatmap_info['difficulty_rating'])
    try:
        hit_count = int(beatmap_info['count_circles'])
    except:
        hit_count = int(beatmap_info['max_combo'])

    if hit_count == 0: # avoid division by 0?..
        hit_count = 1500

    if play_info:
        misses = int(play_info['count_miss'])
    else:
        misses = 0
    usercombo = hit_count - misses

    final_pp = []
    for acc in accs:
        hundreds = round((1 - misses/hit_count - acc/100) * 2 * hit_count)

        strain_value = math.pow(max(1, strain/0.0075) * 5 - 4,2)/100000
        length_bonus = min(1, hit_count/1500) * 0.1 + 1
        strain_value *= length_bonus
        strain_value *= math.pow(0.985, misses)
        strain_value *= min(math.pow(usercombo, 0.5) / math.pow(hit_count,0.5),1)
        strain_value *= acc/100
        acc_value = math.pow(150/od_mod,1.1) * math.pow(acc/100,15) * 22
        acc_value *= min(math.pow(hit_count/1500,0.3),1.15)

        mod_multiplier = 1.10
        if "HD" in mods_list:
            mod_multiplier *= 1.10
            strain_value *= 1.025
        if "NF" in mods_list:
            mod_multiplier *= 0.90
        if "FL" in mods_list:
            strain_value *= 1.05 * length_bonus

        total_value = math.pow(math.pow(strain_value,1.1) + \
            math.pow(acc_value,1.1),1.0/1.1) * mod_multiplier
        pp = round(total_value * 100) / 100
        final_pp.append(pp)

    return final_pp


def _scale_od(od, mod_list):
    if "EZ" in mod_list:
        od /= 2
    if "HR" in mod_list:
        od *= 1.4
    od = max(min(od, 10), 0)
    return od


def _get_hit_window(od, mod_list):
    od = _scale_od(od, mod_list)
    max_val = 20
    min_val = 50
    result = min_val + (max_val - min_val) * od / 10
    result = math.floor(result) - 0.5
    
    if "HT" in mod_list:
        result /= 0.75
    if "DT" in mod_list:
        result /= 1.5

    # 2 decimals
    return round(result * 100) / 100


async def get_ctb_data(beatmap_info, accs=[95, 99, 100], mods=0, extra_info={}):
    key_append = '_mod'
    beatmap_id = beatmap_info['beatmap_id']

    """
    file_path = await download_beatmap(beatmap_id, 
        status=handle_status(beatmap_info))""" 

    mods_list = utils.num_to_mod(mods)    

    ret_json = {}
    ret_json['accs'] = accs
    # handle mod specifics
    if 'beatmap_mod' in extra_info.keys():
        beatmap_mod = extra_info['beatmap_mod']
    else:
        beatmap_mod = beatmap_info

    ret_json["stars"+key_append] = float(beatmap_mod['difficulty_rating'])
    if "HR" in mods_list:
        ret_json["stars"+key_append] *= 1.23
    if "DT" in mods_list:
        ret_json["stars"+key_append] *= 1.46

    ret_json["hit_length"+key_append], _ = time_mod(
        beatmap_mod["hit_length"], beatmap_mod['bpm'], mods)
    ret_json["total_length"+key_append], ret_json["bpm_mod"] = time_mod(
        beatmap_mod["total_length"], beatmap_mod['bpm'], mods)
    ret_json['pp'+key_append] = await _get_ctb_pp(beatmap_info, beatmap_mod, mods=mods)
    ret_json['cs'+key_append] = beatmap_mod['cs']
    ret_json['od'+key_append] = beatmap_mod['od']
    ret_json['ar'+key_append] = beatmap_mod['ar']
    ret_json['hp'+key_append] = beatmap_mod['hp']

    ret_json['extra_info'] = {}
    if extra_info:
        if 'play_info' in extra_info.keys():
            play_info = extra_info['play_info']

            # print(play_info)

            # get fc data
            fc_info = {}
            fc_info['count_300'] = int(play_info['count_300']) + \
                int(play_info['count_miss'])
            fc_info['count_100'] = int(play_info['count_100'])
            fc_info['count_50'] = int(play_info['count_50'])
            fc_info['count_miss'] = 0
            fc_info['max_combo'] = int(play_info['max_combo'])
            fc_pp = await _get_ctb_pp(beatmap_info, beatmap_mod,
                play_info=fc_info)
            ret_json['extra_info']['fc_pp'] = fc_pp[0]
            ret_json['extra_info']['fc_acc'] = float(utils.calculate_acc(fc_info, 1))

            # calculate play pp
            total_hits = int(play_info['count_300']) + int(play_info['count_geki']) + \
                    int(play_info['count_100']) + int(play_info['count_katu']) + \
                    int(play_info['count_50'])
            total_misses = int(play_info['count_miss']) # + bmap.max_combo() - total_hits
            play_pp = await _get_ctb_pp(beatmap_info, beatmap_mod,
                play_info=play_info)
            ret_json['extra_info']['play_pp'] = play_pp[0]
            ret_json['extra_info']['play_acc'] = float(utils.calculate_acc(play_info, 1))

    return ret_json, None


async def _get_ctb_pp(beatmap_info, beatmap_mod, play_info=None, accs=[95, 99, 100], mods=0):
    # adapated from https://pakachan.github.io/osustuff/ppcalculator.html
    mods_list = utils.num_to_mod(mods)

    stars = float(beatmap_mod['difficulty_rating'])
    if stars == 0:
        stars = float(beatmap_info['difficulty_rating'])
    if "HR" in mods_list:
        stars *= 1.23
    if "DT" in mods_list:
        stars *= 1.46
    
    if 'max_combo' in beatmap_info and beatmap_info['max_combo']:
        max_combo = int(beatmap_info['max_combo'])
    else:
        try:
            max_combo = int(beatmap_info['count_circles']) + \
                int(beatmap_info['count_sliders']) + \
                int(beatmap_info['count_spinners'])
        except:
            return [0] * len(accs)

    od = float(beatmap_mod['od'])
    ar = float(beatmap_mod['ar'])

    # print(play_info)
    if play_info:
        combo = int(play_info['max_combo']) # player combo
        misses = int(play_info['count_miss'])
    else:
        combo = max_combo
        misses = 0

    # print('Stars', stars)
    final_pp = []
    for acc in accs:
        # Conversion from Star rating to pp
        final = math.pow(((5*stars/0.0049)-4), 2)/100000 
        # Length Bonus
        lengthbonus = (0.95 + 0.3 * min(1.0, max_combo / 2500.0))
        if max_combo > 2500:
            lengthbonus += math.log10(max_combo / 2500.0) * 0.475
        final *= lengthbonus
        # Miss Penalty
        final *= math.pow(0.97, misses)
        # Not FC combo penalty
        final *= math.pow(combo/max_combo, 0.8)
        # AR Bonus
        ar_bonus = 1
        if ar > 9:
            ar_bonus += 0.1 * (ar - 9.0)
        if ar > 10:
            ar_bonus += 0.1 * (ar - 10.0)
        if ar < 8:
            ar_bonus += 0.025 * (8.0 - ar)
        final *= ar_bonus
        # Hidden bonus
        hidden_bonus = 1
        if ar > 10:
            hidden_bonus = 1.01 + 0.04 * (11 - min(11, ar))
        else:
            hidden_bonus = 1.05 + 0.075 * (10 - ar)
        # Acc Penalty
        final *= math.pow(acc/100, 5.5)

        # mod bonuses
        if "HD" in mods_list:
            final *= hidden_bonus
        if "FL" in mods_list:
            final *= 1.35

        final_pp.append(final)

    return final_pp


async def get_mania_data(beatmap_info, accs=[95, 99, 100], mods=0, extra_info={}):
    key_append = '_mod'
    beatmap_id = beatmap_info['beatmap_id']

    """
    file_path = await download_beatmap(beatmap_id, 
        status=handle_status(beatmap_info))"""

    mods_list = utils.num_to_mod(mods)    

    ret_json = {}
    ret_json['accs'] = accs
    # handle mod specifics
    if 'beatmap_mod' in extra_info.keys():
        beatmap_mod = extra_info['beatmap_mod']
    else:
        beatmap_mod = beatmap_info

    ret_json["stars"+key_append] = float(beatmap_mod['difficulty_rating'])

    ret_json["hit_length"+key_append], _ = time_mod(
        beatmap_mod["hit_length"], beatmap_mod['bpm'], mods)
    ret_json["total_length"+key_append], ret_json["bpm_mod"] = time_mod(
        beatmap_mod["total_length"], beatmap_mod['bpm'], mods)
    ret_json['pp'+key_append] = await _get_mania_pp(beatmap_mod, mods=mods, accs=accs)
    ret_json['cs'+key_append] = beatmap_mod['cs']
    ret_json['od'+key_append] = beatmap_mod['od']
    ret_json['ar'+key_append] = beatmap_mod['ar']
    ret_json['hp'+key_append] = beatmap_mod['hp']

    if 'DT' in mods_list: # regression fit
        ret_json["stars"+key_append] = 1.45 * ret_json["stars"+key_append] - 0.2

    ret_json['extra_info'] = {}
    if extra_info:
        if 'play_info' in extra_info.keys():
            play_info = extra_info['play_info']

            # print(play_info)

            # get fc data
            # print('fc data')
            fc_info = {}
            fc_info['count_300'] = int(play_info['count_300']) + \
                int(play_info['count_miss'])
            fc_info['count_100'] = int(play_info['count_100'])
            fc_info['count_50'] = int(play_info['count_50'])
            fc_info['count_miss'] = 0
            fc_pp = await _get_mania_pp(beatmap_info, mods=mods,
                play_info=fc_info)
            ret_json['extra_info']['fc_pp'] = fc_pp[0]
            ret_json['extra_info']['fc_acc'] = float(utils.calculate_acc(fc_info, 1))

            # calculate play pp
            # print('play data')
            total_hits = int(play_info['count_300']) + int(play_info['count_geki']) + \
                    int(play_info['count_100']) + int(play_info['count_katu']) + \
                    int(play_info['count_50'])
            total_misses = int(play_info['count_miss']) # + bmap.max_combo() - total_hits
            play_pp = await _get_mania_pp(beatmap_info, mods=mods,
                play_info=play_info)
            ret_json['extra_info']['play_pp'] = play_pp[0]
            ret_json['extra_info']['play_acc'] = float(utils.calculate_acc(play_info, 1))

    return ret_json, None


async def _get_mania_pp(beatmap_info, play_info=None, accs=[95, 99, 100], mods=0):
    # calculate full pp
    # adapated from https://pcca.nctu.me/ompp
    # print(mods)
    mods_list = utils.num_to_mod(mods)

    if 'max_combo' in beatmap_info and beatmap_info['max_combo']:
        objects_count = int(beatmap_info['max_combo'])
    else:
        try:
            objects_count = int(beatmap_info['count_circles']) + \
                int(beatmap_info['count_sliders'])
        except:
            return [0] * len(accs)
    """
    try:
        objects_count = int(beatmap_info['count_circles']) + int(beatmap_info['count_sliders'])
    except:
        return [0]"""

    od = float(beatmap_info['od'])
    stars = float(beatmap_info['difficulty_rating'])
    if 'DT' in mods_list: # regression fit
        stars = 1.45 * stars - 0.2

    if not play_info or 'score' not in play_info:
        score = 1000000
    else:
        score = float(play_info['score'])

    # score multiplier
    score_rate = 1
    if "EZ" in mods_list:
        score_rate *= 0.5
    if "NF" in mods_list:
        score_rate *= 0.5
    if "HT" in mods_list:
        score_rate *= 0.5

    real_score = score # / score_rate # calculation

    hit300_window = 34 + 3 * (min(10, max(0, 10 - od)))
    strain_value = (5 * max(1, stars / 0.2) - 4) ** 2.2 / 135 * (1 + 0.1 * min(1, objects_count / 1500))
    if real_score <= 500000:
        strain_value = 0
    elif real_score <= 600000:
        strain_value *= (real_score - 500000) / 100000 * 0.3
    elif real_score <= 700000:
        strain_value *= 0.3 + (real_score - 600000) / 100000 * 0.25
    elif real_score <= 800000:
        strain_value *= 0.55 + (real_score - 700000) / 100000 * 0.20
    elif real_score <= 900000:
        strain_value *= 0.75 + (real_score - 800000) / 100000 * 0.15
    else:
        strain_value *= 0.9 + (real_score - 900000) / 100000 * 0.1

    acc_value = max(0, 0.2 - ((hit300_window - 34) * 0.006667)) * strain_value * \
        (max(0, real_score - 960000) / 40000) ** 1.1

    pp_multiplier = 0.8
    if 'NF' in mods_list:
        pp_multiplier *= 0.9
    if 'EZ' in mods_list:
        pp_multiplier *= 0.5

    pp_full = (strain_value ** 1.1 + acc_value ** 1.1) ** (1 / 1.1) * pp_multiplier

    final_pp = []
    for acc in accs:
        final_pp.append(pp_full * (acc/100))
    return final_pp


def time_mod(length_sec, bpm, mod_num):
    length_sec = float(length_sec)
    bpm = float(bpm)
    mod_list = utils.num_to_mod(mod_num)

    if 'DT' in mod_list or 'NC' in mod_list:
        factor = 3/2
    elif 'HT' in mod_list:
        factor = 2/3
    else:
        factor = 1

    length_mod, bpm_mod = length_sec/factor, bpm*factor
    return length_mod, bpm_mod

