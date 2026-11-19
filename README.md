# Trama: protótipo jogável

Protótipo jogável no navegador de um jogo de ação tática em fantasia steampunk inspirado em FF Tactics e Fire Emblem. Uma partida é Azul (você) contra Vermelho (máquina), com 5 unidades de cada lado, no mapa "Vau do Prisma" (20×20), em vista 2.5D: o tabuleiro aparece girado, com a sua Base perto da ponta esquerda e a inimiga na ponta oposta, e um rio atravessando o meio.

O objetivo é responder uma pergunta: **o Confronto é divertido?** Por isso ainda não há arte final (as unidades são peças coloridas em pé) nem construções.

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
  - **O peso define os lances.** Lance acima de 3 vira **Leitura** (ver o lance do inimigo antes de escolher).
- **Lados e direção:** ninguém vira à mão. No fim da fase do seu time, cada unidade encara o inimigo mais próximo (a setinha da peça mostra para onde); quem é atacado num Confronto se vira para o atacante. Dá para atacar por qualquer lado, mas o lado conta:
  - Flanco: dano ×1,25. Costas: dano ×1,5 (vale no corpo a corpo e no tiro direto).
  - Os leves (Espadachim, Morteiro, Bombardeiro, Médico, Espião) ainda ganham Leituras: 1 pelo flanco, 2 pelas costas.
  - Especialidades: Cavaleiro ×1,6 no flanco e ×1,7 nas costas; Espião ×2 nas costas; o escudo do Tank corta 25% do dano pela frente; o Blindado leva +15% pelo flanco e +30% pela traseira.
  - O alcance de cada classe continua: Atirador e artilharia não atacam colados, o Canhão não atira depois de andar.
- **Prévia de dano:** ao escolher onde andar, uma etiqueta sobre cada inimigo atacável mostra o dano que você causaria daquela casa e por qual lado (corpo a corpo: por acerto ×1 no Confronto; tiro e Base: dano exato). Parado sobre o alvo, a dica embaixo do tabuleiro detalha.
  - Quem perde para uma Finta fica **Exposto**: no tempo seguinte, escolhe primeiro e o outro vê.
- **Prontidão (!):** quem não agiu na ativação ganha +1 lance ao defender.
- **Stamina** (barra amarela): lances, Correr e Cura gastam; volta 3 por rodada. Com 0, a unidade fica Exausta.
- **Morteiro:** marca uma cruz de 5 casas e o disparo cai no começo da próxima fase de quem atirou (o inimigo tem a fase dele para sair). **Granada:** explode na hora. Os dois atingem aliados.
- **Level e XP:** acertar ou vencer um Confronto dá 1 XP, abater dá 2, coletar ou curar dá 1. Level 2 com 3 XP (até o 5). Cada level dá +3 HP máximo e +1 ATQ. A peça, o card e o brilho da casa da unidade ficam mais fortes a cada level.
- **Habilidades:** uma por classe, liberada no level 2, paga com Stamina. Avanço, Tiro certeiro, Provocar, Investida, Atropelar, Fumaça, Perfurante, Mina, Reparo, Barricada, Cura em área e Furtar.
- **Itens:** coletados nos nós de cor (cada nó tem 3 cargas e recupera 1 por rodada). Verde dá Tônico (+12 HP), laranja dá Óleo de combate (+3 ATQ no próximo ataque), roxo dá Elixir de foco (+1 lance no próximo Confronto e +4 Stamina). Os cristais prismáticos (que começam na Fonte, no centro) dão qualquer um. Cada unidade carrega até 2.
- **Cristais que mudam de lugar:** a cada 3 rodadas, todos os cristais afundam num wormhole e reaparecem em outras casas de planície sorteadas, levando as cargas. Cada par espelhado continua espelhado (o mapa é simétrico) e nenhum cai perto das Bases. A barra de cima mostra quantas rodadas faltam.
- **Base:** 60 HP; no fim de cada rodada acerta 5 em cada inimigo encostado nela.
- **Blindado:** anda só 3 casas e só em terreno liso (não entra em floresta, colina, ruína, lama nem barricada).
- **Bombardeiro, o contra do Blindado:** planta minas desde o level 1 (até 3 ativas). Mina causa 8; num Blindado, 16 e ele fica imobilizado na fase seguinte. A granada dele ignora a armadura do Blindado.

### Controles

