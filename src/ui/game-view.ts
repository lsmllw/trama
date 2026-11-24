// Tela da partida: quadra, placar, cartões dos jogadores, ações e a fase da IA.

import {
  activatable,
  assignTraits,
  chooseTraits,
  chooseStyle,
  cutRange,
  setStyle,
  STYLE_LIST,
  STYLES,
  activationsLeft,
  duelOdds,
  executeAction,
  startReaction,
  applyDuel,
  beginActivation,
  bonusAction,
  canAct,
  cancelActivation,
  canSprint,
  canUseSpecial,
  canUseDrink,
  chebyshev,
  chooseCorner,
  chooseDive,
  createGame,
  currentTargets,
  destinations,
  directKickPreview,
  drainEvents,
  endActivation,
  endPhase,
  executePlan,
  getPlayer,
  goalChance,
  holderOf,
  moveTo,
  newMemory,
  pass,
  planActivation,
  playerAt,
  ROLES,
  ROUNDS_PER_HALF,
  sprintBonus,
  sprintCost,
  statsOf,
  extraMode,
  hasSpecial,
  TRAITS,
  FOUL_LIMIT,
  same,
  shoot,
  shotPreview,
  shotResult,
  sidePlayer,
  sprint,
  startDribble,
  startTackle,
  takeDirectKick,
  TEAM_NAME,
  undoMove,
  useSpecial,
  useDrink,
} from '../core';
import type { Corner, Difficulty, DuelState, GameState, LanceMemory, Player, Pos, Style, Target, Team, Trait } from '../core';
import { clear, h } from './dom';
import { runInlineDuel } from './duel-inline';
import { emptyHighlights, Renderer } from './renderer';
import type { Highlights, TargetMark } from './renderer';
import { chooseShotCorner } from './shot-modal';
import { roleBadge } from './roles';
import { drinkIconUrl, portraitUrl } from './sprites';
import { hideTip, showPlayerTip } from './tooltip';

export interface MatchConfig {
  difficulty: Difficulty;
  style: Style;
  traits?: { playerId: string; trait: Trait }[];
  seed: number;
}

