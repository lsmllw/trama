# Tático Steampunk: protótipo da Fase 1

Protótipo cinza, jogável no navegador, de um jogo de ação tática inspirado em FF Tactics e Fire Emblem. Uma partida é Azul (você) contra Vermelho (máquina), com 5 unidades de cada lado, no mapa "Vau do Prisma" (16×12).

O objetivo desta fase é responder uma pergunta: **o Confronto é divertido com quadrados cinza?** Por isso ainda não há arte, cores, itens nem construções.

## Rodar

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm run build      # gera dist/index.html, um arquivo só que abre direto no navegador
npm test           # testes das regras
npm run sim -- 1000 veterano   # 1000 partidas IA × IA, com estatísticas
```

## Como jogar

- Os times se alternam **ativando uma unidade por vez**. Cada unidade move e faz uma ação por rodada.
- **Vitória:** destruir a Base (QG) inimiga ou eliminar todas as unidades. Se ninguém vencer até a rodada 20, decide por pontos: 3 por abate, 1 a cada 10 de dano na Base inimiga.
- **Confronto (corpo a corpo):** 3 tempos. Leve tem 3 lances, Médio 2, Pesado 1, mas o lance do pesado bate mais forte (×1,6).
  - Golpe vence Finta · Guarda vence Golpe · Finta vence Guarda e quem espera.
  - Esperar não gasta lance; bloqueia Golpe e perde para Finta.
  - Atacar pelo flanco dá +1 lance, pelas costas +2. Lance acima de 3 vira **Leitura** (ver o lance do inimigo antes de escolher).
  - Quem perde para uma Finta fica **Exposto**: no tempo seguinte, escolhe primeiro e o outro vê.
- **Prontidão (!):** quem não agiu na ativação ganha +1 lance ao defender.
- **Stamina** (barra amarela): lances, Correr e Cura gastam; volta 3 por rodada. Com 0, a unidade fica Exausta.
- **Morteiro:** marca uma cruz de 5 casas e o disparo cai 2 ativações depois. **Granada:** explode na hora. As duas atingem aliados.
- **Base:** 60 HP; no fim de cada rodada acerta 5 em cada inimigo encostado nela.

### Controles

| Ação | Mouse | Teclado |
| --- | --- | --- |
| Selecionar unidade | clique | — |
| Mover / atacar / curar | clique na casa azul / vermelha / verde | — |
| Mirar morteiro ou granada | botão Mirar | M |
| Correr (+2 casas, 2 ST) | botão | R |
| Desfazer movimento | botão ou clique direito | Z |
| Virar a unidade | setas no painel | ← ↑ → ↓ |
| Encerrar ativação | botão | Espaço |
| Lances no Confronto | botões | 1 Golpe · 2 Guarda · 3 Finta · 4 Esperar · L Leitura |

## Estrutura

```
src/core/      regras puras, sem tela (determinísticas, com semente)
  data.ts        classes, pesos, terrenos, constantes de balanceamento
  map.ts         mapa "Vau do Prisma" em texto
  grid.ts        movimento (Dijkstra), linha de visão, flanco
  combat.ts      dano, área, vitória
  confronto.ts   o Confronto: lances, matriz, Exposição, Leitura
  game.ts        criação da partida, ativações, ações, fim de rodada
  ai.ts          IA de utilidade + IA de lances + simulação sem tela
src/ui/        canvas, painéis, janela do Confronto, seleção de time
tests/         testes das regras (Vitest)
scripts/       simulação IA × IA
```

O núcleo não conhece a tela: a mesma lógica roda no navegador, nos testes e na simulação.

## Primeiros números (1000 partidas IA × IA, Veterano)

- Lado não decide: Azul 48,8% × Vermelho 50,5% (0,7% de empates).
- Partidas curtas: 6,3 rodadas em média; 69% terminam por eliminação, 30% pela Base.
- Classes pesadas estão fortes demais: times com Blindado vencem 67%; com Espião, 42%.

## O que fica para a Fase 2

Habilidades e Técnicas de cada classe, level e XP, construções (Fortaleza, Acampamento, Igreja…), coleta de cores, itens e triângulo verde > roxo > laranja. Os nós de cor e a Fonte já aparecem no mapa, mas ainda não fazem nada.
