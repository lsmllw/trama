// Escolha do canto (quem chuta) ou do mergulho (goleiro) num chute ao gol.

import { getPlayer, ROLES, shotResult } from '../core';
import type { Corner, GameState, Player, ShotPreview } from '../core';
import { clear, h } from './dom';
import { playerSprite } from './sprites';

export const CORNER_NAME: Record<Corner, string> = {
  esq: 'Esquerda',
  meio: 'Meio',
  dir: 'Direita',
};
const CORNERS: Corner[] = ['esq', 'meio', 'dir'];

export interface ShotChoiceContext {
  s: GameState;
  shooter: Player;
  preview: ShotPreview;
  /** 'chute' = você chuta e escolhe o canto; 'defesa' = você é o goleiro e escolhe o mergulho. */
  role: 'chute' | 'defesa';
  title: string;
  /** Escolha já feita pelo outro lado (quando você lê o adversário). */
  revealed?: Corner | null;
  /** X/Esc desiste do chute (só quando é você quem chuta, numa jogada normal). */
  cancellable?: boolean;
}

/** Desenha o gol visto de quem chuta, com o goleiro no meio. */
function goalScene(s: GameState, pv: ShotPreview, hover: Corner | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const W = 300;
  const H = 130;
  c.width = W;
  c.height = H;
  c.className = 'goal-scene';
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#1d2233';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d4a463';
  g.fillRect(0, 100, W, 30);
  // Rede.
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  for (let x = 40; x <= 260; x += 10) {
    g.beginPath();
    g.moveTo(x, 18);
    g.lineTo(x, 100);
    g.stroke();
  }
  for (let y = 18; y <= 100; y += 10) {
    g.beginPath();
    g.moveTo(40, y);
    g.lineTo(260, y);
    g.stroke();
  }
  // Zonas.
  CORNERS.forEach((k, i) => {
    const x = 40 + (220 / 3) * i;
    if (hover === k) {
      g.fillStyle = 'rgba(255,225,77,0.28)';
      g.fillRect(x, 18, 220 / 3, 82);
    }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(CORNER_NAME[k], x + 110 / 3, 32);
  });
  // Traves.
  g.fillStyle = '#ffffff';
  g.fillRect(36, 14, 6, 88);
  g.fillRect(258, 14, 6, 88);
  g.fillRect(36, 14, 228, 6);
  // Goleiro.
  const keeper = pv.keeperId ? getPlayer(s, pv.keeperId) : null;
  if (keeper && !pv.open) {
    const spr = playerSprite(keeper, 'arms', 'front');
    g.drawImage(spr, 150 - spr.width * 1.5, 102 - spr.height * 3, spr.width * 3, spr.height * 3);
  } else {
    g.fillStyle = '#7dff9a';
    g.font = 'bold 16px system-ui, sans-serif';
    g.fillText('GOL VAZIO!', 150, 70);
  }
  if (pv.blockerId) {
    const b = getPlayer(s, pv.blockerId);
    const spr = playerSprite(b, 'idle', 'front');
    g.drawImage(spr, 100 - spr.width * 2, 128 - spr.height * 4, spr.width * 4, spr.height * 4);
  }
  return c;
}

