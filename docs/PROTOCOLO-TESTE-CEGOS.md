# Protocolo de teste com pessoas com deficiência visual

**Para quem conduz as sessões de teste do Projeto Íris em campo.**

Este documento diz o que testar, com quem, como conduzir e — a parte que
costuma faltar — qual resultado reprova a versão. Sem critério de reprovação
definido antes, toda sessão termina com "gostaram bastante", e é assim que se
publica um app que ninguém usa duas vezes.

---

## A regra que vem antes de todas

**O app é complemento à bengala e ao cão-guia. Nunca substituto.** Isso não é
disclaimer jurídico: é o desenho da sessão. Em nenhum teste a pessoa deve ser
levada a andar sem o recurso de mobilidade que ela usa todo dia. Um teste que
produz "o app funcionou mesmo sem bengala" não é um bom resultado — é um dado
sobre uma situação que nunca deve acontecer.

A primeira sessão com cada participante acontece em percurso **conhecido por
ela**. Percurso desconhecido só depois que ela já sabe como o app fala.

---

## Quem testa

Cinco perfis. Não são "tipos de usuário": são cinco conjuntos de exigências
diferentes, e um app que serve a um pode ser inútil para outro.

| Perfil | Quem | O que este perfil revela |
|---|---|---|
| **P1 — Bengala, cegueira congênita** | Cega de nascença, bengala longa, orientação e mobilidade formal, anda ~1,2 m/s | A bengala já encontra o chão à frente. Revela toda fala redundante: se o app diz o que a bengala acabou de dizer, é ruído puro |
| **P2 — Cão-guia** | Cegueira adquirida, cão-guia, anda ~1,5 m/s | O cão já desvia de obstáculo fixo. Revela se o app sabe calar sobre obstáculo e falar sobre **orientação** — rua, sentido, quanto falta |
| **P3 — Baixa visão** | Enxerga vulto e contraste, perde degrau e detalhe, ~1,0 m/s | Revela a interface visual: contraste, tamanho, o que a tela precisa mostrar. É o único perfil que usa a tela |
| **P4 — Cegueira adquirida recente** | Perdeu a visão há menos de dois anos, ainda em reabilitação, insegura | Revela o que o app assume que a pessoa já sabe. Vocabulário de orientação ("à sua esquerda", pontos cardeais) não é óbvio para quem está aprendendo |
| **P5 — Cegueira + perda auditiva parcial** | Idosa, cegueira adquirida, usa aparelho auditivo, ~0,8 m/s | Revela o orçamento real de fala. Cada frase compete com o trânsito pelo pouco que ela escuta |

**Mínimo para uma rodada válida: um participante de cada perfil.** Abaixo
disso, o resultado vale como impressão, não como validação — e precisa ser
relatado assim.

**Todo participante usa o leitor de tela dele.** VoiceOver ou TalkBack, na voz
e na velocidade que ele já configurou. Testar sem leitor de tela é testar outro
app, porque nenhum usuário cego real vai instalar e abrir o Íris sem um.

---

## Antes de começar

**Consentimento falado, não assinado.** O termo é lido em voz alta, inteiro, e
a pessoa responde gravada. Papel assinado por quem não leu o papel não é
consentimento. O termo precisa dizer, em palavras simples:

- que nenhuma imagem da câmera sai do aparelho;
- que o diário da sessão não contém imagem nem localização;
- que o registro de barreiras contém local aproximado e que **ela decide** se
  exporta;
- que ela pode parar a qualquer momento, sem dar motivo;
- quem fica com os dados e por quanto tempo.

**Configuração padrão, sempre.** A sessão começa com o app como ele sai da
caixa. Se o participante precisar mexer em ajustes para conseguir usar, isso é
um achado, não um preparo — anote qual ajuste e por quê.

**Um acompanhante de mobilidade por participante**, caminhando ao lado, sem
conduzir. Ele existe para a segurança física, não para ajudar com o app.

---

## Os seis roteiros

Cada roteiro tem uma pergunta, uma tarefa e um critério de reprovação. Faça na
ordem: eles vão do mais protegido ao mais exposto.

### R1 · Primeiro contato (interior, sentado)

**Pergunta:** a pessoa consegue iniciar o app sozinha, sem ninguém dizer onde
ficam os botões?

**Tarefa:** entregar o celular com o app aberto e pedir para começar a
percepção. Sem dicas. Cronometrar.

**Reprova se:** mais de 90 segundos até iniciar, ou se a pessoa não encontrar
algum dos três botões da barra inferior ao varrer a tela com o leitor.

> Este roteiro já encontrou um defeito real: dois dos três botões usavam
> `disabled`, e VoiceOver e TalkBack **pulam** controles desabilitados. A
> pessoa varria a barra inteira e achava só o botão do meio.

### R2 · Quem fala (interior, sentado)

**Pergunta:** o app e o leitor de tela se atrapalham?

**Tarefa:** com o leitor de tela ligado, navegar pelos ajustes enquanto o app
emite avisos. Depois, trocar "Quem fala" para "Meu leitor de tela" e repetir.

**Reprova se:** na configuração padrão, a pessoa não conseguir ouvir o rótulo
de um botão até o fim; ou se, no modo "leitor de tela", algum aviso de
obstáculo deixar de sair.

### R3 · Corredor conhecido (interior, andando)

**Pergunta:** a quantidade de fala é suportável?

