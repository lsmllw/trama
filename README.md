# Trama: protótipo jogável

Protótipo cinza, jogável no navegador, de um jogo de ação tática em fantasia steampunk inspirado em FF Tactics e Fire Emblem. Uma partida é Azul (você) contra Vermelho (máquina), com 5 unidades de cada lado, no mapa "Vau do Prisma" (24×16).

O objetivo é responder uma pergunta: **o Confronto é divertido com quadrados cinza?** Por isso ainda não há arte final nem construções.

## Rodar

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm run build      # gera dist/index.html, um arquivo só que abre direto no navegador
npm test           # testes das regras
npm run sim -- 1000 veterano   # 1000 partidas IA × IA, com estatísticas
npm run balance                # relatório de balanceamento: classes e arquétipos
npm run tune                   # compara variações de números (edite scripts/tune.ts)
```

## Como jogar

- **Turno por fase:** você move todas as suas unidades, na ordem que quiser; depois a IA move todas as dela. Uma rodada tem as duas fases.
- **Cada unidade: mover e depois 1 ação** (atacar, curar, coletar, usar item ou habilidade). A tecla E encerra a fase; quem não agiu ganha Prontidão.
- **Vitória:** destruir a Base (QG) inimiga ou eliminar todas as unidades. Se ninguém vencer até a rodada 20, decide por pontos: 3 por abate, 1 a cada 10 de dano na Base inimiga.
- **Confronto (corpo a corpo):** 3 tempos. Leve tem 3 lances, Médio 2, Pesado 1, mas o lance do pesado bate mais forte (×1,6).
  - Golpe vence Finta · Guarda vence Golpe · Finta vence Guarda e quem espera.
  - Esperar não gasta lance; bloqueia Golpe e perde para Finta.
  - **O peso define os lances; a posição define a informação.** Atacar pelo flanco dá 1 **Leitura**, pelas costas 2 (ver o lance do inimigo antes de escolher). Lance acima de 3 também vira Leitura.
  - Quem perde para uma Finta fica **Exposto**: no tempo seguinte, escolhe primeiro e o outro vê.
- **Prontidão (!):** quem não agiu na ativação ganha +1 lance ao defender.
- **Stamina** (barra amarela): lances, Correr e Cura gastam; volta 3 por rodada. Com 0, a unidade fica Exausta.
- **Morteiro:** marca uma cruz de 5 casas e o disparo cai no começo da próxima fase de quem atirou (o inimigo tem a fase dele para sair). **Granada:** explode na hora. Os dois atingem aliados.
- **Level e XP:** acertar ou vencer um Confronto dá 1 XP, abater dá 2, coletar ou curar dá 1. Level 2 com 3 XP (até o 5). Cada level dá +3 HP máximo e +1 ATQ.
- **Habilidades:** uma por classe, liberada no level 2, paga com Stamina. Avanço, Tiro certeiro, Provocar, Investida, Atropelar, Fumaça, Perfurante, Mina, Reparo, Barricada, Cura em área e Furtar.
- **Itens:** coletados nos nós de cor (cada nó tem 3 cargas e recupera 1 por rodada). Verde dá Tônico (+12 HP), laranja dá Óleo de combate (+3 ATQ no próximo ataque), roxo dá Elixir de foco (+1 lance no próximo Confronto e +4 Stamina). A Fonte Prismática no centro dá qualquer um. Cada unidade carrega até 2.
- **Base:** 60 HP; no fim de cada rodada acerta 5 em cada inimigo encostado nela.
- **Blindado:** anda só 3 casas e só em terreno liso (não entra em floresta, colina, ruína, lama nem barricada).
- **Bombardeiro, o contra do Blindado:** planta minas desde o level 1 (até 3 ativas). Mina causa 8; num Blindado, 16 e ele fica imobilizado na fase seguinte. A granada dele ignora a armadura do Blindado.

### Controles

| Ação | Mouse | Teclado |
| --- | --- | --- |
| Selecionar unidade | clique | — |
| Mover / atacar / curar | clique na casa azul / vermelha / verde | — |
| Mirar morteiro ou granada | botão Mirar | M |
| Habilidade | botão da habilidade | H |
| Coletar / usar item | botões no painel | — |
| Encerrar a fase | botão | E |
| Correr (+2 casas, 2 ST) | botão | R |
| Desfazer movimento | botão ou clique direito | Z |
| Virar a unidade | setas no painel | ← ↑ → ↓ |
| Encerrar a unidade | botão | Espaço |
| Lances no Confronto | botões | 1 Golpe · 2 Guarda · 3 Finta · 4 Esperar · L Leitura |

## Estrutura

```
src/core/      regras puras, sem tela (determinísticas, com semente)
  data.ts        classes, pesos, terrenos, constantes de balanceamento
  map.ts         mapa "Vau do Prisma" em texto
  grid.ts        movimento (Dijkstra), linha de visão, flanco
  combat.ts      dano, área, vitória
  confronto.ts   o Confronto: lances, matriz, Exposição, Leitura
  game.ts        criação da partida, fases, ações, coleta, itens, fim de rodada
  abilities.ts   as 12 habilidades de classe
  ai.ts          IA de utilidade (inclui itens e habilidades) + IA de lances + simulação
src/ui/        canvas, painéis, janela do Confronto, seleção de time
tests/         testes das regras (Vitest)
scripts/       simulação IA × IA
```

O núcleo não conhece a tela: a mesma lógica roda no navegador, nos testes e na simulação.

## Balanceamento (`npm run balance`, IA Veterano × Veterano)

Taxa de vitória dos times que tinham cada classe (1500 partidas com times sorteados). A faixa saudável é 45% a 55%.

| Classe | Antes | Agora |
| --- | --- | --- |
| Blindado | 66,8% | 49,5% |
| Cavaleiro | 60,0% | 57,7% |
| Atirador | 55,4% | 59,1% |
| Canhão | 48,2% | 58,7% |
| Bombardeiro | 46,9% | 52,4% |
| Morteiro | 39,8% | 52,2% |
| Espião | 41,9% | 48,1% |
| Tank | 56,5% | 44,5% |
| Construtor | 49,3% | 43,1% |

Arquétipos (8 times fixos se enfrentando, 30 partidas por par): o time com dois Blindados caiu de **91% para 47%** de vitórias, e o Antiblindado (dois Bombardeiros) vence os Blindados em 55% dos confrontos diretos. Ainda fora da faixa: Artilharia (76%), Infiltração (33%) e Engenharia (28%).

O que mudou para chegar aqui:

- **Flanco e costas dão Leitura em vez de lances.** Era a causa principal: o Blindado atacava pelo flanco ou pelas costas em 98% dos Confrontos e ganhava até 3 lances com força ×1,6.
- **IA com mapa de perigo:** ela sabe quais casas o inimigo alcança na fase seguinte e evita terminar onde pode morrer. Antes, as unidades rápidas chegavam uma a uma e eram destruídas, o que favorecia times lentos.
- Blindado com MOV 3 e só terreno liso; minas e granada antitanque do Bombardeiro.
- Números: Atirador ATQ 5, Cavaleiro ATQ 7, Canhão ATQ 9, Mecânico ATQ 6, Construtor ATQ 7, Espião ATQ 8 e HP 20; Reparo do Mecânico vale para qualquer aliado.

## O que ainda falta

Técnicas de Confronto por classe, Camuflagem do Espião, IA usando barricadas (deve ajudar a Engenharia), construções (Fortaleza, Acampamento, Igreja…), o triângulo de cores verde > roxo > laranja, arte e som.
