"""Candidate balance arithmetic and a 1D duel model, not the game simulation."""
import json
import math
import re
from itertools import combinations
from pathlib import Path

DT = 1 / 30
ARMOR_WEIGHT = {0: 0, 10: .05, 20: .10, 30: .20}
EFFECTS = {'none': (0, 0), 'blast': (.05, 40), 'arc': (.05, 30)}
EFFECT_DELAYS = {'blast': .05, 'burn': .10, 'frost': .05, 'arc': .05}
ACCESSORY_DELAYS = {'pierce': .05, 'bounce': .05, 'split': .10, 'return': .05,
                    'homing': .02, 'linger': .05, 'trail': .10, 'delay': 0, 'lob': .10}


def attack_interval(base, effect, accessories):
    return base + EFFECT_DELAYS[effect] + sum(ACCESSORY_DELAYS[item] for item in accessories)


def trail_count(initial_range, travelled):
    return min(4, math.floor(travelled / (initial_range / 5) + 1e-9))


def hit(armor, effect):
    damage = max(0, 50 - armor)
    if effect == 'blast':
        damage += max(0, 40 - armor)
    if effect == 'arc':
        damage += 30
    return damage


def duel(distance, kite, ranged_armor=0, melee_armor=0,
         ranged_effect='none', melee_effect='none', retreat_space=60):
    # Each side equips only the armor protecting against its opponent.
    rx, mx, rh, mh = 0., float(distance), 200., 400.
    rs = 12 * (1 - ARMOR_WEIGHT[ranged_armor])
    ms = 16 * (1 - ARMOR_WEIGHT[melee_armor])
    rc = mc = 0.
    bullets = []
    for tick in range(180 * 30):
        time = tick * DT
        previous_mx = mx
        if rh > 0 and mh > 0:
            if kite and mx - rx < 36 * .85:
                rx = max(-retreat_space, rx - rs * .75 * DT)
            mx = max(rx + 6, mx - ms * DT)
        gap = mx - rx
        if rh > 0 and mh > 0 and gap <= 36 and time + 1e-9 >= rc:
            bullets.append(rx)
            rc = time + .9 + EFFECTS[ranged_effect][0]
        hurt_ranged = hurt_melee = 0
        if mh > 0 and rh > 0 and gap <= 6 + 1e-8 and time + 1e-9 >= mc:
            hurt_ranged = hit(ranged_armor, melee_effect)
            mc = time + 1.1 + EFFECTS[melee_effect][0]
        live = []
        for position in bullets:
            end = position + 90 * DT
            if mh > 0 and position <= previous_mx and end >= mx:
                hurt_melee += hit(melee_armor, ranged_effect)
            elif end < mx:
                live.append(end)
        bullets = live
        rh -= hurt_ranged
        mh -= hurt_melee
        if mh <= 0 or rh <= 0 and not bullets:
            return {'winner': 'draw' if rh <= 0 and mh <= 0 else 'melee' if rh <= 0 else 'ranged',
                    'seconds': round(time, 2), 'ranged_hp': round(max(0, rh), 2),
                    'melee_hp': round(max(0, mh), 2)}
    raise AssertionError('Duel did not finish')


armor_rows = [
    {'armor': a, 'direct': hit(a, 'none'), 'direct_plus_blast': hit(a, 'blast'),
     'direct_plus_arc': hit(a, 'arc'), 'fire_per_tick': max(0, 10 - a),
     'hits_to_kill_ranged': math.ceil(200 / hit(a, 'none')),
     'hits_to_kill_melee': math.ceil(400 / hit(a, 'none'))}
    for a in ARMOR_WEIGHT
]
duels = []
for distance in [6, 24, 36]:
    for kite in [False, True]:
        duels.append({'distance': distance, 'kite': kite,
                      **duel(distance, kite)})
for effect in EFFECTS:
    for armor in [20, 30]:
        duels.append({'distance': 36, 'kite': True, 'ranged_effect': effect,
                      'melee_effect': 'none', 'ranged_armor': 0, 'melee_armor': armor,
                      **duel(36, True, 0, armor, effect)})
duels.append({'distance': 36, 'kite': True, 'retreat_space': 0,
              **duel(36, True, retreat_space=0)})
for a in ARMOR_WEIGHT:
    assert hit(a, 'none') == 50 - a
    assert hit(a, 'arc') - hit(a, 'none') == 30
assert duel(6, False)['winner'] == 'melee'
assert duel(36, True)['winner'] == 'ranged'
assert duel(36, True, retreat_space=0)['winner'] == 'melee'
assert 100 / 50 == 2  # Seconds of continuous exposure before freezing.
FIRE_DAMAGE = [10, 16, 24, 34]


