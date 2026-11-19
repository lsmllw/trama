// Controlador da partida: liga o núcleo de regras, o canvas, o painel e a IA.
// Turno por fase: você move todas as suas unidades; depois a IA move todas as dela.

import {
  ABILITIES,
  abilityBlock,
  abilityTargets,
  activatable,
  attackArea,
  attackBarricade,
  attackBaseMelee,
  attackMelee,
  attackRanged,
  attackRangedBase,
  BASE_LANCES,
  beginActivation,
  canMoveNow,
  canRun,
  canUseItem,
  cancelActivation,
  CLASSES,
  collect,
  createGame,
  crossCells,
  currentAbilityTargets,
  currentTargets,
  currentUnit,
  destinations,
  drainEvents,
  endActivation,
  endPhase,
  performAction,
  faceNearestEnemy,
  getUnit,
  heal,
  ITEMS,
  LEVEL_XP,
  MAX_LEVEL,
  moveTo,
  newMemory,
  planActivation,
  points,
  rotate,
  run,
  RUN_BONUS,
  RUN_COST,
  sideUnit,
  squareCells,
  tauntOf,
  TERRAIN,
  undoMove,
  unitAt,
  unitAtq,
  unlockLevel,
  useAbility,
  useItem,
  WEIGHT_LABEL,
} from '../core';
import type { ConfrontoState, Dir, GameState, LanceMemory, NodeColor, Pos, Target, Team, Unit } from '../core';
import { openConfronto } from './confronto-modal';
import { classIconSvg } from './icons';
import { clear, h } from './dom';
import { Renderer } from './renderer';
import type { Highlights } from './renderer';
import type { MatchConfig } from './setup';

const PLAYER: Team = 'azul';
const STEP_MS = 85;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

type Mode = 'normal' | 'mirar' | 'habilidade';

export class GameView {
  private s: GameState;
  private renderer!: Renderer;
  private memory: LanceMemory = newMemory();
  private selectedId: string | null = null;
  private hover: Pos | null = null;
  private mode: Mode = 'normal';
  private busy = false;
  private hl: Highlights = emptyHighlights();
  private raf = 0;
  private el = {
    top: h('div', { class: 'topbar' }),
    side: h('aside', { class: 'side' }),
    hint: h('div', { class: 'hint' }),
    canvas: h('canvas', { id: 'board' }),
    bar: h('div', { class: 'unit-bar' }),
    tip: h('div', { class: 'unit-tip' }),
  };
  /** Unidade mostrada na janelinha de informações (null = escondida). */
  private tipUnit: string | null = null;
  private tipFromCard = false;


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

