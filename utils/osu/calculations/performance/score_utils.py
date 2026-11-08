# Copied verbatim from owo-bot f7651f3; see THIRD_PARTY_NOTICES.md.


def calculate_acc(beatmap, gamemode):
    gamemode = int(gamemode)
    
    user_score = 0
    if gamemode == 0:
        total_unscale_score = float(beatmap['count_300'])
        total_unscale_score += float(beatmap['count_100'])
        total_unscale_score += float(beatmap['count_50'])
        total_unscale_score += float(beatmap['count_miss'])
        total_unscale_score *=300
        user_score = float(beatmap['count_300']) * 300.0
        user_score += float(beatmap['count_100']) * 100.0
        user_score += float(beatmap['count_50']) * 50.0
    elif gamemode == 1:
        total_unscale_score = float(beatmap['count_300'])
        total_unscale_score += float(beatmap['count_100'])
        total_unscale_score += float(beatmap['count_miss'])
        total_unscale_score *= 300
        user_score = float(beatmap['count_300']) * 1.0
        user_score += float(beatmap['count_100']) * 0.5
        user_score *= 300
    elif gamemode == 2:
        total_unscale_score = float(beatmap['count_300'])
        total_unscale_score += float(beatmap['count_100'])
        total_unscale_score += float(beatmap['count_50'])
        total_unscale_score += float(beatmap['count_miss'])
        total_unscale_score += float(beatmap['count_katu'])
        user_score = float(beatmap['count_300'])
        user_score += float(beatmap['count_100'])
        user_score  += float(beatmap['count_50'])
    elif gamemode == 3:
        total_unscale_score = float(beatmap['count_300'])
        total_unscale_score += float(beatmap['count_geki'])
        total_unscale_score += float(beatmap['count_katu'])
        total_unscale_score += float(beatmap['count_100'])
        total_unscale_score += float(beatmap['count_50'])
        total_unscale_score += float(beatmap['count_miss'])
        total_unscale_score *=300
        user_score = float(beatmap['count_300']) * 300.0
        user_score += float(beatmap['count_geki']) * 300.0
        user_score += float(beatmap['count_katu']) * 200.0
        user_score += float(beatmap['count_100']) * 100.0
        user_score += float(beatmap['count_50']) * 50.0

    return (float(user_score)/float(total_unscale_score)) * 100.0


def num_to_mod(number):
    # print('UTILS numtomod', number)
    mods = [
        'NF','EZ','TD','HD','HR','SD','DT','RX','HT','NC','FL','Auto',
        'SO','AP','PF','4K','5K','6K','7K','8K','FI','RDM','CI','TG',
        '9K','10K','1K','3K','2K','V2','MI'
    ]
    number = int(number)
    mod_list = []

    for mod_idx in range(len(mods)-1, -1, -1):
        mod = mods[mod_idx]
        # print(mods[mod_idx], mod_idx, 2**mod_idx)
        if mod == 'NC':
            if number >= 576:
                number -= 576
                mod_list.append(mod)
                continue
        elif mod == 'PF':
            if number >= 16416:
                number -= 16416
                mod_list.append(mod)
                continue

        if number >= 2**mod_idx:
            number -= 2**mod_idx
            mod_list.append(mod)

    # print('UTIL NUM2MOD', mod_list)

    return mod_list


def mod_to_num(input_mods:str):
    # Function checked.
    mods = [
        'NF','EZ','TD','HD','HR','SD','DT','RX','HT','NC','FL','Auto',
        'SO','AP','PF','4K','5K','6K','7K','8K','FI','RDM','CI','TG',
        '9K','10K','1K','3K','2K','V2','MI'
    ]
    input_mods = input_mods.upper()
    total = 0

    # remove TD first becuase it interferes with HD/DT
    if 'TD' in input_mods:
        total += 4
        input_mods = input_mods.replace('TD', '')

    for mod_idx in range(len(mods)-1, -1, -1):
        if mods[mod_idx] in input_mods:
            if mods[mod_idx] == 'DT':
                total += 64
            elif mods[mod_idx] == 'NC':
                total += 576
            elif mods[mod_idx] == 'SD':
                total += 32
            elif mods[mod_idx] == 'PF':
                total += 16416
            else:
                total += 2**mod_idx
            input_mods = input_mods.replace(mods[mod_idx], '')

    # print('UTIL MOD2NUM', total)

    return int(total)