/** Abre a janela e devolve o canto escolhido. */
export function chooseShotCorner(ctx: ShotChoiceContext): Promise<Corner | null> {
  const { s, shooter, preview: pv, role } = ctx;
  const bg = h('div', { class: 'modal-bg' });
  const box = h('div', { class: 'modal shot-modal' });
  bg.append(box);
  document.body.append(bg);
  let hover: Corner | null = null;

  return new Promise<Corner | null>((resolve) => {
    const pick = (k: Corner | null) => {
      document.removeEventListener('keydown', onKey);
      bg.remove();
      resolve(k);
    };
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Corner> = {
        '1': 'esq',
        '2': 'meio',
        '3': 'dir',
        ArrowLeft: 'esq',
        ArrowUp: 'meio',
        ArrowDown: 'meio',
        ArrowRight: 'dir',
      };
      if (map[e.key]) {
        e.preventDefault();
        if (e.key.startsWith('Arrow')) {
          hover = map[e.key];
          render();
        } else pick(map[e.key]);
      } else if ((e.key === ' ' || e.key === 'Enter') && hover) {
        e.preventDefault();
        pick(hover);
      } else if ((e.key === 'Escape' || e.key.toLowerCase() === 'x') && ctx.cancellable) {
        e.preventDefault();
        pick(null);
      }
    };
    document.addEventListener('keydown', onKey);

    const odds = (k: Corner) => {
      // Chance de gol (para quem chuta) ou de defesa (para o goleiro), supondo o outro ao acaso.
      if (ctx.revealed) return role === 'chute' ? (shotResult(pv, k, ctx.revealed) === 'gol' ? 1 : 0) : shotResult(pv, ctx.revealed, k) === 'defesa' ? 1 : 0;
      let n = 0;
      for (const o of CORNERS) {
        const r = role === 'chute' ? shotResult(pv, k, o) : shotResult(pv, o, k);
        if (role === 'chute' ? r === 'gol' : r === 'defesa') n++;
      }
      return n / 3;
    };

    const render = () => {
      clear(box);
      const keeper = pv.keeperId ? getPlayer(s, pv.keeperId) : null;
      const facts: string[] = [];
      facts.push(`Força do chute ${pv.force} × Reflexo ${pv.ref}${keeper?.muralha ? ' (Muralha)' : ''}`);
      facts.push(`Distância ${pv.dist.toFixed(1)} casas`);
      if (pv.blockerId) facts.push(`${getPlayer(s, pv.blockerId).name} está na frente: o chute vai ser bloqueado!`);
      if (pv.open) facts.push('O goleiro saiu da área: gol vazio.');
      const scene = goalScene(s, pv, hover);
      box.append(
        ...[
          h('h2', {}, h('span', {}, ctx.title), h('span', { class: 'sub' }, `${shooter.name} · ${ROLES[shooter.role].name}`)),
          scene,
          h('div', { class: 'notice' }, facts.join(' · ')),
          ctx.revealed
            ? h(
                'div',
                { class: 'notice read' },
                role === 'chute'
                  ? `Você leu o goleiro: ele vai pular para ${CORNER_NAME[ctx.revealed]}.`
                  : `Você leu o chute: ele vai na ${CORNER_NAME[ctx.revealed]}.`,
              )
            : role === 'chute' && pv.keeperReads
              ? h('div', { class: 'notice warn' }, 'O goleiro é muito superior: ele vai ler o seu canto.')
              : role === 'defesa' && pv.shooterReads
                ? h('div', { class: 'notice warn' }, 'O chute é forte demais: o atacante vai ler o seu mergulho.')
                : null,
          h(
            'div',
            { class: 'lance-buttons three' },
            CORNERS.map((k, i) =>
              h(
                'button',
                {
                  class: hover === k ? 'on' : '',
                  onclick: () => pick(k),
                  onmouseenter: () => {
                    if (hover === k) return;
                    hover = k;
                    render();
                  },
                },
                h('b', {}, `${i + 1} · ${role === 'chute' ? 'Chutar' : 'Pular'} ${CORNER_NAME[k].toLowerCase()}`),
                h('small', {}, `${role === 'chute' ? 'gol' : 'defesa'} ${Math.round(odds(k) * 100)}%`),
              ),
            ),
          ),
          ctx.cancellable ? h('div', { class: 'lance-buttons' }, h('button', { onclick: () => pick(null) }, 'X · Desistir do chute')) : null,
          h(
            'div',
            { class: 'rule-line' },
            'Goleiro no canto certo segura até força = reflexo + 2. No canto vizinho (meio ↔ lado) só pega chute fraco. No canto oposto, é gol.',
          ),
        ].filter((x): x is NonNullable<typeof x> => !!x),
      );
    };
    render();
  });
}