  /** Renderizador (testes automatizados). */
  get board(): Renderer {
    return this.renderer;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Centro de uma casa na página (testes automatizados). */
  cellPoint(x: number, y: number): { x: number; y: number } {
    return this.renderer.clientPoint(x, y, this.s);
  }

  mount(): void {
    clear(this.root);
    this.root.append(
      this.el.top,
      h('div', { class: 'layout' }, h('div', { class: 'board-wrap' }, this.el.canvas, this.el.hint, this.el.bar), this.el.side),
    );
    document.body.append(this.el.tip);
    this.renderer = new Renderer(this.el.canvas, this.s);
    this.el.canvas.addEventListener('click', (e) => {
      const p = this.renderer.cellAt(e.clientX, e.clientY, this.s);
      if (p) void this.onCellClick(p);
    });
    this.el.canvas.addEventListener('mousemove', (e) => {
      this.renderer.pointer(e.clientX, e.clientY);
      const p = this.renderer.cellAt(e.clientX, e.clientY, this.s);
      if (!p || !this.hover || !same(p, this.hover)) {
        this.hover = p;
        this.refreshHighlights();
      }
      const u = p ? unitAt(this.s, p.x, p.y) : undefined;
      if (u) {
        this.tipFromCard = false;
        this.showTip(u.id, e.clientX + 16, e.clientY + 12);
      }
      else this.hideTip();
    });
    this.el.canvas.addEventListener('mouseleave', () => {
      this.renderer.pointer(null);
      this.hover = null;
      this.hideTip();
      this.refreshHighlights();
    });
    // Zoom com a roda do mouse, apontado para o cursor.
    this.el.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
        this.hideTip();
      },
      { passive: false },
    );
    // O botão do meio não deve abrir a rolagem automática do navegador.
    this.el.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.el.canvas.addEventListener('auxclick', (e) => e.preventDefault());
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
    this.el.tip.remove();
  }

  /**
   * Seleciona uma unidade sua (card, tecla 1–5 ou clique no tabuleiro): abre o movimento se ela
   * ainda pode agir e prende a câmera nela, centralizada, até apertar X.
   */
  private selectOwn(id: string): void {
    const s = this.s;
    const u = getUnit(s, id);
    if (!u.alive || this.busy) return;
    if (this.isPlayerTurn() && u.team === PLAYER && !u.activated && s.activation?.unitId !== id) {
      beginActivation(s, id);
      this.mode = 'normal';
    }
    this.selectedId = id;
    this.renderer.lockOn(id);
    this.afterChange();
  }

  /** Solta a câmera para voltar a seguir o mouse (X). */
  private releaseCamera(): void {
    this.renderer.lockOn(null);
  }

  /** Depois de confirmar, a câmera fica parada onde estava (até X ou nova seleção). */
  private holdCamera(): void {
    if (this.renderer.lockedOn) this.renderer.hold();
  }

  // ---------- Janela de informações ----------

  private showTip(unitId: string, x: number, y: number): void {
    const u = this.s.units.find((v) => v.id === unitId);
    if (!u || !u.alive) return this.hideTip();
    if (this.tipUnit !== unitId) {
      this.tipUnit = unitId;
      this.fillTip();
    }
    const tip = this.el.tip;
    tip.style.display = 'block';
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x))}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - hgt - 8, y))}px`;
  }

  private hideTip(): void {
    this.tipUnit = null;
    this.tipFromCard = false;
    this.el.tip.style.display = 'none';
  }

  private fillTip(): void {
    const s = this.s;
    const u = this.tipUnit ? s.units.find((v) => v.id === this.tipUnit) : undefined;
    clear(this.el.tip);
    if (!u) return;
    const d = CLASSES[u.cls];
    const ab = ABILITIES[u.cls];
    const flags: string[] = [];
    if (u.ready) flags.push('Prontidão');
    if (u.oil) flags.push('Óleo ativo');
    if (u.focus) flags.push('Foco ativo');
    if (tauntOf(s, u)) flags.push('Provocada');
    if (s.phase <= u.stuckUntil) flags.push('Imobilizada');
    if (u.stamina <= 0) flags.push('Exausta');
    const range = d.ranged ? `${d.ranged.min}–${d.ranged.max}` : '1';
    this.el.tip.append(h('div', {},
      h(
        'div',
        { class: `tt-name ${u.team}` },
        h('span', { class: `tt-icon ${u.team}` }, classIconSvg(u.cls, 14, '#fff')),
        `${d.name} ${u.team === 'azul' ? 'Azul' : 'Vermelho'}`,
        h('span', { class: 'tt-level' }, ` · Level ${u.level}`),
      ),
      h('div', { class: 'tt-sub' }, `${WEIGHT_LABEL[d.weight]} · ${BASE_LANCES[d.weight]} lance(s) · ${d.role}`),
      h(
        'div',
        { class: 'tt-grid' },
        h('span', { class: 'tt-hp' }, `HP ${u.hp}/${u.maxHp}`),
        h('span', { class: 'tt-st' }, `ST ${u.stamina}/${d.stamina}`),
        h('span', { class: 'tt-atq' }, `ATQ ${unitAtq(u)}`),
        h('span', { class: 'tt-arm' }, `ARM ${d.armadura}`),
        h('span', { class: 'tt-mov' }, `MOV ${d.mov}`),
        h('span', { class: 'tt-mov' }, `Alc ${range}`),
      ),
      h('div', { class: 'tt-ab' }, `${ab.name} (${ab.cost} ST)`, u.level < unlockLevel(u) ? h('span', { class: 'tt-lock' }, ` · level ${unlockLevel(u)}`) : null),
      u.items.length
        ? h(
            'div',
            { class: 'tt-items' },
            u.items.map((it) => h('span', { class: `tt-item ${ITEMS[it].color}` }, ITEMS[it].name)),
          )
        : null,
      flags.length ? h('div', { class: 'tt-flags' }, flags.join(' · ')) : null,
      u.activated ? h('div', { class: 'tt-done' }, 'Já agiu nesta fase') : null,
    ));
  }

  // ---------- Barra de unidades ----------

  private renderBar(): void {
    const s = this.s;
    clear(this.el.bar);
    const mine = s.units.filter((u) => u.team === PLAYER);
    for (const u of mine) {
      const d = CLASSES[u.cls];
      const active = s.activation?.unitId === u.id;
      const state = !u.alive ? 'Abatida' : active ? 'Em ação' : u.activated ? 'Já agiu' : this.isPlayerTurn() ? 'Pronta' : 'Aguardando';
      const cls = ['uc', `lv${u.level}`, !u.alive ? 'dead' : '', u.activated && !active ? 'done' : '', active ? 'active' : '', this.selectedId === u.id && !active ? 'selected' : ''].join(' ');
      const card = h(
        'button',
        {
          class: cls,
          disabled: !u.alive,
          onclick: () => this.selectOwn(u.id),
          onmouseenter: (e: MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            this.tipFromCard = true;
            this.showTip(u.id, r.left, r.top - 8);
            // Abre para cima do card.
            const tip = this.el.tip;
            tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
          },
          onmouseleave: () => this.hideTip(),
        },
        h(
          'div',
          { class: 'uc-head' },
          h('span', { class: 'uc-key' }, String(mine.indexOf(u) + 1)),
          h('span', { class: 'uc-icon', title: d.name }, classIconSvg(u.cls, 15, '#fff')),
          h('span', { class: 'uc-name' }, d.name),
          h('span', { class: 'uc-lv' }, `Lv ${u.level}`),
        ),
        h('div', { class: 'uc-bar hp' }, h('div', { style: `width:${(100 * u.hp) / u.maxHp}%` })),
        h('div', { class: 'uc-bar st' }, h('div', { style: `width:${(100 * u.stamina) / d.stamina}%` })),
        h(
          'div',
          { class: 'uc-foot' },
          h('span', { class: `uc-state ${state === 'Pronta' ? 'ready' : state === 'Em ação' ? 'acting' : ''}` }, state),
          h('span', {}, u.items.map((it) => h('span', { class: `uc-dot ${ITEMS[it].color}` }))),
        ),
      );
      this.el.bar.append(card);
    }
    // Os cards foram recriados: se o ponteiro já não está em nenhum, some com a janelinha.
    if (this.tipFromCard && !this.el.bar.querySelector('.uc:hover')) this.hideTip();
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
    if (!this.busy && this.s.activeTeam !== PLAYER) void this.runAiPhase();
  }

  /** Atualiza a tela sem disparar a fase da IA. */
  private quiet(): void {
    this.flush();
    this.refreshHighlights();
    this.renderPanels();
  }

  private async animateMove(unitId: string, path: Pos[]): Promise<void> {
    if (path.length < 2) return;
    this.renderer.anim = { unitId, path, t0: performance.now(), stepMs: STEP_MS };
    await sleep(STEP_MS * (path.length - 1) + 30);
    this.renderer.anim = null;
  }

  /** Fase da IA: ativa todas as unidades vermelhas, uma de cada vez. */
  private async runAiPhase(): Promise<void> {
    this.busy = true;
    this.mode = 'normal';
    this.holdCamera();
    this.quiet();
    const s = this.s;
    const team = s.activeTeam;
    await sleep(500);
    while (!s.winner && s.activeTeam === team && activatable(s).length) {
      const plan = planActivation(s, team, this.config.difficulty);
      if (!plan) break;
      beginActivation(s, plan.unitId);
      this.selectedId = plan.unitId;
      this.quiet();
      await sleep(250);
      if (plan.run) run(s);
      if (plan.moveTo) {
        const path = moveTo(s, plan.moveTo.x, plan.moveTo.y);
        await this.animateMove(plan.unitId, path);
        this.quiet();
      }
      if (!s.winner && getUnit(s, plan.unitId).alive && plan.action) {
        await sleep(150);
        const cs = performAction(s, plan);
        this.quiet();
        if (cs) await this.resolveConfronto(cs);
        else await sleep(550);
      }
      if (s.winner) break;
      if (s.activation) {
        faceNearestEnemy(s, plan.unitId);
        endActivation(s);
      }
      this.quiet();
      await sleep(120);
    }
    this.selectedId = null;
    this.busy = false;
    this.afterChange();
  }

  private async resolveConfronto(cs: ConfrontoState): Promise<void> {
    const atk = sideUnit(this.s, cs, 'atk');
    await openConfronto({
      s: this.s,
      cs,
      playerSide: atk.team === PLAYER ? 'atk' : 'def',
      difficulty: this.config.difficulty,
      memory: this.memory,
      onTempo: () => this.quiet(),
    });
    this.quiet();
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
      case 'barricada':
        attackBarricade(s, t.x, t.y);
        break;
      case 'area':
        attackArea(s, t.x, t.y);
        break;
      case 'cura':
        heal(s, t.unitId);
        break;
      case 'coleta':
      case 'melee':
        throw new Error('Tratado em outro lugar');
    }
  }

  // ---------- Entrada do jogador ----------

  private async onCellClick(p: Pos): Promise<void> {
    const s = this.s;
    if (this.busy || s.winner) return;
    const clicked = unitAt(s, p.x, p.y);
    if (!this.isPlayerTurn()) {
      this.selectedId = clicked?.id ?? null;
      this.quiet();
      return;
    }
    const a = s.activation;
    if (a) {
      if (this.mode === 'mirar') {
        const t = currentTargets(s).find((x) => x.kind === 'area' && same(x, p));
        if (t) await this.act(() => this.doNonMelee(t));
        else this.mode = 'normal';
        this.quiet();
        return;
      }
      if (this.mode === 'habilidade') {
        if (currentAbilityTargets(s).some((t) => same(t, p))) await this.act(() => useAbility(s, p.x, p.y));
        else this.mode = 'normal';
        this.quiet();
        return;
      }
      const target = currentTargets(s).find((x) => x.kind !== 'area' && x.kind !== 'coleta' && same(x, p));
      if (target) {
        await this.act(() => (target.kind === 'melee' ? attackMelee(s, target.unitId) : this.doNonMelee(target)));
        return;
      }
      if (canMoveNow(s) && destinations(s).some((d) => same(d, p))) {
        this.busy = true;
        const path = moveTo(s, p.x, p.y);
        this.refreshHighlights();
        await this.animateMove(a.unitId, path);
        this.busy = false;
        this.quiet();
        return;
      }
    }
    // Selecionar outra unidade sua: a atual encerra se já mexeu ou agiu.
    if (clicked && clicked.team === PLAYER && !clicked.activated && clicked.id !== a?.unitId) {
      this.selectOwn(clicked.id);
      return;
    }
    this.selectedId = clicked?.id ?? (a ? a.unitId : null);
    this.quiet();
  }

  /** Executa a ação da unidade ativa; abre o Confronto se houver; encerra a unidade. */
  private async act(fn: () => ConfrontoState | void | null): Promise<void> {
    const s = this.s;
    const unitId = s.activation!.unitId;
    this.mode = 'normal';
    this.busy = true;
    const cs = fn();
    this.quiet();
    if (cs) await this.resolveConfronto(cs);
    else await sleep(400);
    this.busy = false;
    if (s.winner) {
      this.afterChange();
      return;
    }
    const u = getUnit(s, unitId);
    // Cavaleiro e Espião podem continuar andando; os outros encerram sozinhos.
    if (u.alive && CLASSES[u.cls].moveAfterAction && s.activation && s.activation.mpLeft > 0) {
      this.quiet();
      return;
    }
    this.endUnit();
  }

  private endUnit(): void {
    const s = this.s;
    if (!s.activation || this.busy || !this.isPlayerTurn()) return;
    this.mode = 'normal';
    endActivation(s);
    this.selectedId = null;
    this.holdCamera();
    this.afterChange();
  }

  private endPlayerPhase(): void {
    if (this.busy || !this.isPlayerTurn()) return;
    this.mode = 'normal';
    endPhase(this.s);
    this.selectedId = null;
    this.holdCamera();
    this.afterChange();
  }

  /** X (retorno): sai da mira, desfaz o movimento ou desmarca a unidade; e solta a câmera. */
  private escape(): void {
    if (this.mode !== 'normal') {
      this.mode = 'normal';
    } else if (this.s.activation && this.isPlayerTurn()) {
      const a = this.s.activation;
      if (a.hasMoved && !a.hasActed && !a.noUndo) undoMove(this.s);
      else if (!a.hasMoved && !a.hasActed) {
        cancelActivation(this.s);
        this.selectedId = null;
      }
    } else {
      this.selectedId = null;
    }
    this.releaseCamera();
    this.quiet();
  }

  private onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal-bg')) return;
    if (this.busy) return;
    const k = e.key.toLowerCase();
    const dirs: Record<string, Dir> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E' };
    if (e.key === ' ' || e.key === 'Enter' || k === 'z') {
      // Z (ou Espaço/Enter) confirma: encerra a unidade.
      e.preventDefault();
      this.endUnit();
    } else if (e.key === 'Escape' || k === 'x') {
      // X (ou Esc) volta.
      this.escape();
    } else if (/^[1-5]$/.test(e.key)) {
      const mine = this.s.units.filter((u) => u.team === PLAYER);
      const u = mine[Number(e.key) - 1];
      if (u && u.alive) this.selectOwn(u.id);
    } else if (k === 'e' && this.isPlayerTurn()) {
      this.endPlayerPhase();
    } else if (dirs[e.key] && this.s.activation && this.isPlayerTurn()) {
      e.preventDefault();
      rotate(this.s, dirs[e.key]);
      this.quiet();
    } else if (k === 'r' && this.isPlayerTurn() && canRun(this.s)) {
      run(this.s);
      this.quiet();
    } else if (k === 'm' && this.canAim()) {
      this.mode = this.mode === 'mirar' ? 'normal' : 'mirar';
      this.quiet();
    } else if (k === 'h' && this.isPlayerTurn()) {
      this.toggleAbility();
    } else if (e.key === '0' || e.key === 'Home') {
      this.renderer.resetCamera();
    }
  };

  private canAim(): boolean {
    const u = currentUnit(this.s);
    if (!u || !this.isPlayerTurn() || this.s.activation!.hasActed) return false;
    const r = CLASSES[u.cls].ranged;
    return !!r && (r.kind === 'morteiro' || r.kind === 'granada');
  }

  /** Habilidades sem alvo (Provocar, Cura em área) disparam na hora; as outras entram em modo de mira. */
  private toggleAbility(): void {
    const s = this.s;
    const u = currentUnit(s);
    if (!u || abilityBlock(s, u)) return;
    const targets = currentAbilityTargets(s);
    if (!targets.length) return;
    const ab = ABILITIES[u.cls].id;
    if (ab === 'provocar' || ab === 'curaArea') {
      void this.act(() => useAbility(s, u.x, u.y));
      return;
    }
    this.mode = this.mode === 'habilidade' ? 'normal' : 'habilidade';
    this.quiet();
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
      if (this.mode === 'mirar') {
        hl.areaRange = targets.filter((t) => t.kind === 'area');
        if (this.hover && hl.areaRange.some((c) => same(c, this.hover!))) hl.areaPreview = crossCells(s, this.hover.x, this.hover.y);
      } else if (this.mode === 'habilidade') {
        const ab = currentAbilityTargets(s);
        hl.abilityTargets = ab;
        const u = currentUnit(s)!;
        if (ABILITIES[u.cls].id === 'fumaca' && this.hover && ab.some((c) => same(c, this.hover!))) {
          hl.abilityTargets = [];
          hl.areaRange = ab;
          hl.areaPreview = squareCells(s, this.hover.x, this.hover.y, 1);
        }
      } else {
        hl.moves = destinations(s);
        hl.targets = targets.filter((t) => t.kind !== 'area' && t.kind !== 'cura' && t.kind !== 'coleta');
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
    else if (!this.isPlayerTurn()) text = 'Fase do Vermelho (IA)…';
    else if (!s.activation) text = `Sua fase: teclas 1–5 ou clique numa unidade azul. Faltam ${activatable(s).length}. E encerra a fase.`;
    else if (this.mode === 'mirar') text = 'Mirando: clique numa casa laranja. X volta.';
    else if (this.mode === 'habilidade') text = 'Habilidade: clique numa casa roxa. X volta.';
    else {
      const a = s.activation;
      text = a.hasActed
        ? 'Ainda pode andar. Z confirma e encerra; X volta.'
        : 'Mover (azul) e depois 1 ação: atacar (vermelho), curar (verde), coletar, item ou habilidade. Z confirma, X volta.';
    }
    if (this.hover) {
      const t = s.terrain[this.hover.y][this.hover.x];
      text += `   [${this.hover.x + 1},${this.hover.y + 1}] ${TERRAIN[t].label}`;
    }
    text += this.renderer?.lockedOn ? '   · Câmera presa (X solta)' : this.renderer?.isHeld ? '   · Câmera parada (X solta)' : '   · Roda: zoom · 0: visão inteira';
    this.el.hint.textContent = text;
  }

  private renderPanels(): void {
    this.renderTop();
    this.renderSide();
    this.renderBar();
    if (this.tipUnit) this.fillTip();
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
      h('h1', {}, 'Trama'),
      h('span', {}, `Rodada ${s.round}/${s.maxRounds}`),
      s.winner
        ? h('span', { class: 'turn-pill' }, 'Fim de jogo')
        : h('span', { class: `turn-pill ${s.activeTeam}` }, s.activeTeam === PLAYER ? 'Sua fase (Azul)' : 'Fase do Vermelho (IA)'),
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
    if (this.isPlayerTurn()) this.el.side.append(this.phaseCard());
    this.el.side.append(shown ? this.unitCard(shown) : this.idleCard());
    if (s.activation && this.isPlayerTurn()) this.el.side.append(this.actionCard());
    this.el.side.append(h('div', { class: 'card' }, h('h3', {}, 'Registro'), h('div', { class: 'log' }, s.log.slice(-40).map((l) => h('div', {}, l)))), helpCard());
    const log = this.el.side.querySelector('.log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  private phaseCard(): HTMLElement {
    const left = activatable(this.s, PLAYER).length;
    return h(
      'div',
      { class: 'card phase-card' },
      h('span', {}, `Unidades a mover: ${left}`),
      h('button', { class: left ? '' : 'primary', disabled: this.busy, onclick: () => this.endPlayerPhase(), title: 'As que não agiram ganham Prontidão' }, 'Encerrar fase (E)'),
    );
  }

  private idleCard(): HTMLElement {
    return h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Nenhuma unidade selecionada'),
      h('div', { style: 'color:var(--muted);font-size:12.5px' }, 'Clique numa unidade para ver os detalhes. As do Vermelho também.'),
    );
  }

  private unitCard(u: Unit): HTMLElement {
    const s = this.s;
    const d = CLASSES[u.cls];
    const ab = ABILITIES[u.cls];
    const status: string[] = [];
    if (u.activated) status.push('já agiu');
    if (u.ready) status.push('Prontidão (+1 lance ao defender)');
    if (u.stamina <= 0) status.push('Exausta');
    if (u.oil) status.push('Óleo ativo (+3 ATQ)');
    if (u.focus) status.push('Foco ativo (+1 lance)');
    if (tauntOf(s, u)) status.push('Provocada pelo Tank');
    if (s.phase <= u.stuckUntil) status.push('Imobilizada por mina');
    if (d.forbidden) status.push('Só anda em terreno liso');
    const range = d.ranged ? `${d.ranged.min}–${d.ranged.max}` : '1';
    const next = u.level < MAX_LEVEL ? `${u.xp}/${LEVEL_XP[u.level]} XP` : 'nível máximo';
    return h(
      'div',
      { class: 'card', style: `border-top:4px solid var(--${u.team})` },
      h('h3', {}, `${d.name} ${u.team === 'azul' ? 'Azul' : 'Vermelho'} · Level ${u.level}`),
      h('div', { style: 'color:var(--muted);font-size:12.5px' }, `${WEIGHT_LABEL[d.weight]} · ${BASE_LANCES[d.weight]} lance(s) · ${d.role} · ${next}`),
      h(
        'div',
        { class: 'stats', style: 'margin-top:6px' },
        h('span', {}, 'HP ', h('b', {}, `${u.hp}/${u.maxHp}`)),
        h('span', {}, 'ST ', h('b', {}, `${u.stamina}/${d.stamina}`)),
        h('span', {}, 'ATQ ', h('b', {}, String(unitAtq(u)))),
        h('span', {}, 'ARM ', h('b', {}, String(d.armadura))),
        h('span', {}, 'MOV ', h('b', {}, String(d.mov))),
        h('span', {}, 'Alc ', h('b', {}, range)),
      ),
      h(
        'div',
        { class: 'ability-line' },
        h('b', {}, `${ab.name} (${ab.cost} ST)`),
        u.level < unlockLevel(u) ? h('span', { class: 'locked' }, ` · bloqueada até o level ${unlockLevel(u)}`) : null,
        h('div', {}, ab.desc),
      ),
      h('div', { class: 'ability-line' }, 'Itens: ', u.items.length ? u.items.map((i) => ITEMS[i].name).join(', ') : 'nenhum'),
      status.length ? h('div', { style: 'margin-top:6px;font-size:12.5px;color:#f1d27a' }, status.join(' · ')) : null,
    );
  }

  private actionCard(): HTMLElement {
    const s = this.s;
    const a = s.activation!;
    const u = getUnit(s, a.unitId);
    const ab = ABILITIES[u.cls];
    const block = abilityBlock(s, u);
    const abilityUsable = !block && abilityTargets(s, u).length > 0;
    const facing = (dir: Dir, label: string) =>
      h(
        'button',
        {
          onclick: () => {
            rotate(s, dir);
            this.quiet();
          },
        },
        label,
      );
    const collectButtons: HTMLElement[] = [];
    for (const t of currentTargets(s)) {
      if (t.kind !== 'coleta') continue;
      const colors: Exclude<NodeColor, 'prisma'>[] = t.color === 'prisma' ? ['verde', 'laranja', 'roxo'] : [t.color];
      for (const c of colors) {
        const item = { verde: 'tonico', laranja: 'oleo', roxo: 'foco' }[c] as keyof typeof ITEMS;
        if (collectButtons.some((b) => b.dataset.item === item)) continue;
        const btn = h('button', { class: `item-btn ${c}`, title: ITEMS[item].desc, onclick: () => void this.act(() => void collect(s, t.x, t.y, c)) }, `Coletar ${ITEMS[item].name}`);
        btn.dataset.item = item;
        collectButtons.push(btn);
      }
    }
    return h(
      'div',
      { class: 'card' },
      h('h3', {}, `Ativação · ${a.hasActed ? 'já agiu' : a.hasMoved ? 'moveu, falta a ação' : 'pode mover e agir'}`),
      h('div', { style: 'color:var(--muted);font-size:12.5px' }, `Movimento restante: ${a.mpLeft}`),
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
              this.quiet();
            },
          },
          'Correr (R)',
        ),
        h(
          'button',
          {
            disabled: !a.hasMoved || a.hasActed || a.noUndo || this.busy,
            onclick: () => {
              undoMove(s);
              this.quiet();
            },
          },
          'Desfazer (X)',
        ),
        this.canAim()
          ? h(
              'button',
              {
                class: this.mode === 'mirar' ? 'primary' : '',
                onclick: () => {
                  this.mode = this.mode === 'mirar' ? 'normal' : 'mirar';
                  this.quiet();
                },
              },
              this.mode === 'mirar' ? 'Mirando… (M)' : 'Mirar (M)',
            )
          : null,
        h(
          'button',
          {
            class: `ability-btn${this.mode === 'habilidade' ? ' primary' : ''}`,
            disabled: !abilityUsable || a.hasActed,
            title: block ?? (abilityUsable ? ab.desc : 'Sem alvo daqui'),
            onclick: () => this.toggleAbility(),
          },
          `${ab.name} (H)`,
        ),
      ),
      collectButtons.length || u.items.length
        ? h(
            'div',
            { class: 'actions' },
            collectButtons,
            u.items.map((it, i) =>
              h(
                'button',
                { class: `item-btn ${ITEMS[it].color}`, disabled: !canUseItem(s, i) || this.busy, title: ITEMS[it].desc, onclick: () => void this.act(() => useItem(s, i)) },
                `Usar ${ITEMS[it].name}`,
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', disabled: this.busy, onclick: () => this.endUnit() }, 'Confirmar e encerrar (Z)'),
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
  return {
    viewer: PLAYER,
    abilityTargets: [],
    moves: [],
    targets: [],
    heals: [],
    areaRange: [],
    areaPreview: [],
    selectedId: null,
    activeId: null,
    hover: null,
  };
}

function helpCard(): HTMLElement {
  return h(
    'details',
    { class: 'card help' },
    h('summary', {}, 'Como jogar'),
    h(
      'ul',
      {},
      h('li', {}, 'Cada time joga uma fase inteira: você move todas as suas unidades, depois a IA move as dela.'),
      h('li', {}, 'Cada unidade: mover e depois 1 ação (atacar, curar, coletar, usar item ou habilidade).'),
      h('li', {}, 'Teclas 1–5 selecionam suas unidades. Z confirma, X volta. Selecionada, a câmera fica presa nela; X solta.'),
      h('li', {}, 'Vence quem destruir a Base (QG) inimiga ou eliminar todas as unidades. Na rodada 20, decide por pontos.'),
      h('li', {}, 'Corpo a corpo abre o Confronto: 3 tempos. Leve tem 3 lances, Médio 2, Pesado 1 (mas bate mais forte).'),
      h('li', {}, 'O peso define os lances. Atacar pelo flanco dá 1 Leitura, pelas costas 2 (ver o lance do inimigo antes de escolher). Quem não agiu ganha Prontidão (!): +1 lance ao defender.'),
      h('li', {}, 'O Blindado anda 3 e só em terreno liso (nada de floresta, colina, ruína, lama ou barricada).'),
      h('li', {}, 'O Bombardeiro planta minas desde o level 1 (até 3). Mina causa 8; num Blindado, 16 e ele fica imobilizado. A granada dele ignora a armadura do Blindado.'),
      h('li', {}, 'XP: acertar ou vencer Confronto +1, abater +2, coletar ou curar +1. No level 2 a habilidade da classe é liberada.'),
      h('li', {}, 'Nós de cor (quadradinhos = cargas): verde dá Tônico, laranja Óleo de combate, roxo Elixir de foco. A Fonte central dá qualquer um.'),
      h('li', {}, 'Morteiro cai no começo da próxima fase de quem atirou. Granada explode na hora. A Base acerta 5 em quem encosta nela.'),
    ),
  );
}
