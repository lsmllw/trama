// Controlador da partida: liga o núcleo de regras, o canvas, o painel e a IA.

import {
  activatable,
  attackArea,
  attackBaseMelee,
  attackMelee,
  attackRanged,
  attackRangedBase,
  BASE_LANCES,
  beginActivation,
  canMoveNow,
  canRun,
  cancelActivation,
  CLASSES,
  createGame,
  crossCells,
  currentTargets,
  currentUnit,
  destinations,
  drainEvents,
  endActivation,
  faceNearestEnemy,
  getUnit,
  heal,
  moveTo,
  newMemory,
  planActivation,
  points,
  rotate,
  run,
  RUN_BONUS,
  RUN_COST,
  sideUnit,
  TERRAIN,
  undoMove,
  unitAt,
  WEIGHT_LABEL,
} from '../core';
import type { ConfrontoState, Dir, GameState, LanceMemory, Pos, Target, Team, Unit } from '../core';
import { openConfronto } from './confronto-modal';
import { clear, h } from './dom';
import { Renderer } from './renderer';
import type { Highlights } from './renderer';
import type { MatchConfig } from './setup';

const PLAYER: Team = 'azul';
const STEP_MS = 95;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

export class GameView {
  private s: GameState;
  private renderer!: Renderer;
  private memory: LanceMemory = newMemory();
  private selectedId: string | null = null;
  private hover: Pos | null = null;
  private aiming = false;
  private busy = false;
  private hl: Highlights = emptyHighlights();
  private raf = 0;
  private el = {
    top: h('div', { class: 'topbar' }),
    side: h('aside', { class: 'side' }),
    hint: h('div', { class: 'hint' }),
    canvas: h('canvas', { id: 'board' }),
  };

  constructor(
    private root: HTMLElement,
    private config: MatchConfig,
    private onExit: (rematch: boolean) => void,
  ) {
    this.s = createGame({ azul: config.azul, vermelho: config.vermelho, seed: config.seed });
  }