def fire_dps(effect_level, armor):
    return 4 * max(0, FIRE_DAMAGE[effect_level] - armor)

assert fire_dps(0, 10) == 0
assert fire_dps(1, 10) == 24
assert fire_dps(1, 20) == 0
assert fire_dps(2, 20) == 16
assert fire_dps(2, 30) == 0
assert fire_dps(3, 30) == 16
fire_technology = [{'effect_level': level, 'fire_per_tick': damage,
                    'dps_against_armor_0_10_20_30': [fire_dps(level, armor) for armor in [0, 10, 20, 30]]}
                   for level, damage in enumerate(FIRE_DAMAGE)]
triples = list(combinations(ACCESSORY_DELAYS, 3))
cadence = {}
for weapon, base in [('rifle', .9), ('sword_upper_bound', 1.1)]:
    intervals = [attack_interval(base, effect, accessories) for effect in EFFECT_DELAYS for accessories in triples]
    assert len(intervals) == 336
    assert max(intervals) <= 1.5 + 1e-9
    cadence[weapon] = {'checked_combinations': len(intervals), 'maximum_interval': round(max(intervals), 2)}
for flight_range in [12, 36, 65, 330]:
    assert trail_count(flight_range, flight_range * .19) == 0
    assert trail_count(flight_range, flight_range * .2) == 1
    assert trail_count(flight_range, flight_range * .8) == 4
    assert trail_count(flight_range, flight_range * 2) == 4
research = []
headers = []
research_doc = Path(__file__).parent.parent / 'planning' / '研究室与科技树设计.md'
for line in research_doc.read_text(encoding='utf-8').splitlines():
    if not line.startswith('|'):
        headers = []
        continue
    cells = [cell.strip() for cell in line.strip('|').split('|')]
    if '科技名称' in cells and '金币' in cells:
        headers = cells
    elif headers and not all(set(cell) <= set('-: ') for cell in cells):
        time_index = headers.index('研发时间' if '研发时间' in headers else '时间')
        research.append({'name': cells[headers.index('科技名称')],
                         'gold': int(cells[headers.index('金币')]),
                         'seconds': int(re.search(r'\d+', cells[time_index]).group())})
assert len(research) == len({item['name'] for item in research}) == 30
assert sum(item['gold'] for item in research) == 9630
assert sum(item['seconds'] for item in research) == 1465
assert 1.3 / 1.3 == 1
assert 200 * 1.5 == 300 and 400 * 1.5 == 600
report = {
    'status': 'candidate values, not implemented or validated in the game engine',
    'assumptions': ['30 Hz 1D model; no formation, obstacles, suppression or collision congestion',
                    'duels use baseline combat stats; research upgrades are checked arithmetically, and kiting assumes an equipped distance chip',
                    'units begin ready to attack; simultaneous damage and in-flight shots retained',
                    'ranged retreats at 75% speed below 85% range; capped by available retreat space',
                    'all ranged shots hit; blast and arc include only one victim',
                    'fire, frost, weapon accessories, groups and production excluded from duels'],
    'armor': armor_rows, 'duels': duels,
    'cadence': {'effects': EFFECT_DELAYS, 'accessories': ACCESSORY_DELAYS, **cadence,
                'sword_compatibility': 'only pierce is currently proposed; the triple check is a conservative mathematical bound',
                'rifle_all_accessories_with_burn': round(attack_interval(.9, 'burn', ACCESSORY_DELAYS), 2)},
    'trail': {'additional_triggers_per_projectile': 4,
              'initial_range_fractions': [.2, .4, .6, .8],
              'maximum_effect_triggers_parent_and_three_children': 4 * (1 + 4)},
    'fire': {'raw_per_tick': 10, 'interval_seconds': .25, 'duration_seconds': 4,
             'maximum_ticks_from_one_region': 16, 'maximum_raw_damage': 160,
             'technology': fire_technology},
    'frost': {'cold_per_second': 50, 'threshold': 100, 'freeze_seconds': 1,
              'immune_seconds_after_thaw': 1, 'minimum_repeat_cycle_seconds': 4,
              'maximum_tier_freeze_fraction': 1.5 / (1 + 1.5 + 1)},
    'research': {'projects': research, 'total_gold': 9630, 'total_seconds_one_lab': 1465,
                 'health_multipliers': [1, 1.15, 1.3, 1.5],
                 'attack_frequency_multipliers': [1, 1.1, 1.2, 1.3],
                 'movement_multipliers': [1, 1.05, 1.1, 1.15]},
}
Path(__file__).with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
