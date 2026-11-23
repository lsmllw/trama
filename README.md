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
| Ala | Leve | 5 | 5 | 5 | 6 | 3 | 2 | **Pedalada**: +1 Leitura no próximo Duelo, fintas grátis |
| Pivô | Pesado | 3 | 4 | 4 | 2 | 5 | 2 | **Bomba**: chute com +2 de força |

## Regras

- **Fases:** você joga com os 5 (na ordem que quiser), depois a IA. 8 rodadas por tempo, 2 tempos.
- **Cada jogador:** anda e depois age uma vez — passar, chutar, driblar ou desarmar. Arrancada: +2 casas por 2 de fôlego.
- **Marcação:** quem está com a bola para ao encostar num adversário; dali só sai no drible.
- **Passe rasteiro** (alcance = PAS) é cortado por quem estiver perto da linha. **Passe alto** (PAS + 2) passa por cima, mas a recepção vira bola dividida mais fácil.
- **Duelo** (drible, desarme, carrinho, dividida): 3 tempos. Arrancada/Bote vence Finta · Proteger/Fechar vence Arrancada/Bote · Finta vence Proteger e quem espera. Quem tem a bola fica com ela no empate. Bote contra quem protege é falta.
- **Chute:** você escolhe o canto, o goleiro escolhe o lado. Diferença de 3 entre força e reflexo deixa o melhor ler o outro.
- **Faltas:** a partir da 6ª do time no tempo, tiro livre direto do 10 m, sem barreira.
- **Energético:** de vez em quando a torcida joga uma garrafa numa casa livre. Quem passa por ela guarda (uma por jogador) e toma quando quiser na vez dele (**G**): fôlego e HAB cheios e +2 casas de movimento, sem gastar a ação. A garrafa fica 3 rodadas e pisca na última antes de sumir.
- **4 segundos:** o goleiro com a bola precisa soltá-la na fase seguinte.

## Controles

- **1–5** ou **Tab**: escolher jogador · **clique / Espaço**: andar, passar, driblar, desarmar
- **C** chutar · **B** bomba · **A** passe alto · **R** arrancada · **H** especial
- Escolhendo o destino ou o alvo, a câmera aproxima e segue o mouse ou o cursor do teclado. Parar o mouse num jogador (na quadra ou no cartão) abre a ficha dele. Ao lado de cada nome, o símbolo da posição: ◆ goleiro, ■ fixo, ▲ ala, ● pivô.
- **Z** terminar jogador · **E** encerrar fase · **X** desfazer / voltar · roda do mouse = zoom · **0** centraliza
- **Duelo na quadra:** a câmera fecha nos dois e os lances aparecem ao lado do seu jogador: **1–4** ou **↑↓ + Espaço**, **L** leitura. No chute: **1–3** canto.
- Quando o último jogador do time anda e não tem mais o que fazer, a fase passa sozinha para o adversário.