const PLAYER: Team = 'azul';
const AI: Team = 'vermelho';
const CORNERS: Corner[] = ['esq', 'meio', 'dir'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Mode = 'normal' | 'alto';

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
  private mouseAt: { x: number; y: number } | null = null;
  private hoverByMouse = false;
  private kbCursor = false;
  private ended = false;
  private inDuel = false;
  private tipTimer = 0;
  private halftimeDone = false;
  private el = {
    top: h('div', { class: 'scoreboard' }),
    canvas: h('canvas', { class: 'board' }),
    wrap: h('div', { class: 'board-wrap' }),
    hint: h('div', { class: 'hint' }),
    side: h('div', { class: 'side' }),
    log: h('div', { class: 'log' }),
  };

  constructor(
    private root: HTMLElement,
    private config: MatchConfig,
    private onExit: (rematch: boolean) => void,
  ) {
    this.s = createGame({ seed: config.seed, styles: { azul: config.style ?? 'equilibrio' } });
    // A IA escolhe o plano dela às cegas; os dois são revelados no apito inicial.
    this.s.styles[AI] = chooseStyle(this.s, AI, config.difficulty);
    assignTraits(this.s, PLAYER, config.traits ?? []);
    assignTraits(this.s, AI, chooseTraits(this.s, AI, config.difficulty));
    this.s.log.push(`Planos de jogo: Azul em ${STYLES[this.s.styles.azul].name} × Vermelho em ${STYLES[this.s.styles.vermelho].name}.`);
    this.s.events.push({ kind: 'apito', text: `${STYLES[this.s.styles.azul].name} × ${STYLES[this.s.styles.vermelho].name}` });
  }

  get state(): GameState {
    return this.s;
  }

  get board(): Renderer {
    return this.renderer;
  }

  get isBusy(): boolean {
    return this.busy || this.renderer.busy;
  }

  cellPoint(x: number, y: number): { x: number; y: number } {
    return this.renderer.clientPoint(x, y);
  }

  mount(): void {
    clear(this.root);
    this.root.append(this.el.top, h('div', { class: 'layout' }, this.el.wrap, h('div', { class: 'side-wrap' }, this.el.side, this.el.log)));
    this.el.wrap.append(this.el.canvas, this.el.hint);
    this.renderer = new Renderer(this.el.canvas, this.s);
    const c = this.el.canvas;
    c.addEventListener('click', (e) => {
      this.cancelTip();
      const p = this.pick(e.clientX, e.clientY);
      if (p) void this.onCellClick(p);
    });
    c.addEventListener('mousemove', (e) => {
      this.renderer.pointer(e.clientX, e.clientY);
      this.mouseAt = { x: e.clientX, y: e.clientY };
      this.hoverByMouse = true;
      this.kbCursor = false;
      const p = this.pick(e.clientX, e.clientY);
      if (!p || !this.hover || !same(p, this.hover)) {
        this.hover = p;
        this.refreshHighlights();
        this.renderHint();
      }
      this.tipAtMouse(p, e.clientX, e.clientY);
    });
    c.addEventListener('mouseleave', () => {
      this.cancelTip();
      this.renderer.pointer(null);
      this.mouseAt = null;
      this.hover = null;
      this.refreshHighlights();
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
    c.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.escape();
    });
    document.addEventListener('keydown', this.onKey);
    const loop = (t: number) => {
      this.renderer.draw(this.s, this.hl, t);
      if (this.mouseAt && this.hoverByMouse && !this.kbCursor) {
        const p = this.pick(this.mouseAt.x, this.mouseAt.y);
        if (p && (!this.hover || !same(p, this.hover))) {
          this.hover = p;
          // A câmera andou com o mouse parado: a janela de informações acompanha o que está embaixo dele.
          this.tipAtMouse(p, this.mouseAt.x, this.mouseAt.y);
          this.refreshHighlights();
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.renderPanels();
    this.renderer.pushEvents([{ kind: 'apito', text: 'Apita o árbitro! 1º tempo', long: true }], this.s);
    void this.settle();
  }

  destroy(): void {
    this.cancelTip();
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKey);
    document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  }

  // ---------- Fluxo ----------

  private isPlayerTurn(): boolean {
    return !this.s.over && this.s.activeTeam === PLAYER;
  }

  private flush(): void {
    this.renderer.pushEvents(drainEvents(this.s), this.s);
  }

  /** Manda os eventos para a tela, espera as animações e depois atualiza painéis (e a IA, se for a vez dela). */
  private async settle(): Promise<void> {
    this.flush();
    this.hl = emptyHighlights();
    await this.renderer.idle();
    this.refreshHighlights();
    this.renderPanels();
    if (this.s.over) {
      this.showEnd();
      return;
    }
    if (this.s.half === 2 && !this.halftimeDone) {
      this.halftimeDone = true;
      await this.halftime();
    }
    if (!this.busy && this.s.activeTeam === AI) void this.runAiPhase();
  }

  /** Ações do jogador: trava a entrada até as animações terminarem. */
  private async act(fn: () => Promise<void> | void): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.hl = { ...emptyHighlights(), activeId: this.s.activation?.playerId ?? null };
    try {
      await fn();
      this.flush();
      await this.renderer.idle();
      // Parou colado num defensor de prontidão: bote automático (Duelo na quadra).
      if (this.s.pendingReaction) await this.resolveDuel(startReaction(this.s));
      if (this.s.pendingDirect) await this.directKick();
      // Depois de agir (sem bônus de drible), o jogador termina sozinho.
      const a = this.s.activation;
      if (a && a.acted && !canAct(this.s)) {
        endActivation(this.s);
        this.afterUnit();
      } else if (a && a.moved && !a.acted && this.lastWithNothingLeft()) {
        // O último jogador do time andou e não tem mais o que fazer: a fase acaba sozinha.
        endActivation(this.s);
        this.afterUnit();
      } else if (a && !this.s.over && getPlayer(this.s, a.playerId).team !== PLAYER) {
        this.selectedId = null;
      }
    } finally {
      this.busy = false;
    }
    if (this.s.activation && this.kbCursor) {
      const p = getPlayer(this.s, this.s.activation.playerId);
      this.hover = { x: p.x, y: p.y };
    }
    await this.settle();
  }

  private afterUnit(): void {
    this.selectedId = null;
    this.mode = 'normal';
    this.renderer.lockOn(null);
    // O próximo jogador livre já fica selecionado (com o cursor nele).
    const next = this.nextFree();
    if (next && this.isPlayerTurn()) this.hover = { x: next.x, y: next.y };
  }

  /**
   * Casa sob o mouse. Os jogadores são altos: passar o mouse no corpo de um deles (que cobre a casa de trás)
   * conta como estar na casa dele, a não ser que a casa de trás seja um destino ou alvo válido.
   */
  private pick(x: number, y: number): Pos | null {
    const s = this.s;
    const cell = this.renderer.cellAt(x, y);
    if (cell && (playerAt(s, cell.x, cell.y) || this.hl.moves.some((m) => same(m, cell)) || this.hl.targets.some((t) => same(t, cell)))) return cell;
    const id = this.renderer.playerAtClient(x, y);
    if (id) {
      const p = getPlayer(s, id);
      return { x: p.x, y: p.y };
    }
    return cell;
  }

  // ---------- Janela de informações ----------

  /** Jogador seu em ação (para comparar no radar de quem está sob o mouse). */
  private tipCompare(): Player | undefined {
    const a = this.s.activation;
    return a && this.isPlayerTurn() ? getPlayer(this.s, a.playerId) : undefined;
  }

  private cancelTip(): void {
    clearTimeout(this.tipTimer);
    hideTip();
  }

  /** O mouse parou num jogador: depois de um instante, abre a janela com as informações dele. */
  private tipAtMouse(c: Pos | null, x: number, y: number): void {
    const occ = c ? playerAt(this.s, c.x, c.y) : undefined;
    clearTimeout(this.tipTimer);
    if (!occ || this.inDuel || document.querySelector('.modal-bg')) {
      hideTip();
      return;
    }
    if (document.querySelector('.ptip.on')) {
      showPlayerTip(this.s, occ, x, y, { compare: this.tipCompare() });
      return;
    }
    this.tipTimer = window.setTimeout(() => {
      if (this.inDuel || !this.mouseAt) return;
      const now = this.pick(this.mouseAt.x, this.mouseAt.y);
      const p = now ? playerAt(this.s, now.x, now.y) : undefined;
      if (p) showPlayerTip(this.s, p, this.mouseAt.x, this.mouseAt.y, { compare: this.tipCompare() });
    }, 260);
  }

  /** Cursor do teclado parou num jogador: a janela abre ao lado da casa. */
  private tipAtCursor(x: number, y: number): void {
    clearTimeout(this.tipTimer);
    const occ = playerAt(this.s, x, y);
    if (!occ) {
      hideTip();
      return;
    }
    this.tipTimer = window.setTimeout(() => {
      if (this.inDuel || !this.hover || !same(this.hover, { x, y })) return;
      const pt = this.renderer.clientPoint(x, y);
      showPlayerTip(this.s, occ, pt.x + 10, pt.y - 40, { compare: this.tipCompare() });
    }, 420);
  }

  /** O jogador em ação é o último livre do seu time e, depois de andar, não tem passe, chute, drible, desarme nem Muralha. */
  private lastWithNothingLeft(): boolean {
    const s = this.s;
    const a = s.activation;
    if (!a || !this.isPlayerTurn() || getPlayer(s, a.playerId).team !== PLAYER) return false;
    if (activationsLeft(s) > 1 && !activatable(s).every((p) => p.id === a.playerId)) return false;
    // A Muralha do goleiro ainda vale na defesa; a Pedalada sem bola nem drible por perto não muda nada.
    return this.cellTargets().length === 0 && !this.shotTarget(false) && !this.shotTarget(true) && canUseSpecial(s) !== 'muralha';
  }

  private nextFree(): Player | undefined {
    return activatable(this.s).find((p) => p.team === PLAYER);
  }

  private async resolveDuel(cs: DuelState): Promise<void> {
    this.flush();
    await this.renderer.idle();
    const atk = sidePlayer(this.s, cs, 'atk');
    this.inDuel = true;
    this.cancelTip();
    this.hl = emptyHighlights();
    this.el.hint.textContent = 'Duelo! 1–4 ou ↑↓ + Espaço escolhem o lance · L usa uma Leitura';
    try {
      // O Duelo acontece na própria quadra: zoom nos dois e o menu ao lado do seu jogador.
      await runInlineDuel({
        s: this.s,
        cs,
        playerSide: atk.team === PLAYER ? 'atk' : 'def',
        difficulty: this.config.difficulty,
        memory: this.memory,
        renderer: this.renderer,
        host: this.el.wrap,
      });
      applyDuel(this.s, cs);
      this.flush();
      await this.renderer.idle();
    } finally {
      this.renderer.endDuel();
      this.inDuel = false;
    }
    await sleep(220);
    this.renderPanels();
  }

  /** Chute de bola rolando: sem palpite, a chance já aparece no botão. */
  private async playerShot(bomba: boolean): Promise<void> {
    shoot(this.s, bomba);
  }

  /** Tiro livre direto da IA contra o seu goleiro: você escolhe o mergulho. */
  private async aiDirectKick(p: Player): Promise<{ corner: Corner; dive: Corner | null }> {
    const s = this.s;
    const pv = shotPreview(s, p, false, true);
    if (pv.open) return { corner: chooseCorner(s, pv), dive: null };
    this.renderer.lockOn(p.id);
    await sleep(350);
    if (pv.shooterReads) {
      const dive = await chooseShotCorner({ s, shooter: p, preview: pv, role: 'defesa', title: 'Tiro livre direto contra você' });
      const corner = CORNERS.find((c) => shotResult(pv, c, dive) === 'gol') ?? chooseCorner(s, pv);
      return { corner, dive };
    }
    const corner = chooseCorner(s, pv);
    const dive = await chooseShotCorner({
      s,
      shooter: p,
      preview: pv,
      role: 'defesa',
      title: 'Tiro livre direto contra você',
      revealed: pv.keeperReads ? corner : null,
    });
    return { corner, dive };
  }

  /** Tiro livre direto (da 4ª falta em diante), de qualquer um dos times. */
  private async directKick(): Promise<void> {
    const s = this.s;
    const dk = directKickPreview(s);
    if (!dk) return;
    this.renderer.pushEvents([{ kind: 'apito', text: 'Tiro livre direto!' }], s);
    await this.renderer.idle();
    if (dk.shooter.team === PLAYER) {
      const pv = dk.preview;
      const revealed = pv.shooterReads ? chooseDive(s) : null;
      const corner =
        (await chooseShotCorner({
          s,
          shooter: dk.shooter,
          preview: pv,
          role: 'chute',
          title: 'Tiro livre direto',
          revealed,
        })) ?? 'meio';
      takeDirectKick(s, corner, revealed ?? (pv.keeperReads ? corner : chooseDive(s)));
    } else {
      const { corner, dive } = await this.aiDirectKick(dk.shooter);
      takeDirectKick(s, corner, dive);
    }
    this.flush();
    await this.renderer.idle();
  }

  /** Fase da IA: um jogador vermelho de cada vez, com as animações de cada jogada. */
  private async runAiPhase(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.mode = 'normal';
    this.selectedId = null;
    this.renderer.lockOn(null);
    this.refreshHighlights();
    this.renderPanels();
    const s = this.s;
    const diff = this.config.difficulty;
    await sleep(350);
    let guard = 0;
    while (!s.over && s.activeTeam === AI && guard++ < 40) {
      if (s.pendingDirect) {
        await this.directKick();
        this.renderPanels();
        continue;
      }
      const plan = planActivation(s, diff);
      if (!plan) {
        endPhase(s);
        break;
      }
      this.selectedId = plan.playerId;
      let r = executePlan(s, plan);
      this.flush();
      await this.renderer.idle();
      if (r.reaction) {
        // Um jogador seu de prontidão deu o bote: você escolhe os lances.
        await this.resolveDuel(r.reaction);
        if (s.pendingDirect) continue;
        r = executeAction(s, plan.action);
        this.flush();
        await this.renderer.idle();
      }
      if (r.duel) {
        await this.resolveDuel(r.duel);
        if (s.pendingDirect) continue;
      }
      if (s.activation && s.activeTeam === AI) {
        if (s.activation.bonus) {
          await sleep(200);
          const out = executeAction(s, bonusAction(s, diff === 'craque' ? 'veterano' : diff));
          this.flush();
          await this.renderer.idle();
          if (out.duel) await this.resolveDuel(out.duel);
        }
        if (s.pendingDirect) continue;
        if (s.activation) endActivation(s);
      }
      this.flush();
      await this.renderer.idle();
      this.renderPanels();
      await sleep(diff === 'recruta' ? 160 : 120);
    }
    this.selectedId = null;
    this.busy = false;
    const first = this.nextFree();
    if (first && this.kbCursor) this.hover = { x: first.x, y: first.y };
    await this.settle();
  }

  // ---------- Seleção e cursor ----------

  private selectOwn(id: string): void {
    const s = this.s;
    if (this.busy) return;
    const p = getPlayer(s, id);
    if (this.isPlayerTurn() && p.team === PLAYER && activatable(s).some((q) => q.id === id) && s.activation?.playerId !== id) {
      if (s.activation && (s.activation.moved || s.activation.acted)) endActivation(s);
      beginActivation(s, id);
      this.mode = 'normal';
    }
    this.selectedId = id;
    if (p.team === PLAYER && this.isPlayerTurn()) this.renderer.focusOn(id);
    else this.renderer.lockOn(id);
    this.hover = { x: p.x, y: p.y };
    this.hoverByMouse = false;
    this.flush();
    this.refreshHighlights();
    this.renderPanels();
  }

  /** Casas onde o cursor do teclado pode parar quando há um jogador seu em ação. */
  private cursorCells(): Pos[] | null {
    const s = this.s;
    const a = s.activation;
    if (!a || !this.isPlayerTurn() || this.busy) return null;
    const p = getPlayer(s, a.playerId);
    return [{ x: p.x, y: p.y }, ...this.hl.moves, ...this.hl.targets.map((t) => ({ x: t.x, y: t.y }))];
  }

  private moveCursor(dx: number, dy: number): void {
    const s = this.s;
    const a = s.activation;
    const start = this.hover ?? (a ? getPlayer(s, a.playerId) : holderOf(s));
    let x = Math.max(0, Math.min(s.width - 1, start.x + dx));
    let y = Math.max(0, Math.min(s.height - 1, start.y + dy));
    const allowed = this.cursorCells();
    if (allowed) {
      let best: Pos | null = null;
      let bestScore = Infinity;
      for (const c of allowed) {
        const along = (c.x - start.x) * dx + (c.y - start.y) * dy;
        if (along <= 0) continue;
        const across = Math.abs((c.x - start.x) * dy) + Math.abs((c.y - start.y) * dx);
        if (across > along) continue;
        const score = along + across * 2;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (!best) return;
      x = best.x;
      y = best.y;
    }
    this.hover = { x, y };
    this.hoverByMouse = false;
    this.kbCursor = true;
    // Escolhendo o destino (ou o alvo), a câmera desliza até a casa do cursor.
    if (this.renderer.aiming) this.renderer.aimAt(x, y);
    else this.renderer.ensureVisible(x, y);
    this.tipAtCursor(x, y);
    this.refreshHighlights();
    this.renderHint();
  }

  private confirmCursor(): void {
    const s = this.s;
    const a = s.activation;
    const c = this.hover;
    if (!c) {
      if (a) this.endUnit();
      return;
    }
    if (a) {
      const p = getPlayer(s, a.playerId);
      if (same(p, c)) {
        this.endUnit();
        return;
      }
    }
    void this.onCellClick(c);
  }

  // ---------- Alvos ----------

  /** Ações válidas que aparecem na quadra, uma por casa (o passe respeita o modo rasteiro/alto). */
  private cellTargets(): { pos: Pos; target: Target; mark: TargetMark }[] {
    const s = this.s;
    const out: { pos: Pos; target: Target; mark: TargetMark }[] = [];
    const all = currentTargets(s);
    const passes = new Map<string, Target & { kind: 'passe' }>();
    for (const t of all) {
      if (t.kind !== 'passe') continue;
      const want = this.mode === 'alto';
      const prev = passes.get(t.toId);
      if (t.alto === want) passes.set(t.toId, t);
      else if (!prev && !want) passes.set(t.toId, t); // só alcança pelo alto
    }
    for (const t of passes.values()) {
      const q = getPlayer(s, t.toId);
      const tone = t.preview.result === 'ok' ? 'bom' : t.preview.result === 'dividida' ? 'risco' : 'ruim';
      const label = `${t.alto ? 'Passe alto' : 'Passe'} → ${q.name}${t.preview.result === 'cortado' ? ' (cortado!)' : t.preview.result === 'dividida' ? ' (dividida)' : ''}`;
      out.push({
        pos: q,
        target: t,
        mark: {
          x: q.x,
          y: q.y,
          kind: t.alto ? 'passe-alto' : 'passe',
          tone,
          label,
        },
      });
    }
    for (const t of all) {
      if (t.kind === 'drible' || t.kind === 'desarme' || t.kind === 'carrinho') {
        const q = getPlayer(s, t.targetId);
        // As chances aproximadas aparecem antes de começar o Duelo.
        const me = getPlayer(s, s.activation!.playerId);
        const pct = (v: number) => `${Math.round(v * 100)}%`;
        let label: string;
        if (t.kind === 'drible') {
          const o = duelOdds(s, me, q, false);
          label = `Driblar ${q.name} · passa ~${pct(o.ballWins)} · perde ~${pct(o.markWins)} · falta ~${pct(o.foul)}`;
        } else {
          const o = duelOdds(s, q, me, true, t.kind === 'carrinho' ? 1 : 0);
          label = `${t.kind === 'desarme' ? 'Desarmar' : 'Carrinho em'} ${q.name} · rouba ~${pct(o.markWins)} · falta ~${pct(o.foul)}`;
        }
        out.push({
          pos: q,
          target: t,
          mark: {
            x: q.x,
            y: q.y,
            kind: t.kind === 'drible' ? 'drible' : 'desarme',
            tone: 'risco',
            label,
          },
        });
      }
    }
    return out;
  }

  private shotTarget(bomba: boolean): (Target & { kind: 'chute' }) | undefined {
    return currentTargets(this.s).find((t): t is Target & { kind: 'chute' } => t.kind === 'chute' && t.bomba === bomba);
  }

  private refreshHighlights(): void {
    const s = this.s;
    const hl = emptyHighlights();
    hl.hover = this.hover;
    hl.kbCursor = this.kbCursor;
    hl.selectedId = this.selectedId;
    hl.activeId = s.activation?.playerId ?? null;
    if (this.isPlayerTurn() && !this.busy && s.activation) {
      hl.moves = destinations(s);
      const targets = this.cellTargets();
      hl.targets = targets.map((t) => t.mark);
      const p = getPlayer(s, s.activation.playerId);
      if (s.holder === p.id) {
        // Casas onde quem tem a bola pararia colado num defensor de prontidão (bote automático).
        const ready = s.players.filter((q) => q.team !== PLAYER && q.ready && !q.unbalanced);
        hl.dangerMoves = hl.moves.filter((m) => ready.some((q) => Math.max(Math.abs(q.x - m.x), Math.abs(q.y - m.y)) === 1));
      }
      if (s.holder === p.id && canAct(s)) {
        for (const q of s.players) {
          if (q.team === PLAYER || q.unbalanced || this.mode === 'alto') continue;
          // De prontidão, o defensor corta a 2 casas da linha.
          const r = cutRange(s, q);
          for (let dx = -r; dx <= r; dx++)
            for (let dy = -r; dy <= r; dy++)
              if (q.x + dx >= 0 && q.y + dy >= 0 && q.x + dx < s.width && q.y + dy < s.height) hl.cutZones.push({ x: q.x + dx, y: q.y + dy });
        }
        if (this.shotTarget(false) || this.shotTarget(true)) hl.shot = { team: PLAYER, text: '' };
      }
      const under = this.hover ? targets.find((t) => same(t.pos, this.hover!)) : undefined;
      if (under && under.target.kind === 'passe') {
        hl.passLine = {
          from: { x: p.x, y: p.y },
          to: under.pos,
          tone: under.mark.tone,
          alto: under.target.alto,
        };
      }
    }
    this.hl = hl;
    this.renderer.setAim((hl.moves.length > 0 || hl.targets.length > 0) && !!s.activation && this.renderer.lockedOn === s.activation.playerId);
  }

  private async onCellClick(c: Pos): Promise<void> {
    const s = this.s;
    if (this.busy || !this.isPlayerTurn()) return;
    const a = s.activation;
    const t = a ? this.cellTargets().find((x) => same(x.pos, c)) : undefined;
    if (t) {
      await this.doTarget(t.target);
      return;
    }
    const occ = playerAt(s, c.x, c.y);
    if (occ && occ.team === PLAYER && occ.id !== a?.playerId) {
      this.selectOwn(occ.id);
      return;
    }
    if (a && destinations(s).some((d) => same(d, c))) {
      await this.act(() => moveTo(s, c.x, c.y));
      return;
    }
    if (occ && occ.team === AI) {
      this.selectedId = occ.id;
      this.renderPanels();
    }
  }

  private async doTarget(t: Target): Promise<void> {
    const s = this.s;
    await this.act(async () => {
      switch (t.kind) {
        case 'passe': {
          const out = pass(s, t.toId, t.alto);
          if (out.duel) await this.resolveDuel(out.duel);
          break;
        }
        case 'drible':
          await this.resolveDuel(startDribble(s, t.targetId));
          break;
        case 'desarme':
          await this.resolveDuel(startTackle(s, t.targetId));
          break;
        case 'carrinho':
          await this.resolveDuel(startTackle(s, t.targetId, true));
          break;
        case 'chute':
          await this.playerShot(t.bomba);
          break;
      }
    });
  }

  // ---------- Comandos ----------

  private endUnit(): void {
    const s = this.s;
    if (!s.activation || this.busy || !this.isPlayerTurn()) return;
    endActivation(s);
    this.afterUnit();
    void this.settle();
  }

  private endPlayerPhase(): void {
    if (this.busy || !this.isPlayerTurn()) return;
    endPhase(this.s);
    this.afterUnit();
    void this.settle();
  }

  private escape(): void {
    const s = this.s;
    if (this.busy) {
      this.renderer.lockOn(null);
      return;
    }
    if (this.mode !== 'normal') this.mode = 'normal';
    else if (s.activation && this.isPlayerTurn()) {
      const a = s.activation;
      if (a.moved && !a.acted) {
        void this.act(() => undoMove(s));
        return;
      }
      if (!a.moved && !a.acted) {
        cancelActivation(s);
        this.selectedId = null;
      }
    } else this.selectedId = null;
    this.renderer.lockOn(null);
    this.refreshHighlights();
    this.renderPanels();
  }

  private doSprint(): void {
    if (this.busy || !canSprint(this.s)) return;
    sprint(this.s);
    this.renderer.pushEvents([{ kind: 'emote', id: this.s.activation!.playerId, emote: 'suor' }], this.s);
    this.refreshHighlights();
    this.renderPanels();
  }

  private doSpecial(): void {
    if (this.busy || !canUseSpecial(this.s)) return;
    void this.act(() => useSpecial(this.s));
  }

  /** Toma o energético guardado: fôlego e HAB cheios e, se ainda não andou, +2 casas. */
  private doDrink(): void {
    if (this.busy || !this.isPlayerTurn() || !canUseDrink(this.s)) return;
    void this.act(() => useDrink(this.s));
  }

  private doShot(bomba: boolean): void {
    const t = this.shotTarget(bomba);
    if (!t || this.busy) return;
    void this.doTarget(t);
  }

  private toggleAlto(): void {
    if (this.busy) return;
    this.mode = this.mode === 'alto' ? 'normal' : 'alto';
    this.refreshHighlights();
    this.renderPanels();
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.inDuel || document.querySelector('.modal-bg')) return;
    const k = e.key.toLowerCase();
    if (e.key === '0' || e.key === 'Home') {
      this.renderer.resetCamera();
      return;
    }
    if (this.busy) {
      if (e.key === 'Escape' || k === 'x') this.renderer.lockOn(null);
      return;
    }
    const steps: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (steps[e.key]) {
      e.preventDefault();
      this.moveCursor(...steps[e.key]);
    } else if (e.key === ' ') {
      e.preventDefault();
      if (this.isPlayerTurn()) this.confirmCursor();
    } else if (e.key === 'Enter' || k === 'z') {
      e.preventDefault();
      this.endUnit();
    } else if (e.key === 'Escape' || k === 'x') {
      this.escape();
    } else if (/^[1-5]$/.test(e.key)) {
      const mine = this.s.players.filter((p) => p.team === PLAYER);
      const p = mine[Number(e.key) - 1];
      if (p) this.selectOwn(p.id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const free = activatable(this.s).filter((p) => p.team === PLAYER);
      if (!free.length) return;
      const i = free.findIndex((p) => p.id === this.s.activation?.playerId);
      this.selectOwn(free[(i + 1) % free.length].id);
    } else if (k === 'e') this.endPlayerPhase();
    else if (k === 'r') this.doSprint();
    else if (k === 'a') this.toggleAlto();
    else if (k === 'c') this.doShot(false);
    else if (k === 'b') this.doShot(true);
    else if (k === 'h') this.doSpecial();
    else if (k === 'g') this.doDrink();
  };

  // ---------- Painéis ----------

  private renderPanels(): void {
    this.renderTop();
    this.renderSide();
    this.renderHint();
    this.renderLog();
  }

  private renderTop(): void {
    const s = this.s;
    const fouls = (t: Team) => {
      const dots = [];
      for (let i = 1; i <= FOUL_LIMIT; i++) dots.push(h('i', { class: i <= s.fouls[t] ? 'on' : '' }));
      return h(
        'div',
        {
          class: 'fouls',
          title: `Faltas no tempo (da ${FOUL_LIMIT}ª em diante, tiro livre direto)`,
        },
        h('span', {}, 'faltas'),
        dots,
      );
    };
    const styleTag = (t: Team) => {
      const d = STYLES[s.styles[t]];
      const tr = s.players.filter((p) => p.team === t && p.trait).map((p) => `◈ ${TRAITS[p.trait!].name} (${p.name})`);
      return h(
        'div',
        { class: 'style-tag', title: [`${d.name}`, `+ ${d.plus}`, `− ${d.minus}`, ...tr].join('\n') },
        d.name,
        tr.length ? ` · ◈${tr.length}` : '',
      );
    };
    const turn = s.over ? 'Fim de jogo' : s.activeTeam === PLAYER ? 'Sua vez' : 'Vez do Vermelho (IA)';
    clear(this.el.top);
    this.el.top.append(
      h('div', { class: 'team-score azul' }, h('div', { class: 'tname' }, 'AZUL'), styleTag('azul'), fouls('azul')),
      h(
        'div',
        { class: 'score-mid' },
        h(
          'div',
          { class: 'score' },
          h('b', { class: 'azul' }, String(s.score.azul)),
          h('span', {}, '×'),
          h('b', { class: 'vermelho' }, String(s.score.vermelho)),
        ),
        h('div', { class: 'clock' }, `${s.half}º tempo · Rodada ${Math.min(s.round, ROUNDS_PER_HALF)}/${ROUNDS_PER_HALF}`),
        h('div', { class: `turn ${s.over ? '' : s.activeTeam}` }, turn),
      ),
      h('div', { class: 'team-score vermelho' }, h('div', { class: 'tname' }, 'VERMELHO'), styleTag('vermelho'), fouls('vermelho')),
    );
  }

  private card(p: Player, index: number | null): HTMLElement {
    const s = this.s;
    const def = statsOf(p);
    const isActive = s.activation?.playerId === p.id;
    const extra = s.activeTeam === p.team ? extraMode(s, p) : null;
    const tags: string[] = [];
    if (s.holder === p.id) tags.push('⚽');
    if (p.unbalanced) tags.push('💫');
    if (p.ready && s.activeTeam !== p.team) tags.push('❗');
    if (p.muralha) tags.push('🧱');
    if (p.pedalada) tags.push('🌀');
    if (p.energetico) tags.push('🧃');
    const bar = (v: number, max: number, cls: string) => h('div', { class: `bar ${cls}` }, h('div', { style: `width:${(100 * v) / max}%` }));
    return h(
      'div',
      {
        class: `pcard ${p.team}${isActive ? ' active' : ''}${p.activated && s.activeTeam === p.team && !extra ? ' done' : ''}${this.selectedId === p.id ? ' sel' : ''}`,
        onclick: () => (p.team === PLAYER ? this.selectOwn(p.id) : ((this.selectedId = p.id), this.renderPanels())),
        onmouseenter: (e: MouseEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          showPlayerTip(this.s, p, r.left, r.top, { side: 'left', compare: this.tipCompare() });
        },
        onmouseleave: () => hideTip(),
      },
      h('img', { src: portraitUrl(p, 2), alt: p.name }),
      h(
        'div',
        { class: 'pinfo' },
        h(
          'div',
          { class: 'pname' },
          index ? h('kbd', {}, String(index)) : null,
          roleBadge(p.role),
          `#${p.number} ${p.name}`,
          h('span', { class: 'tags' }, tags.join(' ')),
        ),
        h(
          'div',
          { class: 'prole' },
          `${def.name} · `,
          p.trait ? h('span', { class: 'ptrait', title: `${TRAITS[p.trait].plus}\n− ${TRAITS[p.trait].minus}` }, TRAITS[p.trait].name) : null,
          p.trait === 'pulmao' || p.trait === 'goleiroPes' || p.trait === 'goleiroParedao'
            ? ''
            : `${p.trait ? ' · ' : ''}${hasSpecial(p) ? def.special : `${def.special} usado`}`,
          extra ? h('span', { class: 'ptrait on' }, extra === 'escora' ? ' ↩ escora' : ' ↩ tabela') : null,
        ),
        h('div', { class: 'bars' }, bar(p.fol, def.fol, 'fol'), bar(p.hab, def.hab, 'hab')),
      ),
    );
  }

  private renderSide(): void {
    const s = this.s;
    clear(this.el.side);
    const mine = s.players.filter((p) => p.team === PLAYER);
    const theirs = s.players.filter((p) => p.team === AI);
    this.el.side.append(
      this.actionCard(),
      h(
        'div',
        { class: 'cards' },
        h('div', { class: 'cards-title' }, 'Seu time — Azul'),
        mine.map((p, i) => this.card(p, i + 1)),
      ),
      h(
        'div',
        { class: 'cards' },
        h('div', { class: 'cards-title' }, 'Vermelho (IA)'),
        theirs.map((p) => this.card(p, null)),
      ),
    );
  }

  private actionCard(): HTMLElement {
    const s = this.s;
    const a = s.activation;
    if (s.over) return h('div', { class: 'action-card' }, h('b', {}, 'Fim de jogo'));
    if (!this.isPlayerTurn()) {
      const p = this.selectedId ? getPlayer(s, this.selectedId) : null;
      return h(
        'div',
        { class: 'action-card wait' },
        h('b', {}, 'O Vermelho está jogando…'),
        h('div', { class: 'sub' }, p ? `${p.name} (${ROLES[p.role].name}) em ação` : 'Assista e se prepare para defender.'),
      );
    }
    if (!a || getPlayer(s, a.playerId).team !== PLAYER) {
      const left = activationsLeft(s);
      const withBall = s.activationsMax > 3;
      return h(
        'div',
        { class: 'action-card' },
        h('b', {}, withBall ? 'Sua fase · com a bola' : 'Sua fase · sem a bola'),
        h(
          'div',
          { class: 'sub' },
          `Ainda pode ativar ${left} de ${s.activationsMax} jogador(es). Escolha um (1–5, Tab ou clique).` +
            (withBall ? '' : ' Quem não for ativado fica de prontidão: corta passe mais longe e dá bote em quem parar colado.'),
        ),
        h('div', { class: 'btns' }, h('button', { onclick: () => this.endPlayerPhase() }, 'E · Encerrar fase')),
      );
    }
    const p = getPlayer(s, a.playerId);
    const def = statsOf(p);
    const hasBall = s.holder === p.id;
    const shot = this.shotTarget(false);
    const bomba = this.shotTarget(true);
    const special = canUseSpecial(s);
    const status =
      a.mode === 'escora'
        ? 'Escora: devolva de primeira com um passe rasteiro (sem andar).'
        : a.mode === 'tabela' && !a.acted
          ? 'Tabela! Anda até 2 casas e chuta ou passa.'
          : a.bonus
            ? 'Drible vencido! Ainda pode passar ou chutar.'
            : a.acted
              ? 'Já agiu.'
              : a.moved
                ? 'Andou. Agora pode agir.'
                : 'Ande e depois aja (ou só aja).';
    const pct = (t: Target & { kind: 'chute' }) => Math.round(goalChance(t.preview) * 100);
    const shotTitle = (t: (Target & { kind: 'chute' }) | undefined) => {
      if (!t) return 'Longe demais do gol';
      const pv = t.preview;
      const cover = { fechado: 'goleiro bem colocado', normal: 'goleiro no lugar', deslocado: 'goleiro fora do ângulo', fora: 'gol vazio' }[pv.cover];
      return `Força ${pv.force} contra reflexo ${pv.refEff} · ${cover}${pv.wide ? ' · ângulo fechado' : ''}${pv.blockerId ? ' · defensor na linha' : ''}`;
    };
    const ctx = `Jogador ${s.activationsUsed + 1} de ${s.activationsMax}${s.activationsMax > 3 ? '' : ` · desarmes ${s.tacklesUsed}/1`}`;
    return h(
      'div',
      { class: `action-card ${p.team}` },
      h(
        'div',
        { class: 'ac-head' },
        h('img', { src: portraitUrl(p, 3) }),
        h('div', {}, h('b', {}, roleBadge(p.role), `#${p.number} ${p.name}`), h('div', { class: 'sub' }, `${def.name} · ${def.blurb}`)),
      ),
      h(
        'div',
        { class: 'stats' },
        ['MOV', 'PAS', 'DOM', 'HAB', 'FIN', 'MAR'].map((k, i) =>
          h('span', {}, h('i', {}, k), String([def.mov, def.pas, def.dom, def.hab, def.fin, def.mar][i])),
        ),
      ),
      h('div', { class: 'sub' }, `Fôlego ${p.fol}/${def.fol}${p.fol < 2 ? ' (cansado: −1 lance)' : ''} · HAB ${p.hab}/${def.hab} · ${ctx}`),
      h('div', { class: 'notice' }, status),
      s.styles[PLAYER] === 'posse' && hasBall && s.possStreak[PLAYER] - 1 + s.passChain > 0
        ? h('div', { class: 'notice' }, `Posse trabalhada: +${Math.min(3, s.possStreak[PLAYER] - 1 + s.passChain)} de força no chute.`)
        : null,
      s.counterPhase && s.styles[PLAYER] === 'contra'
        ? h('div', { class: 'notice' }, `Contra-ataque! Todos andam +1 casa${s.counterAltoUsed ? '' : ' e o 1º passe alto é livre'}.`)
        : null,
      h(
        'div',
        { class: 'btns' },
        a.mode !== 'normal'
          ? null
          : h(
              'button',
              {
                disabled: !canSprint(s),
                onclick: () => this.doSprint(),
                title: `+${sprintBonus(p)} casas de movimento por ${sprintCost(p)} de fôlego`,
              },
              a.sprinted ? 'Arrancando!' : 'R · Arrancada',
            ),
        hasBall && canAct(s) && a.mode !== 'escora'
          ? h(
              'button',
              {
                class: this.mode === 'alto' ? 'on' : '',
                onclick: () => this.toggleAlto(),
                title:
                  'Passe por cima: +1 de alcance, ignora quem corta, custa 1 de fôlego; qualquer defensor a 2 casas disputa a recepção e quem recebe não chuta nem dribla nesta fase',
              },
              `A · Passe ${this.mode === 'alto' ? 'alto ✓' : 'alto'}`,
            )
          : null,
        hasBall && a.mode !== 'escora'
          ? h(
              'button',
              { disabled: !shot, onclick: () => this.doShot(false), title: shotTitle(shot) },
              shot ? `C · Chutar (${pct(shot)}%)` : 'C · Chutar (longe)',
            )
          : null,
        p.role === 'pivo' && hasBall && hasSpecial(p) && a.mode === 'normal'
          ? h(
              'button',
              {
                disabled: !bomba,
                onclick: () => this.doShot(true),
                title: `${def.specialText} · ${shotTitle(bomba)}`,
              },
              bomba ? `B · Bomba (${pct(bomba)}%)` : 'B · Bomba',
            )
          : null,
        (p.role === 'goleiro' || p.role === 'ala') && p.trait !== 'pulmao' && p.trait !== 'goleiroPes' && p.trait !== 'goleiroParedao' && a.mode === 'normal'
          ? h(
              'button',
              {
                disabled: !special,
                onclick: () => this.doSpecial(),
                title: def.specialText,
              },
              `H · ${def.special}`,
            )
          : null,
        p.energetico
          ? h(
              'button',
              {
                class: 'drink-btn',
                disabled: !canUseDrink(s),
                onclick: () => this.doDrink(),
                title: 'Fôlego e HAB cheios e, se ainda não andou, +2 casas nesta jogada. Não gasta a ação.',
              },
              h('img', { src: drinkIconUrl(2), alt: '' }),
              'G · Energético',
            )
          : null,
        h('button', { disabled: !(a.moved && !a.acted), onclick: () => this.escape() }, 'X · Desfazer'),
        h('button', { class: 'primary', onclick: () => this.endUnit() }, 'Z · Terminar jogador'),
        h('button', { onclick: () => this.endPlayerPhase() }, 'E · Encerrar fase'),
      ),
    );
  }

  private renderHint(): void {
    const s = this.s;
    let text = 'Setas movem o cursor · Espaço confirma · 1–5/Tab escolhem · Z termina · X volta · roda do mouse = zoom · 0 centraliza';
    if (this.hover) {
      const t = this.cellTargets().find((x) => same(x.pos, this.hover!));
      const occ = playerAt(s, this.hover.x, this.hover.y);
      if (t && this.isPlayerTurn()) text = `${t.mark.label} — clique ou Espaço`;
      else if (occ) {
        const d = statsOf(occ);
        text = `${occ.name} (${TEAM_NAME[occ.team]}) · ${d.name} · fôlego ${occ.fol}/${d.fol} · HAB ${occ.hab}/${d.hab}${occ.unbalanced ? ' · desequilibrado' : ''}`;
      } else if (this.hl.moves.some((m) => same(m, this.hover!))) text = 'Andar até aqui — clique ou Espaço';
    }
    if (this.s.activation && this.isPlayerTurn()) {
      const p = getPlayer(s, this.s.activation.playerId);
      const near = s.players.filter((q) => q.team !== p.team && chebyshev(q, p) === 1 && !q.unbalanced).length;
      if (s.holder === p.id && near && !this.s.activation.moved) text += ` · ${near} marcador(es) colado(s): com a bola, só sai driblando`;
    }
    this.el.hint.textContent = text;
  }

  private renderLog(): void {
    clear(this.el.log);
    this.el.log.append(
      h('div', { class: 'cards-title' }, 'Lances'),
      ...this.s.log
        .slice(-7)
        .reverse()
        .map((l) => h('div', {}, l)),
    );
  }

  /** Intervalo: cada time pode trocar o estilo, já sabendo o placar e o plano do outro. */
  private halftime(): Promise<void> {
    const s = this.s;
    const ai = chooseStyle(s, AI, this.config.difficulty, true);
    return new Promise((resolve) => {
      const bg = h('div', { class: 'modal-bg' });
      let pick: Style = s.styles[PLAYER];
      const theirs = s.styles[AI];
      const close = () => {
        bg.remove();
        document.removeEventListener('keydown', onKey);
        setStyle(s, PLAYER, pick);
        setStyle(s, AI, ai);
        if (ai !== theirs) s.events.push({ kind: 'apito', text: `Vermelho muda para ${STYLES[ai].name}` });
        this.renderPanels();
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          close();
        }
      };
      document.addEventListener('keydown', onKey);
      const render = () => {
        clear(bg);
        bg.append(
          h(
            'div',
            { class: 'modal halftime' },
            h('h2', {}, 'Intervalo'),
            h(
              'div',
              { class: 'final' },
              h('b', { class: 'azul' }, `Azul ${s.score.azul}`),
              ' × ',
              h('b', { class: 'vermelho' }, `${s.score.vermelho} Vermelho`),
            ),
            h(
              'p',
              { class: 'sub' },
              `O Vermelho jogou o 1º tempo em ${STYLES[theirs].name}.`,
              STYLES[theirs].losesTo ? ` Quem leva vantagem contra ele: ${STYLES[STYLES[theirs].losesTo!].name}.` : ' Ele está fora do ciclo.',
              ' A IA também pode trocar o dela.',
            ),
            s.extraTrait[PLAYER]
              ? h(
                  'p',
                  { class: 'sub' },
                  `Se sair do Equilíbrio, ${getPlayer(s, s.extraTrait[PLAYER]!).name} perde ${TRAITS[getPlayer(s, s.extraTrait[PLAYER]!).trait!].name}.`,
                )
              : null,
            h(
              'div',
              { class: 'style-grid small' },
              STYLE_LIST.map((st) =>
                h(
                  'button',
                  {
                    class: `style-card ${pick === st ? 'on' : ''}`,
                    onclick: () => {
                      pick = st;
                      render();
                    },
                  },
                  h('b', {}, STYLES[st].name),
                  h('div', { class: 'plus' }, '+ ', STYLES[st].plus),
                  h('div', { class: 'minus' }, '− ', STYLES[st].minus),
                ),
              ),
            ),
            h('div', { class: 'lance-buttons' }, h('button', { class: 'primary', onclick: close }, 'Começar o 2º tempo (Enter)')),
          ),
        );
      };
      render();
      document.body.append(bg);
    });
  }

  private showEnd(): void {
    if (this.ended) return;
    this.ended = true;
    const s = this.s;
    const scorers = s.players.filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals);
    const title = s.winner === 'empate' ? 'Empate!' : s.winner === PLAYER ? 'Vitória do Azul!' : 'O Vermelho venceu';
    const bg = h('div', { class: 'modal-bg' });
    const close = (rematch: boolean) => {
      bg.remove();
      this.onExit(rematch);
    };
    bg.append(
      h(
        'div',
        { class: 'modal end' },
        h('h2', {}, title),
        h('div', { class: 'final' }, h('b', { class: 'azul' }, `Azul ${s.score.azul}`), ' × ', h('b', { class: 'vermelho' }, `${s.score.vermelho} Vermelho`)),
        h(
          'div',
          { class: 'scorers' },
          scorers.length
            ? scorers.map((p) => h('div', { class: p.team }, h('img', { src: portraitUrl(p, 2) }), `${p.name} — ${p.goals} gol${p.goals > 1 ? 's' : ''}`))
            : h('div', {}, 'Ninguém marcou.'),
        ),
        h(
          'div',
          { class: 'lance-buttons' },
          h('button', { class: 'primary', onclick: () => close(true) }, 'Revanche'),
          h('button', { onclick: () => close(false) }, 'Voltar ao início'),
        ),
      ),
    );
    document.body.append(bg);
  }
}
