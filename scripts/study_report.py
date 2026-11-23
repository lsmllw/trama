"""Resume os JSON do estudo (scripts/study.ts) em métricas para o relatório."""
import json
import math
import sys
from collections import Counter, defaultdict

FILES = {
    'vv': 'veterano × veterano',
    'vr': 'veterano × recruta',
    'vg': 'veterano × guloso',
    'va': 'veterano × aleatório',
    'rg': 'recruta × guloso',
    'ga': 'guloso × aleatório',
    'gg': 'guloso × guloso',
}
base = sys.argv[1] if len(sys.argv) > 1 else '/tmp/study'
out = {}
for key, label in FILES.items():
    try:
        d = json.load(open(f'{base}/{key}.json'))
    except FileNotFoundError:
        continue
    a = d['a']
    games = d['games']
    n = len(games)
    win = draw = lose = 0
    gd = []
    goals = shots = 0
    xg_for_winner_lower = 0
    xg_decided = 0
    side = Counter()
    passes = Counter()
    duels = Counter()
    duel_kind = defaultdict(Counter)
    turn = Counter()
    poss = acts = 0
    opts = 0.0
    optn = 0
    fouls = dk = k4 = dp = du = 0
    shots_all = []
    for g in games:
        sa = 'azul' if g['azul'] == a else 'vermelho'
        sb = 'vermelho' if sa == 'azul' else 'azul'
        if g['azul'] == g['vermelho']:
            sa, sb = 'azul', 'vermelho'
        diff = g['score'][sa] - g['score'][sb]
        gd.append(diff)
        if diff > 0:
            win += 1
        elif diff == 0:
            draw += 1
        else:
            lose += 1
        side[g['winner'] or 'empate'] += 1
        goals += g['score']['azul'] + g['score']['vermelho']
        shots += len(g['shots'])
        xg = Counter()
        for s in g['shots']:
            xg[s['team']] += 1 if s['open'] else s['pUniform']
            shots_all.append(s)
        if g['winner'] in ('azul', 'vermelho'):
            w = g['winner']
            l = 'vermelho' if w == 'azul' else 'azul'
            if abs(xg[w] - xg[l]) > 1e-9:
                xg_decided += 1
                if xg[w] < xg[l]:
                    xg_for_winner_lower += 1
        for k, v in g['passes'].items():
            passes[k] += v
        for du_ in g['duels']:
            duels[du_['outcome']] += 1
            duel_kind[du_['kind']][du_['outcome']] += 1
        for k, v in g['turnovers'].items():
            turn[k] += v
        poss += g['possessions']
        acts += g['activations']
        opts += g['optionsSum']
        optn += g['optionsN']
        fouls += g['fouls']
        dk += g['directKicks']
        k4 += g['keeper4s']
        dp += g['drinksPicked']
        du += g['drinksUsed']
    mean = sum(gd) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in gd) / max(1, n - 1))
    shot_res = Counter(s['result'] for s in shots_all)
    guess = [s for s in shots_all if not s['blocked'] and not s['open'] and 0 < s['pUniform'] < 1]
    counters = sum(1 for s in shots_all if s['counter'])
    goals_counter = sum(1 for s in shots_all if s['counter'] and s['result'] == 'gol')
    out[key] = {
        'label': label,
        'n': n,
        'a': a,
        'win': win / n,
        'draw': draw / n,
        'lose': lose / n,
        'points_a': (3 * win + draw) / n,
        'gd_mean': mean,
        'gd_sd': sd,
        'goals_pm': goals / n,
        'shots_pm': shots / n,
        'conv': shot_res['gol'] / max(1, len(shots_all)),
        'shot_results': dict(shot_res),
        'shots_guess_share': len(guess) / max(1, len(shots_all)),
        'mean_p_uniform': sum(s['pUniform'] for s in shots_all if not s['blocked']) / max(1, sum(1 for s in shots_all if not s['blocked'])),
        'blocked_share': sum(1 for s in shots_all if s['blocked']) / max(1, len(shots_all)),
        'open_share': sum(1 for s in shots_all if s['open']) / max(1, len(shots_all)),
        'counter_shot_share': counters / max(1, len(shots_all)),
        'counter_goal_share': goals_counter / max(1, shot_res['gol']),
        'shot_dist_mean': sum(s['dist'] for s in shots_all) / max(1, len(shots_all)),
        'shooter_roles': dict(Counter(s['role'] for s in shots_all)),
        'goal_roles': dict(Counter(s['role'] for s in shots_all if s['result'] == 'gol')),
        'winner_lower_xg': xg_for_winner_lower / max(1, xg_decided),
        'side': dict(side),
        'passes_pm': {k: v / n for k, v in passes.items()},
        'duels_pm': sum(duels.values()) / n,
        'duel_outcomes': dict(duels),
        'duel_by_kind': {k: dict(v) for k, v in duel_kind.items()},
        'turnovers_pm': {k: v / n for k, v in turn.items()},
        'possessions_pm': poss / n,
        'activations_pm': acts / n,
        'options_per_activation': opts / max(1, optn),
        'fouls_pm': fouls / n,
        'direct_pm': dk / n,
        'keeper4s_pm': k4 / n,
        'drinks_picked_pm': dp / n,
        'drinks_used_pm': du / n,
        'ms_per_game': d['ms'] / n,
    }
json.dump(out, open(f'{base}/summary.json', 'w'), indent=1, ensure_ascii=False)
for k, v in out.items():
    print(f"{v['label']:24s} n={v['n']:3d} V {v['win']:.2f} E {v['draw']:.2f} D {v['lose']:.2f} | saldo {v['gd_mean']:+.2f}±{v['gd_sd']:.2f} | gols {v['goals_pm']:.2f} chutes {v['shots_pm']:.1f} conv {v['conv']:.2f}")