  /** Estado atual (usado pelos testes automatizados no navegador). */
  get state(): GameState {
    return this.s;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  mount(): void {
    clear(this.root);
    this.root.append(
      this.el.top,
      h('div', { class: 'layout' }, h('div', { class: 'board-wrap' }, this.el.canvas, this.el.hint), this.el.side),
    );
    this.renderer = new Renderer(this.el.canvas, this.s);
    this.el.canvas.addEventListener('click', (e) => {
      const p = this.renderer.cellAt(e.clientX, e.clientY, this.s);
      if (p) void this.onCellClick(p);
    });
    this.el.canvas.addEventListener('mousemove', (e) => {
      const p = this.renderer.cellAt(e.clientX, e.clientY, this.s);
      if (!p || !this.hover || !same(p, this.hover)) {
        this.hover = p;
        this.refreshHighlights();
      }
    });
    this.el.canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.refreshHighlights();
    });
    this.el.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.escape();
    });
    document.addEventListener('keydown', this.onKey);
    const loop = (t: number) => {
      this.renderer.draw(this.s, this.hl, t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.afterChange();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKey);
  }

  // ---------- Fluxo ----------

  private isPlayerTurn(): boolean {
    return !this.s.winner && this.s.activeTeam === PLAYER;
  }

  private flush(): void {
    this.renderer.pushEvents(drainEvents(this.s), performance.now());
  }

  private afterChange(): void {
    this.flush();
    this.refreshHighlights();
    this.renderPanels();
    if (this.s.winner) {
      this.showEnd();
      return;
    }
    if (!this.busy && this.s.activeTeam !== PLAYER) void this.runAiTurn();
  }

  private async animateMove(unitId: string, path: Pos[]): Promise<void> {
    if (path.length < 2) return;
    this.renderer.anim = { unitId, path, t0: performance.now(), stepMs: STEP_MS };
    await sleep(STEP_MS * (path.length - 1) + 30);
    this.renderer.anim = null;
  }

  private async runAiTurn(): Promise<void> {
    this.busy = true;
    this.renderPanels();
    const s = this.s;
    const team = s.activeTeam;
    await sleep(450);
    const plan = planActivation(s, team, this.config.difficulty);
    if (!plan) {
      this.busy = false;
      return;
    }
    beginActivation(s, plan.unitId);
    this.selectedId = plan.unitId;
    this.afterChangeQuiet();
    await sleep(350);
    if (plan.run) run(s);
    if (plan.moveTo) {
      const path = moveTo(s, plan.moveTo.x, plan.moveTo.y);
      await this.animateMove(plan.unitId, path);
      this.afterChangeQuiet();
    }
    const t = plan.action;
    if (t) {
      await sleep(200);
      if (t.kind === 'melee') {
        const cs = attackMelee(s, t.unitId);
        await this.resolveConfronto(cs);
      } else {
        this.doNonMelee(t);
        await sleep(650);
      }
    }
    if (!s.winner) {
      faceNearestEnemy(s, plan.unitId);
      endActivation(s);
    }
    this.busy = false;
    this.afterChange();
  }

  /** Atualiza a tela sem disparar o próximo turno da IA. */
  private afterChangeQuiet(): void {
    this.flush();
    this.refreshHighlights();
    this.renderPanels();
  }

  private async resolveConfronto(cs: ConfrontoState): Promise<void> {
    const atk = sideUnit(this.s, cs, 'atk');
    await openConfronto({
      s: this.s,
      cs,
      playerSide: atk.team === PLAYER ? 'atk' : 'def',
      difficulty: this.config.difficulty,
      memory: this.memory,
      onTempo: () => this.afterChangeQuiet(),
    });
    this.afterChangeQuiet();
  }

  private doNonMelee(t: Target): void {
    const s = this.s;
    switch (t.kind) {
      case 'meleeBase':
        attackBaseMelee(s);
        break;
      case 'tiro':
        attackRanged(s, t.unitId);
        break;
      case 'tiroBase':
        attackRangedBase(s);
        break;
      case 'area':
        attackArea(s, t.x, t.y);
        break;
      case 'cura':
        heal(s, t.unitId);
        break;
      case 'melee':
        throw new Error('Corpo a corpo passa pelo Confronto');
    }
  }

  // ---------- Entrada do jogador ----------

  private async onCellClick(p: Pos): Promise<void> {
    const s = this.s;
    if (this.busy || s.winner) return;
    const clicked = unitAt(s, p.x, p.y);
    if (!this.isPlayerTurn()) {
      this.selectedId = clicked?.id ?? null;
      this.afterChangeQuiet();
      return;
    }
    const a = s.activation;
    if (a) {
      if (this.aiming) {
        const t = currentTargets(s).find((x) => x.kind === 'area' && same(x, p));
        if (t) await this.playerAct(t);
        else this.aiming = false;
        this.afterChangeQuiet();
        return;
      }
      const target = currentTargets(s).find((x) => x.kind !== 'area' && same(x, p));
      if (target) {
        await this.playerAct(target);
        return;
      }
      if (canMoveNow(s) && destinations(s).some((d) => same(d, p))) {
        this.busy = true;
        const path = moveTo(s, p.x, p.y);
        this.refreshHighlights();
        await this.animateMove(a.unitId, path);
        this.busy = false;
        this.afterChangeQuiet();
        return;
      }
      if (clicked && clicked.team === PLAYER && !clicked.activated && clicked.id !== a.unitId && !a.hasMoved && !a.hasActed) {
        cancelActivation(s);
        beginActivation(s, clicked.id);
        this.selectedId = clicked.id;
        this.afterChangeQuiet();
        return;
      }
      this.selectedId = clicked?.id ?? this.selectedId;
      this.afterChangeQuiet();
      return;
    }
    if (clicked && clicked.team === PLAYER && !clicked.activated) {
      beginActivation(s, clicked.id);
      this.selectedId = clicked.id;
    } else {
      this.selectedId = clicked?.id ?? null;
    }
    this.afterChangeQuiet();
  }

  private async playerAct(t: Target): Promise<void> {
    const s = this.s;
    const unitId = s.activation!.unitId;
    this.aiming = false;
    this.busy = true;
    if (t.kind === 'melee') {
      const cs = attackMelee(s, t.unitId);
      this.afterChangeQuiet();
      await this.resolveConfronto(cs);
    } else {
      this.doNonMelee(t);
      this.afterChangeQuiet();
      await sleep(450);
    }
    this.busy = false;
    if (s.winner) {
      this.afterChange();
      return;
    }
    const u = getUnit(s, unitId);
    // Cavaleiro e Espião podem continuar andando; os outros encerram sozinhos.
    if (u.alive && CLASSES[u.cls].moveAfterAction && s.activation && s.activation.mpLeft > 0) {
      this.afterChangeQuiet();
      return;
    }
    this.endPlayerActivation();
  }

  private endPlayerActivation(): void {
    const s = this.s;
    if (!s.activation || this.busy || !this.isPlayerTurn()) return;
    this.aiming = false;
    endActivation(s);
    this.selectedId = null;
    this.afterChange();
  }

  private escape(): void {
    if (this.aiming) {
      this.aiming = false;
    } else if (this.s.activation && this.isPlayerTurn()) {
      const a = this.s.activation;
      if (a.hasMoved && !a.hasActed) undoMove(this.s);
      else cancelActivation(this.s);
    } else {
      this.selectedId = null;
    }
    this.afterChangeQuiet();
  }

  private onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal-bg')) return;
    if (this.busy) return;
    const dirs: Record<string, Dir> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E' };
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.endPlayerActivation();
    } else if (e.key === 'Escape') {
      this.escape();
    } else if (dirs[e.key] && this.s.activation && this.isPlayerTurn()) {
      e.preventDefault();
      rotate(this.s, dirs[e.key]);
      this.afterChangeQuiet();
    } else if (e.key.toLowerCase() === 'r' && this.isPlayerTurn() && canRun(this.s)) {
      run(this.s);
      this.afterChangeQuiet();
    } else if (e.key.toLowerCase() === 'z' && this.isPlayerTurn()) {
      undoMove(this.s);
      this.afterChangeQuiet();
    } else if (e.key.toLowerCase() === 'm' && this.canAim()) {
      this.aiming = !this.aiming;
      this.afterChangeQuiet();
    }
  };

  private canAim(): boolean {
    const u = currentUnit(this.s);
    if (!u || !this.isPlayerTurn() || this.s.activation!.hasActed) return false;
    const r = CLASSES[u.cls].ranged;
    return !!r && (r.kind === 'morteiro' || r.kind === 'granada');
  }

  // ---------- Tela ----------

  private refreshHighlights(): void {
    const s = this.s;
    const hl = emptyHighlights();
    hl.hover = this.hover;
    hl.selectedId = this.selectedId;
    hl.activeId = s.activation?.unitId ?? null;
    if (s.activation && this.isPlayerTurn() && !this.busy) {
      const targets = currentTargets(s);
      if (this.aiming) {
        hl.areaRange = targets.filter((t) => t.kind === 'area');
        if (this.hover && hl.areaRange.some((c) => same(c, this.hover!))) hl.areaPreview = crossCells(s, this.hover.x, this.hover.y);
      } else {
        hl.moves = destinations(s);
        hl.targets = targets.filter((t) => t.kind !== 'area' && t.kind !== 'cura');
        hl.heals = targets.filter((t) => t.kind === 'cura');
      }
    }
    this.hl = hl;
    this.renderHint();
  }

  private renderHint(): void {
    const s = this.s;
    let text = '';
    if (s.winner) text = '';
    else if (!this.isPlayerTurn()) text = 'Vez do Vermelho (IA)…';
    else if (!s.activation) text = 'Sua vez: clique numa unidade azul que ainda não agiu.';
    else if (this.aiming) text = 'Mirando: clique numa casa laranja. Esc cancela.';
    else {
      const a = s.activation;
      text = a.hasActed
        ? 'Ainda pode andar. Espaço encerra a ativação.'
        : 'Azul = mover · vermelho = atacar · verde = curar. Setas viram a unidade. Espaço encerra.';
    }
    if (this.hover) {
      const t = s.terrain[this.hover.y][this.hover.x];
      text += `   [${this.hover.x + 1},${this.hover.y + 1}] ${TERRAIN[t].label}`;
    }
    this.el.hint.textContent = text;
  }

  private renderPanels(): void {
    this.renderTop();
    this.renderSide();
  }

  private renderTop(): void {
    const s = this.s;
    const baseBar = (team: Team) => {
      const b = s.bases[team];
      return h(
        'div',
        { class: 'base-hp' },
        `QG ${team === 'azul' ? 'Azul' : 'Vermelho'}`,
        h('div', { class: 'hpbar' }, h('div', { style: `width:${(100 * b.hp) / b.maxHp}%` })),
        `${b.hp}/${b.maxHp}`,
      );
    };
    clear(this.el.top);
    this.el.top.append(
      h('h1', {}, 'Tático Steampunk'),
      h('span', {}, `Rodada ${s.round}/${s.maxRounds}`),
      s.winner
        ? h('span', { class: 'turn-pill' }, 'Fim de jogo')
        : h('span', { class: `turn-pill ${s.activeTeam}` }, s.activeTeam === PLAYER ? 'Sua vez (Azul)' : 'Vez do Vermelho (IA)'),
      baseBar('azul'),
      baseBar('vermelho'),
      h('span', { class: 'base-hp' }, `Pontos ${points(s, 'azul')} × ${points(s, 'vermelho')}`),
      h('button', { onclick: () => this.onExit(false), style: 'margin-left:auto' }, 'Novo time'),
    );
  }

  private renderSide(): void {
    const s = this.s;
    clear(this.el.side);
    const shown = this.selectedId ? s.units.find((u) => u.id === this.selectedId && u.alive) : currentUnit(s) ?? undefined;
    this.el.side.append(shown ? this.unitCard(shown) : this.idleCard());
    if (s.activation && this.isPlayerTurn()) this.el.side.append(this.actionCard());
    this.el.side.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, `A agir nesta rodada: Azul ${activatable(s, 'azul').length} · Vermelho ${activatable(s, 'vermelho').length}`),
        h('div', { class: 'log' }, s.log.slice(-40).map((l) => h('div', {}, l))),
      ),
      helpCard(),
    );
    const log = this.el.side.querySelector('.log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  private idleCard(): HTMLElement {
    return h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Nenhuma unidade selecionada'),
      h('div', { class: 'meta', style: 'color:var(--muted)' }, 'Clique numa unidade para ver os detalhes. As do Vermelho também.'),
    );
  }

  private unitCard(u: Unit): HTMLElement {
    const d = CLASSES[u.cls];
    const status: string[] = [];
    if (u.activated) status.push('já agiu');
    if (u.ready) status.push('Prontidão (+1 lance ao defender)');
    if (u.stamina <= 0) status.push('Exausta (−1 MOV, só espera no Confronto)');
    const range = d.ranged ? `${d.ranged.min}–${d.ranged.max}` : '1';
    return h(
      'div',
      { class: 'card', style: `border-top:4px solid var(--${u.team})` },
      h('h3', {}, `${d.name} ${u.team === 'azul' ? 'Azul' : 'Vermelho'}`),
      h('div', { style: 'color:var(--muted);font-size:12.5px' }, `${WEIGHT_LABEL[d.weight]} · ${BASE_LANCES[d.weight]} lance(s) · ${d.role}`),
      h(
        'div',
        { class: 'stats', style: 'margin-top:6px' },
        h('span', {}, 'HP ', h('b', {}, `${u.hp}/${d.hp}`)),
        h('span', {}, 'ST ', h('b', {}, `${u.stamina}/${d.stamina}`)),
        h('span', {}, 'ATQ ', h('b', {}, String(d.atq))),
        h('span', {}, 'ARM ', h('b', {}, String(d.armadura))),
        h('span', {}, 'MOV ', h('b', {}, String(d.mov))),
        h('span', {}, 'Alc ', h('b', {}, range)),
      ),
      status.length ? h('div', { style: 'margin-top:6px;font-size:12.5px;color:#f1d27a' }, status.join(' · ')) : null,
    );
  }

  private actionCard(): HTMLElement {
    const s = this.s;
    const a = s.activation!;
    const facing = (dir: Dir, label: string) =>
      h(
        'button',
        {
          onclick: () => {
            rotate(s, dir);
            this.afterChangeQuiet();
          },
        },
        label,
      );
    return h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Ativação'),
      h('div', { style: 'color:var(--muted);font-size:12.5px' }, `Movimento restante: ${a.mpLeft}${a.hasActed ? ' · já agiu' : ''}`),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            disabled: !canRun(s) || this.busy,
            title: `+${RUN_BONUS} de movimento por ${RUN_COST} de Stamina`,
            onclick: () => {
              run(s);
              this.afterChangeQuiet();
            },
          },
          `Correr (R)`,
        ),
        h(
          'button',
          {
            disabled: !a.hasMoved || a.hasActed || this.busy,
            onclick: () => {
              undoMove(s);
              this.afterChangeQuiet();
            },
          },
          'Desfazer (Z)',
        ),
        this.canAim()
          ? h(
              'button',
              {
                class: this.aiming ? 'primary' : '',
                onclick: () => {
                  this.aiming = !this.aiming;
                  this.afterChangeQuiet();
                },
              },
              this.aiming ? 'Mirando… (M)' : 'Mirar (M)',
            )
          : null,
        h('button', { class: 'primary', disabled: this.busy, onclick: () => this.endPlayerActivation() }, 'Encerrar (Espaço)'),
      ),
      h('div', { class: 'facing' }, 'Virar:', facing('N', '↑'), facing('W', '←'), facing('S', '↓'), facing('E', '→')),
    );
  }

  private showEnd(): void {
    const s = this.s;
    if (document.querySelector('.modal-bg.end-bg')) return;
    const won = s.winner === PLAYER;
    const title = s.winner === 'empate' ? 'Empate' : won ? 'Vitória do Azul!' : 'Vitória do Vermelho';
    const bg = h(
      'div',
      { class: 'modal-bg end-bg' },
      h(
        'div',
        { class: 'modal end' },
        h('h2', {}, title),
        h('p', {}, s.winReason),
        h('p', {}, `Rodada ${s.round} · Pontos Azul ${points(s, 'azul')} × ${points(s, 'vermelho')} Vermelho`),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'primary',
              onclick: () => {
                bg.remove();
                this.onExit(true);
              },
            },
            'Revanche (mesmos times)',
          ),
          h(
            'button',
            {
              onclick: () => {
                bg.remove();
                this.onExit(false);
              },
            },
            'Novo time',
          ),
          h('button', { onclick: () => bg.remove() }, 'Ver o tabuleiro'),
        ),
      ),
    );
    document.body.append(bg);
  }
}

