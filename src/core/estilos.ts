// Estilos de jogo: o plano que cada time escolhe antes da partida (e pode trocar no intervalo).
// Cada estilo ganha numa coisa e paga em outra; os quatro principais formam um ciclo:
// Pressão alta > Posse de bola > Bloco baixo > Contra-ataque > Pressão alta.

export type Style = 'equilibrio' | 'pressao' | 'posse' | 'bloco' | 'contra';

export interface StyleDef {
  name: string;
  /** Uma linha sobre a ideia do estilo. */
  blurb: string;
  plus: string;
  minus: string;
  /** Contra quem ele leva vantagem (e para quem perde), no ciclo. */
  beats: Style | null;
  losesTo: Style | null;
}

export const STYLE_LIST: Style[] = ['pressao', 'posse', 'bloco', 'contra', 'equilibrio'];

export const STYLES: Record<Style, StyleDef> = {
  pressao: {
    name: 'Pressão alta',
    blurb: 'Sufoca quem tem a bola no campo de ataque.',
    plus: 'Sem a bola, ativa 4 jogadores (em vez de 3) e pode tentar 2 desarmes por fase.',
    minus: 'Quem joga sem a bola gasta 2 de fôlego a mais, e só 1 fica de prontidão.',
    beats: 'posse',
    losesTo: 'contra',
  },
  posse: {
    name: 'Posse de bola',
    blurb: 'Toque curto e paciência até abrir espaço.',
    plus: 'Toque curto (até 3 casas) só é cortado por quem estiver em cima da linha e não sofre bote com bônus. Cada fase seguida com a bola dá +1 de força no chute (até +2).',
    minus: 'Passe alto custa 2 de fôlego, e chute de longe (mais de 5 casas) perde 1 de força.',
    beats: 'bloco',
    losesTo: 'pressao',
  },
  bloco: {
    name: 'Bloco baixo',
    blurb: 'Fecha o próprio campo e espera o erro.',
    plus: 'Sem a bola, a prontidão corta passe a 3 casas e o bote no próprio campo ganha +1 lance. No próprio campo, nunca é pego fora de posição.',
    minus: 'Sem a bola, ativa só 2 jogadores: quase não recupera a bola lá na frente.',
    beats: 'contra',
    losesTo: 'posse',
  },
  contra: {
    name: 'Contra-ataque',
    blurb: 'Rouba e sai rápido nas costas da defesa.',
    plus: 'Na fase depois de recuperar a bola, quem não estava de prontidão do outro lado está fora de posição (não corta passe nem segura quem tem a bola), todos andam +1 e o 1º passe alto é livre.',
    minus: 'Com a bola por mais de 2 fases seguidas, ativa só 4 jogadores.',
    beats: 'pressao',
    losesTo: 'bloco',
  },
  equilibrio: {
    name: 'Equilíbrio',
    blurb: 'Sem plano fixo: lê o jogo e se adapta.',
    plus: 'Nenhuma fraqueza de estilo (e, quando houver Características, leva uma a mais).',
    minus: 'Nenhuma vantagem de estilo.',
    beats: null,
    losesTo: null,
  },
};

/** Alcance de corte de passe dos estilos (quem está de prontidão / quem não está). */
export const BLOCO_CUT = 3;
export const POSSE_SHORT = 3;
/** Fôlego extra que cada jogador da Pressão alta gasta ao jogar sem a bola. */
export const PRESSAO_FOL = 2;