| Ação | Mouse | Teclado |
| --- | --- | --- |
| Selecionar unidade (a câmera centraliza e fica presa nela) | clique no tabuleiro ou no card da barra de baixo | 1 a 5 |
| Confirmar (encerrar a unidade); a câmera fica parada onde estava | botão | Z (ou Enter; Espaço com o cursor na própria unidade) |
| Voltar (sair da mira, desfazer o movimento, desmarcar) e soltar a câmera | botão Desfazer | X (ou Esc) |
| Ver informações da unidade | passar o mouse sobre ela ou sobre o card | — |
| Zoom | roda do mouse | — |
| Mover a câmera | sem unidade selecionada (e durante toda a fase da IA): com zoom, segue o cursor; sem zoom, o tabuleiro só se mexe de leve sobre o fundo | — |
| Câmera ao escolher o movimento | com a unidade selecionada e as casas de movimento abertas, desliza suavemente para o lado em que o mouse está | desliza até centralizar a casa do cursor (setas) |
| Voltar à visão inteira | — | 0 ou Home |
| Mover / atacar / curar | clique na casa azul / vermelha / verde | setas movem o cursor só pelas casas válidas (alcance de movimento, alvos ou mira; pulam buracos), Espaço confirma a casa |
| Mirar morteiro ou granada | botão Mirar | M |
| Habilidade | botão da habilidade | H |
| Coletar / usar item | botões no painel | — |
| Encerrar a fase | botão | E |
| Correr (+2 casas, 2 ST) | botão | R |
| Lances no Confronto | botões | 1 Golpe · 2 Guarda · 3 Finta · 4 Esperar · L Leitura · Z fecha |

## Estrutura

```
src/core/      regras puras, sem tela (determinísticas, com semente)
  data.ts        classes, pesos, terrenos, constantes de balanceamento
  map.ts         mapa "Vau do Prisma" em texto (gerado por tools/genmap.py)
  grid.ts        movimento (Dijkstra), linha de visão, flanco
  combat.ts      dano, área, vitória
  confronto.ts   o Confronto: lances, matriz, Exposição, Leitura
  game.ts        criação da partida, fases, ações, coleta, itens, fim de rodada
  abilities.ts   as 12 habilidades de classe
  ai.ts          IA de utilidade (inclui itens e habilidades) + IA de lances + simulação
src/ui/        canvas 2.5D com câmera e fundo (renderer.ts), símbolos das classes (icons.ts), painéis,
               barra de unidades, janela do Confronto, seleção de time
tools/         genmap.py: gera e confere o mapa (simetria, caminhos, casas iniciais)
tests/         testes das regras (Vitest)
scripts/       simulação IA × IA
```

O núcleo não conhece a tela: a mesma lógica roda no navegador, nos testes e na simulação.

## Balanceamento (`npm run balance`, IA Veterano × Veterano, mapa 20×20)

Taxa de vitória dos times que tinham cada classe (1500 partidas com times sorteados). A faixa saudável é 45% a 55%.

| Classe | No início | Lados por Leitura | Agora (lados por dano) |
| --- | --- | --- | --- |
| Blindado | 66,8% | 54% | 57% |
| Cavaleiro | 60,0% | 55% | 50% |
| Atirador | 55,4% | 55% | 53% |
| Espadachim | — | 47% | 50% |
| Bombardeiro | 46,9% | 54% | 52% |
| Morteiro | 39,8% | 41% | 43% |
| Espião | 41,9% | 44% | 50% |
| Canhão | 48,2% | 46% | 45% |

Arquétipos (8 times fixos, cada par jogando dos dois lados): o time com dois Blindados caiu de **91% para cerca de 61%**, e o Antiblindado (dois Bombardeiros) vence os Blindados em 57% dos confrontos diretos. O mais fraco continua a Artilharia (~28%): o mapa tem muita floresta, que dá cobertura contra tiros.

Na troca de Leituras por dano, só o dano deixava os leves fracos (Infiltração, com dois Espiões, caía para 13%) e o Blindado forte demais. Por isso os leves mantêm as Leituras de lado e a traseira do Blindado ficou vulnerável (comparação em `npm run tune`).

O que mudou para chegar aqui:

- **Flanco e costas dão Leitura em vez de lances.** Era a causa principal: o Blindado atacava pelo flanco ou pelas costas em 98% dos Confrontos e ganhava até 3 lances com força ×1,6.
- **IA com mapa de perigo:** ela sabe quais casas o inimigo alcança na fase seguinte e evita terminar onde pode morrer. Essa cautela diminui com as rodadas, para a partida não travar.
- Blindado com MOV 3 e só terreno liso; minas e granada antitanque do Bombardeiro. No mapa novo, o Blindado só cruza o rio pela Fonte, o melhor lugar para minas.
- Números: Atirador ATQ 5, Cavaleiro ATQ 7, Canhão ATQ 9, Morteiro ATQ 8 e área ×2,2, Mecânico ATQ 6, Construtor ATQ 7, Espião ATQ 8 e HP 20; Reparo do Mecânico vale para qualquer aliado.

As partidas duram cerca de 15 rodadas; ~78% terminam por eliminação ou Base destruída, o resto por pontos na rodada 20.

## O que ainda falta

Técnicas de Confronto por classe, Camuflagem do Espião, IA usando barricadas (deve ajudar a Engenharia), construções (Fortaleza, Acampamento, Igreja…), o triângulo de cores verde > roxo > laranja, arte e som.