function emptyHighlights(): Highlights {
  return { moves: [], targets: [], heals: [], areaRange: [], areaPreview: [], selectedId: null, activeId: null, hover: null };
}

function helpCard(): HTMLElement {
  return h(
    'details',
    { class: 'card help' },
    h('summary', {}, 'Como jogar'),
    h(
      'ul',
      {},
      h('li', {}, 'Os times se alternam ativando uma unidade por vez. Cada unidade move e faz uma ação por rodada.'),
      h('li', {}, 'Vence quem destruir a Base (QG) inimiga ou eliminar todas as unidades. Na rodada 20, decide por pontos.'),
      h('li', {}, 'Corpo a corpo abre o Confronto: 3 tempos. Leve tem 3 lances, Médio 2, Pesado 1 (mas bate mais forte).'),
      h('li', {}, 'Atacar pelo flanco dá +1 lance, pelas costas +2. A seta na unidade mostra para onde ela olha.'),
      h('li', {}, 'Quem não agiu na ativação ganha Prontidão (!): +1 lance ao defender.'),
      h('li', {}, 'Lances, Correr e Cura gastam Stamina (barra amarela), que volta 3 por rodada.'),
      h('li', {}, 'Morteiro marca a área e o disparo cai 2 ativações depois. Granada explode na hora. As duas atingem aliados.'),
      h('li', {}, 'A Base acerta 5 em cada inimigo encostado nela no fim da rodada.'),
    ),
  );
}