**Tarefa:** percorrer 60 metros de corredor conhecido, com mobiliário nas
laterais e um obstáculo colocado no caminho (uma caixa, uma cadeira).

**Medir:** falas por minuto, frases repetidas, e a distância em que o
obstáculo foi anunciado.

**Reprova se:** mais de 12 falas por minuto; qualquer frase repetida mais de
três vezes; ou obstáculo anunciado a menos de 4 metros.

### R4 · Quadra urbana conhecida (externo)

**Pergunta:** o app orienta, ou só descreve?

**Tarefa:** uma quadra que o participante conhece, de ponta a ponta, sem
destino traçado.

**Perguntar ao final, nesta ordem:**
1. Em que rua você está? *(o app disse?)*
2. Para que lado você estava indo?
3. O que você ouviu que não precisava ter ouvido?
4. O que você precisava saber e o app não disse?

**Reprova se:** a pessoa não souber responder 1 ou 2. O app pode ter falado
muito e orientado nada — foi exatamente o que acontecia até a versão 0.13.

### R5 · Travessia (externo, com acompanhante atento)

**Pergunta:** o app induz a atravessar?

**Tarefa:** aproximar-se de uma travessia semaforizada e parar.

**Reprova imediatamente, e a versão inteira, se:** o app disser qualquer coisa
que possa ser entendida como permissão para atravessar. A frase correta é
sempre: *"Travessia bem à frente. Pare. Confirme o meio-fio com a bengala,
escute o trânsito e atravesse quando você julgar seguro."*

### R6 · Barreira e denúncia (externo)

**Pergunta:** a pessoa consegue relatar o que aconteceu com ela, de pé, no
meio da calçada?

**Tarefa:** encontrar uma barreira real do trajeto (calçada quebrada, tapume,
degrau) e registrá-la pela voz.

**Reprova se:** a pessoa precisar olhar ou procurar a tela para registrar, ou
se o relato não for confirmado em voz alta.

---

## O que medir, em todas as sessões

### Números

| Medida | Como obter | Alvo |
|---|---|---|
| Falas por minuto | diário da sessão | ≤ 12 (≤ 6 para P5) |
| Frases repetidas | diário da sessão | nenhuma mais de 3× |
| Distância do primeiro aviso de obstáculo no caminho | cronômetro + trena | ≥ 4 m |
| **Obstáculos que passaram sem aviso** | botão "Não avisou" | **é o número que manda** |
| Avisos falsos | botão "Avisou errado" | ≤ 1 por 10 min |
| Quadros por segundo | ajustes | ≥ 8 |
| Bateria em 30 min | antes/depois | ≤ 25% |
| Aquecimento | toque no aparelho | sem desconforto |

**"Não avisou" vale mais que todo o resto somado.** Um aviso falso irrita; um
obstáculo que passou batido derruba. Em toda análise, comece por ele.

### Perguntas, ao final de cada sessão

Gravadas, com as palavras da pessoa, sem reformular:

1. Teve alguma hora em que você **desligaria o som**, se estivesse sozinho?
2. Teve alguma hora em que você **não confiou** no que o app disse?
3. Alguma coisa que ele falou **atrapalhou** mais do que ajudou?
4. Se este app fosse seu amanhã, o que precisaria mudar antes?

A pergunta 1 é a mais importante do protocolo. Quem desliga o som por cansaço
perde junto o aviso que importava — e é a forma mais comum de este tipo de app
fracassar.

---

## Critério de publicação

Uma versão só vai a usuários fora do piloto quando, na rodada completa com os
cinco perfis:

- **nenhuma reprovação em R5** (travessia) — este é eliminatório e sozinho;
- nenhum perfil acima do orçamento de fala;
- nenhum "Não avisou" em obstáculo a menos de 2 metros no caminho;
- todos os cinco participantes conseguiram iniciar o app sozinhos (R1);
- a pergunta 1 ("desligaria o som?") respondida com "não" por pelo menos
  quatro dos cinco.

Faltando qualquer um, a versão volta. E o relatório diz **qual** faltou — não
"precisa de ajustes".

---

## Relatório da rodada

Um arquivo por rodada, com:

1. perfis dos participantes (sem nomes), data, local, clima e horário;
2. os diários exportados (`iris-*.json`), um por sessão;
3. os números da tabela acima, por participante;
4. as respostas às quatro perguntas, transcritas;
5. **a lista de defeitos encontrados, cada um com o roteiro em que apareceu**;
6. a decisão: publica ou volta, e por quê.

Os diários não contêm imagem nem localização — podem ser anexados como estão.
O registro de barreiras é separado, e só entra no relatório se o participante
tiver exportado por vontade própria.

---

## O que este protocolo não cobre

- **Surdocegueira.** O app é inteiramente sonoro; para quem não ouve, ele hoje
  não serve. Saída possível (não implementada): vibração codificada e saída em
  braile por display conectado. Enquanto não existir, dizer isso em voz alta é
  mais honesto do que incluir o perfil e reprovar sempre.
- **Deficiência visual associada a deficiência motora.** Cadeira de rodas muda
  a altura da câmera, a velocidade e o que conta como obstáculo. Precisa de
  protocolo próprio.
- **Chuva e noite.** O teste de rua de 7/11/2026, à noite, produziu um erro de
  classificação que não aparece de dia. Noite e chuva precisam de rodada
  própria, não de "repetir o mesmo roteiro mais tarde".
