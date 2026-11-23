# Trama Futsal: protótipo jogável

Futsal tático por turnos em pixel art, no navegador. Você comanda o **Azul**; a máquina comanda o **Vermelho**. A mecânica vem do Trama tático (fases por time, mover e agir, Confronto em 3 tempos), agora numa quadra 2.5D de 20×10 casas (1 casa = 2 m).

> O jogo tático steampunk original continua na branch `main`.

## Rodar

```bash
git fetch
git checkout futsal
npm install
npm run dev        # abre em http://localhost:5173
npm run build      # gera dist/index.html, um arquivo só que abre direto no navegador
npm test           # testes das regras
npm run sim -- 200 veterano   # partidas IA × IA, com estatísticas
```

## Elencos

| Azul | | Vermelho | |
|---|---|---|---|
| #1 Gui | Goleiro | #12 Biel | Goleiro |
| #4 Rafa | Fixo | #3 Tonhão | Fixo |
| #7 Dudu | Ala | #10 Pity | Ala |
| #11 Teco | Ala | #8 Lelo | Ala |
| #9 Marreta | Pivô | #5 Bigode | Pivô |

## Posições (classes)

| | Peso | MOV | PAS | DOM | HAB | FIN | MAR | Especial (1× por tempo) |
|---|---|---|---|---|---|---|---|---|
| Goleiro | Médio | 3 | 6 | 3 | 2 | 1 | 3 | **Muralha**: reflexo +2 até a próxima fase |
| Fixo | Pesado | 3 | 7 | 3 | 2 | 3 | 5 | **Carrinho**: desarma a 2 casas, +1 lance |
| Ala | Leve | 5 | 5 | 5 | 6 | 3 | 3 | **Pedalada**: +1 Leitura no próximo Duelo, fintas grátis |
| Pivô | Pesado | 3 | 4 | 4 | 2 | 5 | 3 | **Bomba**: chute com +2 de força |

## Regras

- **Fases:** você joga, depois a IA. Com a bola no começo da fase, o time ativa os 5; sem ela, só 3. 6 rodadas por tempo, 2 tempos.
- **Prontidão:** quem não foi ativado fica de prontidão para a fase do adversário: corta passe rasteiro a até 2 casas da linha (os outros, a 1) e dá **bote automático** em quem parar colado nele com a bola (+1 lance). Na sua vez, as casas laranja mostram onde isso acontece. Quem fica de prontidão também recupera mais fôlego.
- **Cada jogador:** anda e depois age uma vez — passar, chutar, driblar ou desarmar. Arrancada: +2 casas por 3 de fôlego. Com menos de 2 de fôlego, o jogador está cansado (−1 lance nos Duelos).
- **Marcação:** quem está com a bola para ao encostar num adversário; dali só sai no drible. Cada time só desarma uma vez por fase.
- **Passe rasteiro** (alcance = PAS) é cortado por quem estiver perto da linha. **Passe alto** (PAS + 1) passa por cima, mas custa 1 de fôlego, qualquer defensor a 2 casas do recebedor disputa a bola e quem recebe não chuta nem dribla na mesma fase.
- **Duelo** (drible, desarme, carrinho, dividida, bote): 3 tempos. Os lances vêm da diferença entre o Domínio de quem tem a bola e a Marcação de quem marca (3, 2 ou 1). Arrancada/Bote vence Finta · Proteger/Fechar vence Arrancada/Bote · Finta vence Proteger e quem espera. Esperar recupera 1 de fôlego e dá uma Leitura no tempo seguinte. Quem tem a bola fica com ela no empate. Bote contra quem protege é falta. Ao mirar um drible ou desarme, a dica já mostra as chances aproximadas.
- **Chute:** sem palpite de canto. A chance (no botão) vem da força contra o reflexo, da distância, do ângulo e de onde está o goleiro; um defensor na linha do chute corta a chance. A defesa às vezes dá **rebote** para quem estiver perto da área.
- **Faltas:** a partir da 4ª do time no tempo, tiro livre direto do 10 m, sem barreira — esse ainda é no palpite: você escolhe o canto e o goleiro, o lado.
- **Energético:** de vez em quando a torcida joga uma garrafa numa casa livre. Quem passa por ela guarda (uma por jogador) e toma quando quiser na vez dele (**G**): fôlego e HAB cheios e +2 casas de movimento, sem gastar a ação. A garrafa fica 3 rodadas e pisca na última antes de sumir.
- **4 segundos:** o goleiro com a bola precisa soltá-la na fase seguinte.
- **Plano de jogo:** antes da partida cada time escolhe um estilo, às cegas; os dois aparecem no apito inicial e podem ser trocados no intervalo.
  - **Pressão alta:** sem a bola ativa 4 e desarma 2 vezes por fase; quem joga sem a bola gasta 2 de fôlego a mais e só 1 fica de prontidão.
  - **Posse de bola:** toque curto (até 3 casas) só é cortado por quem está em cima da linha e não sofre bote com bônus; cada fase seguida com a bola dá +1 de força no chute (até +2). Passe alto custa 2 de fôlego e chute de longe perde 1 de força.
  - **Bloco baixo:** sem a bola ativa só 2, mas a prontidão corta a 3 casas e o bote no próprio campo ganha +1; no próprio campo nunca é pego fora de posição.
  - **Contra-ataque:** na fase depois de recuperar a bola, quem não estava de prontidão do outro lado fica fora de posição (não corta passe nem segura quem tem a bola), todos andam +1 e o 1º passe alto é livre; com a bola por mais de 2 fases seguidas, ativa só 4.
  - **Equilíbrio:** sem vantagem nem fraqueza de estilo.
  - Ciclo pretendido: Pressão > Posse > Bloco > Contra > Pressão. `npx tsx scripts/study.ts veterano:pressao veterano:posse 40 1 saida.json` mede um confronto.
- **Dificuldade:** Recruta joga o óbvio; Veterano pesa riscos e guarda prontidão; Craque testa as jogadas até o fim da fase e lê seus hábitos nos Duelos.

## Controles

- **1–5** ou **Tab**: escolher jogador · **clique / Espaço**: andar, passar, driblar, desarmar
- **C** chutar · **B** bomba · **A** passe alto · **R** arrancada · **H** especial
- Escolhendo o destino ou o alvo, a câmera aproxima e segue o mouse ou o cursor do teclado. Parar o mouse num jogador (na quadra ou no cartão) abre a ficha dele. Ao lado de cada nome, o símbolo da posição: ◆ goleiro, ■ fixo, ▲ ala, ● pivô.
- **Z** terminar jogador · **E** encerrar fase · **X** desfazer / voltar · roda do mouse = zoom · **0** centraliza
- **Duelo na quadra:** a câmera fecha nos dois e os lances aparecem ao lado do seu jogador: **1–4** ou **↑↓ + Espaço**, **L** leitura. No tiro livre direto: **1–3** canto.
- Quando o último jogador do time anda e não tem mais o que fazer, a fase passa sozinha para o adversário.
