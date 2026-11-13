# Projeto ÍRIS — PWA

**Percepção Inteligente. Mais Autonomia. Mais Segurança.**

Assistente visual que roda no navegador do celular (iPhone e Android), instalável na tela de
início e funcional sem internet depois do primeiro uso. Todo o processamento acontece **no
próprio aparelho**: nenhuma imagem da câmera sai dele.

> Complemento à bengala e ao cão-guia, **nunca substituto**.

---

## O que o app faz

| Recurso | Modelo | Observação |
|---|---|---|
| Objetos (pessoa, carro, cadeira, semáforo…) | EfficientDet-Lite0 (COCO, 80 classes) | via MediaPipe |
| **Distância em metros** | prior de tamanho real por classe | ver ressalva abaixo |
| **Aproximação** (o que vem na sua direção) | variação da distância entre quadros | evita alarme com carro estacionado |
| **Cor do semáforo** | análise de matiz + posição da lâmpada | diz a cor, **não** manda atravessar |
| **Calçada, via, caminho** | SegFormer-B0 / ADE20K | segmentação, ~4 MB |
| **Degrau, escada, poste, corrimão** | SegFormer-B0 / ADE20K | o detector de objetos não vê nenhum |
| **Leitura de texto** (placas, letreiros) | Tesseract.js, português | ~7 MB no primeiro uso |
| **Objeto pontiagudo junto a pessoa** | COCO (`knife`, `scissors`, `baseball bat`) | linguagem hedgeada, ver ressalva |
| Descrição da cena | lógica própria | botão "O que tem aqui?" |
| **Navegação a pé** | Google Maps, com OpenStreetMap de reserva | esquinas, metros e passos; ver ressalva |
| **Vocabulário aberto** | OWL-ViT, via transformers.js | buraco, degrau, tapume, piso tátil: 30 tipos que o COCO não tem |
| **Descrição detalhada** | modelo de visão-linguagem, por proxy | **opcional, desligada**, envia uma foto |
| **Onde estou?** | GPS + bússola + Nominatim + Overpass (OSM) | rua, rumo, referências com lado e passos, depois a câmera |
| **Lugares familiares** | MobileNet-V3 (embeddings) + vizinhos mais próximos | aprende no aparelho com 8 quadros; guarda só vetores |
| Diário do piloto | local, em JSON | para a validação com usuários |

### O que ainda **não** faz

**Arma de fogo: só "possível", só confirmada, e só com o reconhecimento ampliado ligado.**
O COCO não tem classe de arma. Com Ajustes → "Reconhecimento ampliado", cada varredura inclui
uma consulta de arma ao OWL-ViT; uma detecção isolada **não é falada** — o app pede na hora uma
segunda olhada e só fala se as duas concordarem: *"Atenção. Possível arma de fogo com uma pessoa
à frente, a quatro metros. Se puder, afaste-se com calma, sem correr."* O OWL-ViT confunde arma
com celular e furadeira, e varre a cada 9 s, não a cada quadro. O caminho certo é o detector
treinado: a classe `arma_de_fogo` já está em [`treino/classes.yaml`](treino/classes.yaml), com a
precisão mínima mais alta da lista (0,95). Faca, tesoura e taco seguem como "objeto pontiagudo".

**Buraco só é detectado com o reconhecimento ampliado ligado**, e com ressalva. O COCO
e o ADE20K não têm a classe. O vocabulário aberto (Ajustes → "Reconhecimento ampliado")
procura por buraco, bueiro aberto, degrau, tapume e mais 26 tipos usando descrição em
texto, sem treino — mas leva de 1 a 4 segundos por varredura, então **não roda a cada
quadro**: roda quando você pede a descrição e, durante a navegação, a cada 9 segundos.
Ele erra mais que o detector rápido. Um detector próprio, treinado, é o caminho certo, e
o pipeline para treiná-lo está em [`treino/`](treino/).

---

## Ressalvas honestas

**A distância é estimada, não medida.** Ela vem do tamanho aparente do objeto comparado
à altura típica da classe (pessoa ≈ 1,70 m, carro ≈ 1,50 m). Objeto cortado pela borda do
quadro, classe fora do padrão (criança, caminhonete alta) ou câmera inclinada degradam a
estimativa. Quando a caixa toca a borda, o cálculo puxa para **mais perto**, porque errar
para longe é o erro perigoso. Medição real exigiria modelo de profundidade.

**A cor do semáforo é informativa, nunca permissiva.** A câmera não sabe se está vendo o
semáforo de pedestre ou o dos veículos. O app diz "semáforo verde à frente" e para por aí.

**A navegação nunca manda atravessar.** Ao chegar numa travessia o app diz: *"Travessia
bem à frente. Pare. Confirme o meio-fio com a bengala, escute o trânsito e atravesse
quando você julgar seguro."* Ele não sabe se há carro vindo, e um erro aqui mata.

**Sem bússola, o app não diz esquerda nem direita.** Um pedestre parado pode estar virado
para qualquer lado; "vire à direita" dito sem saber o rumo dela manda a pessoa para a rua.
Quando não há bússola nem movimento, o app fala em pontos cardeais ("siga para o norte") e
avisa que não sabe o rumo. É menos confortável e nunca aponta para o lado errado.

**O GPS urbano erra de 5 a 20 metros** — a largura de uma via. Por isso a manobra é
avisada a 25 m e repetida a 8 m, e o app só recalcula depois de três leituras seguidas
fora da rota: uma leitura só é quase sempre o sinal pulando entre prédios.

---

---

## Onde estou? (0.10)

Antes de guiar, situar. O botão **Onde estou?** diz a rua e o número aproximado, a confiança do
GPS, para que lado a pessoa está virada e as referências em volta (ponto de ônibus, faixa com piso
tátil, farmácia…) com lado e distância. Com a câmera ligada, emenda a descrição do que está à
frente numa fala só. Sem bússola, usa pontos cardeais e diz isso.

**Lugares familiares**: em Ajustes, dê um nome e toque em "Memorizar este lugar pela câmera". O app
aprende com 8 quadros (vetores do MobileNet-V3, nunca a foto) e passa a dizer "Este lugar parece ser
a cozinha" — inclusive onde não há GPS. Lugar memorizado com GPS bom vira destino: "Ir para casa".

**A segunda pergunta não repete a primeira.** Quem toca de novo em poucos minutos ouve só o que
mudou: "Você continua no mesmo ponto. Agora virado para o leste. Perto de você: faixa de pedestre,
à sua esquerda…".

Arquitetura, decisões e próximas etapas de ML: [`docs/ROTEIRO-ML.md`](docs/ROTEIRO-ML.md).

### Orientar, não repetir (0.10)

- **Antes de sair**, parada e virada para o lado errado, a pessoa ouve *"Antes de sair, vire à
  direita, devagar, até eu dizer: isso."* e, quando acerta, *"Isso. Agora siga em frente."*
- **Em trecho longo**, o silêncio de minutos virou confirmação curta e variada, sempre com o que
  falta: *"Caminho certo. Faltam 120 metros até a Avenida Getúlio Vargas."*
- **Saiu do caminho**: além de constatar, diz para que lado a rota ficou — *"A rota fica atrás de
  você, a uns 35 metros."* (Esta frase não chegava a ser falada no app: corrigido.)
- **Recálculo** não repete a abertura inteira: *"Nova rota, 140 metros no total. Siga…"*
- **Alertas**: "Pessoa à frente, a dois metros e meio" seguido de "Atenção, pessoa à frente, a
  dois metros e meio" no mesmo segundo virou uma frase só; objeto parado à mesma distância não
  repete a cada 3 s; e a narração não anuncia o que o alerta vai anunciar logo depois.

## Conversa por voz (0.13)

Botão largo **Conversar**: toque uma vez e a conversa começa. Depois de cada resposta o
microfone **reabre sozinho** — não é preciso tocar de novo para fazer a pergunta seguinte.
Para encerrar: toque no botão outra vez, ou fale "pode parar", "chega", "obrigado", "tchau".

O botão tem três estados, e cada um tem rótulo próprio, porque quem não enxerga não vê a cor
mudar: **Conversar** (parado), **Ouvindo… fale agora**, **Um instante…** (a resposta está vindo).

Enquanto a conversa está aberta, a narração do ambiente cala: ela atropelaria a resposta e
entraria no microfone aberto virando pergunta. **O alerta de obstáculo continua passando** — a
conversa não custa a segurança de quem está andando.

**Por que o modo conversa existe (0.13).** No teste de campo de 7 de novembro de 2026 o botão
ficou preso em "Ouvindo… fale agora" e não voltava mais. A causa está em `posicao.js`: o
reconhecimento do navegador nem sempre dispara `onend` — no iPhone a síntese de voz do próprio
app toma a sessão de áudio e o evento se perde. Sem `onend`, o app continuava achando que
estava ouvindo, para sempre. Agora `ouvirFala` tem cão de guarda de 12 s, encerramento
idempotente (roda uma vez só, venha de onde vier) e `cancelar()` que usa `abort()`, não
`stop()`. A conversa também fecha ao trocar de aba ou bloquear a tela, e dois silêncios
seguidos a encerram em vez de deixar o microfone aberto.

Duas camadas:

**Comandos, resolvidos no aparelho, sem internet e sem mandar imagem** (`conversa.js`):
"onde eu estou?", "o que tem na minha frente?", "lê isso pra mim", "me leva até a farmácia",
"parar rota", "repete", "quais são os comandos?", "socorro".

**Perguntas livres, respondidas pela IA de visão** — só com a descrição detalhada ligada (o mesmo
consentimento falado): "essa nota é de quanto?", "tem cadeira livre?", "qual a validade desse
remédio?", "a porta está aberta?". Vai uma foto, a do instante da pergunta. A conversa tem
memória curta, só em texto (seis turnos, três minutos), para valer "e a outra?" — as fotos
anteriores não são reenviadas. O proxy ganhou a rota `/conversar`, com prompt próprio: responde
o que foi perguntado em até três frases, orienta a câmera quando a resposta não está no quadro
("gire o produto devagar"), lê remédio sem recomendar dose e mantém os limites da descrição
(nunca "pode atravessar", nada de identificar pessoas ou atribuir intenção).

Sem a descrição detalhada, uma pergunta livre cai para a descrição do aparelho e o app diz isso.
O reconhecimento de fala é o do navegador: no Android (Chrome) costuma precisar de internet; no
iPhone, depende da versão do Safari.

O prompt do `/conversar` foi reescrito na 0.13 para ser conversa, não formulário: sem
cumprimento repetido, sem "claro" antes de responder, sem oferecer ajuda no fim (o microfone já
reabre sozinho), e com o fio sempre na orientação — onde a pessoa está, o que tem em volta, por
onde dá para andar. Como a pessoa pode estar andando entre um turno e outro, o prompt manda
descrever a foto de agora e avisar quando algo que foi citado antes saiu de cena.

**Custo:** cada turno da conversa manda uma foto ao modelo. Uma conversa de dez turnos são dez
chamadas. O limite do proxy é de 20 por minuto por IP (`LIMITE` em `servidor/proxy-descricao.mjs`).

## Orientação contínua (0.14)

Até a 0.13 o app só dizia onde a pessoa estava quando ela apertava **Onde
estou?**. Andando, ela ouvia inventário de objetos e mais nada. Medido no
simulador: noventa segundos de calçada rendiam **55 falas, 36 delas com
prefixo de alarme** — e nenhuma dizia a rua, o sentido ou quanto faltava.

Agora existe um canal próprio, `Canal.ORIENTACAO`, abaixo de tudo menos da
narração de ambiente. Ele nunca interrompe, espera a voz vagar, e prefere
calar a repetir:

- a primeira, completa: *"Você está na Rua Barão de Melgaço, indo para o
  leste. Caminho livre à frente. Faltam 310 metros até Farmácia Central."*
- mudou de rua: sai na hora, furando o intervalo — é a informação mais útil
  que existe para quem não enxerga;
- as seguintes: curtas e em rodízio, a cada 40 s andando, 90 s parado.

**"Caminho livre" só é dito com a câmera entregando quadros.** Sem ver, o app
devolve `null` e cala: afirmar que o caminho está livre sem estar olhando é o
tipo de frase que derruba quem confia nela.

O nome da rua vem do Nominatim, reconsultado só depois de 40 m andados, e uma
falha de rede nunca apaga a rua que a pessoa já está usando para se situar.

Regras em `orientar.js`, sem dependência de navegador: `node --test
test/orientar.test.mjs`.

## Por que o app repetia tanto (0.14)

O teste de rua de 7/11 e o simulador mostraram a mesma coisa: andar por uma
quadra com carros estacionados produzia *"Cuidado, carro à direita"* sem
parar. Eram **cinco defeitos somados**, não um:

1. **O app não sabia que quem andava era ele.** Caminhando a 1,2 m/s por
   carros parados, todos "se aproximavam" a 1,2 m/s → prioridade ALTA →
   prefixo "Cuidado". Agora o `MotionTracker` desconta o próprio passo: pelo
   GPS (`velocidadeMs`, que o app já tinha e não usava) ou, sem GPS, pela
   mediana do fechamento de postes, bancos e hidrantes — coisas que não andam
   sozinhas (`IMOVEIS`).

2. **O freio de repetição comparava a frase inteira, com a distância dentro.**
   Cada meio metro gerava frase nova, e o freio nunca pegava. Agora o que
   reabre a fala é mudar de FAIXA de proximidade — e só para o que está no
   caminho ou vindo.

3. **Gravidade e cadência estavam misturadas.** Prioridade ALTA dava direito
   a insistir a cada 6 s. Prioridade decide a urgência da primeira menção, não
   de quanto em quanto se insiste.

4. **A chave do rastreio colidia.** Seis carros à direita dividiam a chave
   `car|à direita`: cada quadro gravava a distância de um e comparava com a de
   outro. Agora só o mais próximo de cada chave carrega o histórico.

5. **O limiar de aproximação estava abaixo do piso de ruído.** A distância sai
   da altura da caixa; 6% de erro na caixa a 7 m já vale meio metro, que entre
   duas amostras vira mais de 1 m/s de "velocidade" com tudo parado. Medido:
   carros parados fechando a 1,8–6,0 m/s contra um limiar de 0,45. Subiu para
   0,9 m/s, com mediana de 2 s — ainda muito abaixo de uma pessoa vindo de
   frente (~2,4 m/s) ou de um veículo (>4).

Mais dois ajustes de apoio:

- **Marcação constante.** O teste que marinheiro e piloto usam: o que vai te
  acertar permanece na mesma direção; aquilo por que você passa escorrega
  para a borda do quadro. Objeto de lado que se afasta do centro deixa de
  contar como obstáculo no caminho.
- **`inPath` exigia só encostar no corredor.** Qualquer objeto largo perto da
  borda passava. Agora precisa atravancar de verdade.

**Resultado medido** (90 s, mesma quadra, mesmo ruído):

| | falas | com "Cuidado"/"Atenção" |
|---|---|---|
| antes | 55 | 36 |
| depois | 37 | 7 |

Reproduzir: `node test/simular.mjs` e `node --test "test/*.test.mjs"`.

## Segunda visão: o que parou de piscar (0.15)

A 0.14 cortou a repetição *literal*. A 0.15 foi atrás do que sobrava, e o que
sobrava eram quatro defeitos diferentes com o mesmo sintoma para quem ouve:
"o app descreve a mesma coisa várias vezes e os avisos ficam indo e vindo".

**1. Histerese, em `estavel.js`.** `analyzeSpatial` decide tudo quadro a
quadro, com limites secos: direção pelo centro da caixa em 0,35 e 0,65, faixa
de distância em 2,5 m e 8,0 m. Um poste a 2,5 m não fica parado no número — a
caixa treme, e ele alterna PERTO/MÉDIO várias vezes por segundo; um carro com
o centro perto de 0,65 é "à frente" num quadro e "à direita" no seguinte.

Como o freio de repetição é indexado por `classe|direção`, trocar de direção
criava chave nova e o **mesmo poste era anunciado duas vezes, com dois lados
diferentes**. Não é informação a mais: é a direção — o dado com que a pessoa
desvia — sendo destruída.

Agora trocar de estado custa mais do que permanecer nele, e a margem é
**assimétrica a favor da segurança**: aproximar vale no limite seco, na hora;
afastar exige passar da margem.

**2. Marcação constante, não "já se afastou".** O app dizia reconhecer quando
você está só passando por um objeto, mas media a coisa errada: perguntava se a
distância já tinha começado a aumentar — o que, num carro estacionado,
acontece quando ele já ficou para trás. Até lá ele era "obstáculo perto no seu
caminho", com direito a "Atenção". Agora vale o teste que marinheiro e piloto
usam: o que vai te acertar permanece na mesma direção, o que você vai passar
escorrega para a borda do quadro.

**3. O corredor passou a ser medido em metros.** "No meu caminho" era posição
na imagem — um cone, não uma faixa. A ±0,20 da largura correspondem ±12 graus:
42 cm a dois metros (certo) e **1,70 m a oito metros** (completamente errado).
Um poste a um metro do seu ombro, oito metros à frente, caía dentro do
"corredor". Agora as bordas da caixa são projetadas em metros e comparadas com
uma faixa de 1,20 m — que é a faixa livre mínima da NBR 9050, de propósito: o
que o app chama de obstrução é o que a norma chama de obstrução.

**4. Habituação, em `fala.js`.** Sobrava a repetição que nenhum freio pegava,
porque cada caso era mesmo novo: sete *"Parquímetro à frente"*, nove *"Carro
passando à direita"* em noventa segundos — postes a cada quinze metros, carros
a cada seis. Objetos diferentes, notícia idêntica.

Cada família de frase tem um contador; a cada repetição o silêncio exigido
dobra; depois de três, a família emudece e sai **uma** frase de paisagem no
lugar: *"Há parquímetros ao longo da sua esquerda."* Diz o padrão, que é o que
constrói o mapa mental da calçada, e cala sobre os casos.

**Duas coisas nunca se habituam**, e são o que impede isto de ficar perigoso:
o que é urgente, e **o que está no seu caminho**. A segunda proteção faltava, e
foi o teste de persona que achou o buraco: um poste plantado no meio da calçada
entra em cena como prioridade média, e a família "parquímetro à frente" já
tinha sido emudecida pelos postes do meio-fio. O aviso saía a 3,5 m em vez de
8 m — quatro metros a menos, que a 1,2 m/s são três segundos e meio.

**Resultado medido** (cenário `quadra`, 90 s de calçada com mobiliário parado
dos dois lados e dois acontecimentos de verdade):

| | falas | frases repetidas | com "Atenção"/"Cuidado" |
|---|---|---|---|
| antes | 36 | 23 | 22 |
| depois | 17 | 4 | 5 |

Os dois acontecimentos reais — a pessoa vindo de frente e o poste no caminho —
continuam anunciados, com a urgência subindo conforme a distância cai.

Reproduzir: `node test/simular.mjs quadra`, `node test/simular.mjs
--comparar-estavel` e `node --test "test/*.test.mjs"`.

## O obstáculo que o mobiliário urbano emudecia (0.15)

O defeito mais grave que o simulador encontrou, e ele era anterior a tudo isto.

`AlertEngine.process` monta um candidato por chave `classe|direção` e ficava
com **o primeiro da lista**. Numa calçada com parquímetros ao longo do
meio-fio, os de longe são lidos como "à frente" — a 20 m, um metro de desvio
lateral dá menos de três graus. Eles chegavam primeiro e tomavam a chave, que
para eles é inofensiva: longe, fora do caminho, prioridade baixa.

Quando um poste **plantado no meio da calçada** aparecia, ele gerava a mesma
chave e era descartado ali, antes de qualquer decisão. Medido: anunciado
normalmente quando sozinho na cena, **nunca** anunciado com os outros em volta.

Agora a chave fica com o candidato mais grave, e o empate, com o mais próximo.
Guardado por `test/estavel.test.mjs`.

## Caixa degenerada: um suspeito dos sustos (0.14)

Perseguindo o item 4 acima, o simulador entregou ao `analyzeSpatial` uma caixa
invertida (`left` > `right`). Ele aceitou e devolveu **distância zero** — e
zero metro é falado como *"a menos de um metro"*, o alerta mais assustador que
o app tem, com a calçada vazia.

A caixa invertida era defeito do simulador, mas a tolerância do app era real.
`caixaSa()` agora endireita, recorta para [0,1] e recusa área desprezível; sem
caixa aproveitável não há distância a afirmar. Isto **não explica sozinho** o
"urso à frente" do teste noturno, que é erro de classificação — mas explica
como um erro de caixa vira alarme de colisão.

## Ameaças e socorro (0.11)

`ameacas.js` responde uma pergunta diferente da do alerta comum: não "o que está perto", mas
"o que pode me machucar nos próximos segundos". Olha trajetória e tempo até o impacto.

| Ameaça | Como decide | O que a pessoa ouve |
|---|---|---|
| Colisão com veículo | velocidade própria do veículo (descontada a de quem anda) e tempo até o impacto ≤ 5 s | *"Cuidado, moto vindo pela direita, rápido."* → *"Pare. Moto pela direita."* |
| Queda | buraco, bueiro, vala, degrau, escada no caminho a ≤ 4 m | *"Atenção, degrau à frente, a três metros. Vá devagar e confirme com a bengala."* → *"Pare. Degrau logo à frente."* |
| Na altura da cabeça | galho baixo no caminho (a bengala não alcança) | *"Atenção, galho baixo na altura da cabeça…"* |
| Pessoa vindo depressa | aproximação acima de ~7 km/h, medida numa janela de 1,2 s | *"Atenção, alguém vindo depressa de frente, a seis metros."* |
| Pessoa colada | alguém a ≤ 2 m por 8 s ou mais | *"Há uma pessoa muito perto de você, à frente, há alguns segundos."* |
| Acompanhando | alguém a ≤ 4 m por mais de 1 min enquanto a pessoa anda | *"Uma pessoa está andando junto com você, à esquerda…"* |
| Possível arma de fogo | duas observações independentes em 25 s | ver acima |

**Regras de linguagem, que valem mais que os limiares:** descreve comportamento, nunca intenção
(nada de "suspeito", "assalto"); nada de rosto, roupa, cor de pele ou idade; arma é sempre
"possível"; a frase diz o que fazer quando há o que fazer; e a mesma ameaça não se repete — só
volta se subir de nível, ou se chegar mais perto depois de 2,5 s, ou depois de 15 s.

**Velocidade sem GPS:** o app liga o GPS junto com a câmera para saber se a pessoa anda. Sem
leitura recente, ele desconta uma caminhada de tudo que vem de frente — senão duas pessoas
andando uma para a outra virariam "alguém vindo depressa".

**Limitação física:** a câmera olha para a frente. "Acompanhando" vê quem anda junto, à frente
ou ao lado; quem vem atrás, não.

**Botão SOS** (vermelho, ao lado de "Onde estou?"): segurar 1,2 s. Abre a mensagem pronta para
o contato de confiança, com link de mapa e hora — a pessoa confirma o envio, porque um navegador
não manda SMS sozinho, e porque um toque no bolso não deve alarmar ninguém. Em Ajustes dá para
trocar por "ligar para o 190". Com TalkBack ou VoiceOver, o duplo toque já aciona. Depois de uma
ameaça séria o app lembra, no máximo a cada 5 min: *"Se precisar de ajuda, segure o botão de
socorro."*

### Simulador de voz no celular

`simulador/` toca no navegador, com a voz do aparelho, o que o app diria em quinze cenas (onde
estou, conversa por voz, rota, travessia, desvio, sem bússola, ameaças e câmera). Roda o mesmo código do app, sem câmera nem GPS.

```bash
bash simulador/montar.sh      # gera simulador/simulador.html, arquivo único
```

Para testar no celular, suba `simulador/simulador.html` junto com o app
(`https://iris.viegastechs.com.br/simulador/simulador.html`) ou abra o arquivo direto.

---

## Navegação a pé

Toque em **Ir para…**, digite ou dite o destino. Pode ser endereço ("Rua Barão de Melgaço
200") ou um lugar ("farmácia", "padaria mais perto").

O que o app faz durante o percurso:

- anuncia o trecho: *"Siga 180 metros pela Rua Barão de Melgaço, sentido leste."*
- prepara a manobra a 25 m: *"Em 24 metros, uns 30 passos, vire à esquerda na Getúlio Vargas."*
- manda executar a 8 m: *"Agora, vire à esquerda na Getúlio Vargas."*
- com a câmera ligada, amarra a manobra ao mundo: *"…, logo depois do poste."*
- em travessia, manda parar e devolve a decisão a quem está lá
- ao chegar: *"Você chegou. A farmácia fica à sua direita."*

**Metros e passos juntos.** Abaixo de 30 m o app dá os dois: *"24 metros, uns 30 passos"*.
Quem fez orientação e mobilidade conta passos, e um número de passos é executável de
imediato — "vinte e quatro metros" exige converter de cabeça enquanto se anda.

### A chave do Google

A navegação funciona **sem chave nenhuma**, pelo OpenStreetMap. Com chave do Google, o
traçado a pé fica melhor nas cidades brasileiras e a busca por nome de estabelecimento
passa a funcionar. Para ligar: Ajustes → "Chave do Google Maps".

A chave precisa da **Maps JavaScript API** com faturamento ativo, e deve ser restringida
por referenciador HTTP ao domínio do app — senão qualquer pessoa que leia o código-fonte
do PWA usa a sua cota. Se o Google falhar ou a cota estourar, o app cai sozinho para o
OpenStreetMap e **diz em voz alta** que mudou, porque a confiança no traçado muda junto.

> O servidor público do OSRM, usado na reserva, é de demonstração: sem acordo de serviço
> e limitado a uma requisição por segundo. Para uso de verdade, hospede o seu.

---

## Como o app decide o que falar

Este é o coração da versão 0.8, e foi reescrito porque a versão anterior falava demais e
sempre igual. Quem usa o app como visão não desliga o volume por ser chato — desliga
porque cansa. E com o som desligado o app não avisa de nada.

**Quatro canais, nesta ordem.** Obstáculo cala navegação, que cala resposta a toque, que
cala narração do ambiente. Só obstáculo e manobra iminente atropelam uma frase em curso.

**Informação estraga.** Cada fala tem prazo: um "vire à direita" que não saiu em 2,5 s é
engolido, não dito com atraso — dito atrasado, ele manda a pessoa para a esquina errada.
Um alerta de obstáculo vale 1,2 s.

**Cena parada é silêncio.** Enquanto nada muda de verdade — classe, direção, faixa de
distância, aproximação — o app não fala. A distância exata é ignorada na comparação de
propósito: ela oscila sozinha e faria nada ser "parado".

**Uma frase, vários objetos.** Em vez de *"Copo à frente."* … *"Celular à frente."* …
*"Livro à esquerda."* … *"Garrafa à direita."* (quatro falas, oito segundos), o app diz:

> À frente, um copo e um celular; à esquerda, um livro; à direita, uma garrafa.

**A primeira menção é sempre canônica; a repetição é que varia.** Substantivo, direção,
distância — sempre nessa ordem, na primeira vez, para a pessoa aprender o padrão e
decodificar sem pensar. Da segunda em diante encurta e muda: *"Pessoa ainda à frente"*,
*"Continua pessoa à frente, a dois metros"*. Variar a **primeira** menção seria confundir
em nome da elegância.

**Alerta não varia nunca.** A frase de perigo é fixa: *"Atenção, pessoa à frente, perto."*
Ela precisa ser reconhecida antes de ser compreendida.

---

## Descrição detalhada (opcional, desligada)

Com ela ligada, o botão "O que tem aqui?" manda **uma foto** a um modelo de visão e
devolve algo de outra natureza:

> Você está num balcão de atendimento. À sua frente, a uns três metros, há uma fila de
> quatro pessoas que dobra à esquerda. O balcão fica no fundo, à direita, com uma placa
> escrita "Senhas". Há cadeiras livres encostadas na parede à sua esquerda.

**Nasce desligada e liga em dois toques.** No primeiro toque o app **fala** o aviso
inteiro — quem não enxerga não lê letra miúda, e consentimento que a pessoa não ouviu não
é consentimento. Só o segundo toque liga.

**A chave da API não fica no app.** O PWA conversa com um proxy do próprio projeto, que
guarda a chave no servidor — ver [`servidor/`](servidor/). Chave dentro de um PWA é
chave pública.

Todo o resto do app continua funcionando sem internet e sem mandar nada para lugar nenhum.

---

## Integração com o Lumiar

`integracao.js` é a costura, e ela não manda nada para a rede por conta própria: publica
eventos dentro do aparelho para quem se inscrever. Duas portas abertas:

**Eventos** — sessão, alerta, piso, risco de via encontrado, manobra, chegada, erro
marcado pelo testador. Um risco de via sai georreferenciado e **sem imagem**:

```js
{ classe: "bueiro aberto", confianca: 0.41, lat: -15.6, lng: -56.09,
  precisaoM: 8, quando: "2026-11-06T13:02:11.000Z", origem: "iris-pwa" }
```

É a matéria-prima de um mapa colaborativo de calçadas — e a ausência da imagem é o que
separa isso de uma câmera de vigilância.

**Provedores de lugar** — quem registrar um provedor responde ao campo de destino **antes**
do Google e do OpenStreetMap. Quando o Lumiar souber responder "Museu Rondon", a resposta
dele vale mais, porque vem com o que interessa: entrada acessível, piso tátil, horário.

```js
import { registrarProvedorDeLugares, barramento, Evento } from "./integracao.js";

registrarProvedorDeLugares({
  nome: "lumiar",
  async buscar(texto, posicao) {
    return [{ nome: "Museu Rondon", lat: -15.61, lng: -56.07,
              acessibilidade: "Entrada acessível pela lateral, com piso tátil." }];
  },
});

barramento.em(Evento.RISCO_ABERTO, (r) => { /* seu destino */ });
```

O contrato completo, e o que um adaptador não pode fazer, estão no próprio arquivo.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Interface (Atkinson Hyperlegible, feita para baixa visão) |
| `app.js` | Câmera, laços de processamento, voz, bipe, tela sempre ligada |
| `core.js` | **Lógica pura**: espacial, distância, alertas, piso, descrição |
| `fala.js` | **Lógica pura**: quem fala, quando cala, com que palavras |
| `navegacao.js` | **Lógica pura**: geodésia, manobras, travessia, fora de rota |
| `rotas.js` | Google Maps e OpenStreetMap, com uma saída só |
| `posicao.js` | GPS, bússola e ditado do destino |
| `vision.js` | Cor do semáforo e segmentação do piso |
| `aberto.js` | Vocabulário aberto: 30 riscos que o COCO não conhece |
| `nuvem.js` | Descrição detalhada opcional (fala com o proxy, nunca com a API) |
| `integracao.js` | Costura para o Lumiar e outros: eventos e provedores de lugar |
| `localizar.js` | **Lógica pura** do "Onde estou?": endereço, referências, direção relativa |
| `lugares.js` | **Lógica pura** dos lugares familiares: aprender, reconhecer, esquecer |
| `embedder.js` | Vetor de características do quadro (MediaPipe ImageEmbedder) |
| `conversa.js` | **Lógica pura**: comandos de voz e memória curta da conversa |
| `orientar.js` | **Lógica pura**: onde você está, quanto falta, caminho livre |
| `estavel.js` | **Lógica pura**: histerese espacial, trilhas, corredor em metros |
| `barreiras.js` | **Lógica pura**: barreiras de calçada, recorrência, denúncia |
| `ameacas.js` | **Lógica pura**: colisão, queda, pessoa, possível arma; mensagem de socorro |
| `ocr.js` | Leitura de texto |
| `diario.js` | Registro da sessão para o piloto |
| `sw.js` | Cache para uso offline |
| `test/layout.test.mjs` | Guarda do grid: a câmera precisa ter altura |
| `test/acessibilidade.test.mjs` | Guarda da marcação: rótulo, foco, região viva, alvo de toque |
| `test/persona.test.mjs` | O app medido pelo que cada pessoa aguenta ouvir |
| `test/carga.test.mjs` | Carrega o `app.js` num DOM de mentira e vê se sobrevive |
| `simulador/` | Simulador de voz para o celular: motor, página e montagem |

Toda regra de decisão mora em `core.js`, `fala.js` e `navegacao.js` — sem dependência de
navegador, e testada. `app.js` e os demais só fazem a ponte com a câmera, o GPS e a rede.

---

## Rodar local

```bash
node --test test/*.test.mjs      # 120 testes: lógica, fala, navegação, layout e carga
node test/simular.mjs             # o que seria falado, cena a cena
node test/simular.mjs --comparar  # política atual contra a da 0.7, lado a lado
node test/simular-rota.mjs        # o que seria falado ao longo de uma rota a pé
node test/simular-rota.mjs desvio # um cenário só
npx serve .                       # http://localhost:3000
```

### Os dois simuladores

O **simulador de cena** alimenta o pipeline real (espacial → aproximação → cortantes →
alertas → narrador → fila de fala) com cenas sintéticas a 12 qps e imprime a linha do
tempo da fala, modelando inclusive o tempo que a voz do aparelho leva para dizer cada
frase. `--comparar` mostra a mesma cena sob a política da 0.7 e sob a atual:

```
  calcada        0.7:   9   atual:   5   -44%
  pequenos       0.7:   5   atual:   1   -80%
```

O **simulador de rota** faz uma pessoa andar a 1,2 m/s por uma rota sintética, com o erro
de GPS da cidade, e imprime o que ela ouviria e em que metro. Três defeitos sérios foram
achados por ele e corrigidos antes de qualquer teste na rua: a travessia sendo anunciada
duas vezes (a segunda com a pessoa já no meio da rua), o "você saiu do caminho" repetindo
a cada seis segundos para sempre, e 180 metros sendo falados como 200.

Os dois validam a *política de fala*, não a qualidade do detector nem do traçado: as
detecções e as rotas ali são perfeitas, e na rua não são.

`localhost` é contexto seguro, então a câmera funciona sem HTTPS no Chrome e no Edge.
Em qualquer outro endereço, **a câmera exige https**.

No Windows, evite `python -m http.server`: ele lê os MIME do registro e pode servir
`.js` como `text/plain`, o que quebra os módulos ES.

---

## Produção

`https://iris.viegastechs.com.br` — certificado Let's Encrypt, renovação automática
pelo `certbot.timer`.

Arquivos em `/opt/iris/web` na **sgcobra** (144.22.159.179), servidos direto pelo nginx,
no mesmo padrão do Lumiar Cultural e do Guia. Vhost em `/etc/nginx/sites-available/iris`.

Atualizar:

```bash
tar czf - index.html app.js core.js fala.js navegacao.js rotas.js posicao.js \
    vision.js aberto.js nuvem.js integracao.js ocr.js diario.js sw.js \
    localizar.js lugares.js embedder.js ameacas.js conversa.js orientar.js \
    estavel.js barreiras.js \
    manifest.webmanifest icons \
  | ssh sgcobra 'tar xzf - -C /opt/iris/web'
```

> **Esta lista tem que ser a mesma do `SHELL` em `sw.js`.** Módulo que entra no app e
> não entra aqui não é publicado, e o `import` dele devolve 404: o app não **abre** —
> nem online, nem offline —, e o sintoma aparece no celular do testador, não aqui.
> `test/offline.test.mjs` compara o `SHELL` com os imports de `app.js`, mas não tem
> como saber o que o `tar` leva. Ao criar um módulo, mexa nos dois lugares. Foi assim
> que `estavel.js` e `barreiras.js` quase ficaram de fora na 0.15.

> **Por que não na micro2.** A tentativa inicial foi hospedar na micro2 (10.0.0.36) com
> proxy pela sgcobra. O iptables da micro2 foi liberado, mas a porta 8080 continua
> barrada na *Security List da Oracle Cloud* — a regra do iptables ficou com 0 pacotes,
> provando que o tráfego nem chega ao kernel. Só a 22 e a 8003 estão liberadas no console.
> Como o PWA é 100% client-side e o servidor só entrega ~244 KB de estáticos, servir pela
> sgcobra dá o mesmo resultado sem depender do console da Oracle.

Ao mudar arquivos do app, suba `VERSION` em `sw.js` — senão o navegador do testador
continua com a versão velha em cache.

> **Não rode `/opt/iris/publicar.sh` sem conferir o GitHub.** Ele faz `git pull` e
> `rsync --delete`: se o repositório remoto estiver atrás do que está no ar, o script
> **rebaixa o site**. Ele também copia `docs/`, `servidor/`, `simulador/` e `treino/`
> para dentro da raiz pública, que não é o que se quer. Enquanto não tiver `--exclude`
> para essas pastas, o `tar` acima é o caminho seguro.

### O que a sgcobra aguenta (medido em 8/11/2026)

| | |
|---|---|
| CPU | 2 vCPU |
| RAM | 956 MB (452 MB livres), 2 GB de swap |
| Disco | 45 GB, 40% usado |
| Sistema | Ubuntu 22.04.5 LTS (jammy) |
| GPU | nenhuma |
| Node | **não instalado** — o `nodejs` do apt no jammy é a versão 12, e o SDK exige 20+ |

Isso decide uma coisa importante: **não dá para rodar um modelo de visão nesta máquina.**
Mesmo um VLM pequeno quer vários gigabytes e, sem GPU, responderia em dezenas de
segundos — inútil para quem está parado na calçada esperando. O proxy da API cabe
folgado (é um processo Node de ~70 MB); o modelo, não. A alternativa sem API é rodar o
modelo **no próprio aparelho**, via transformers.js, como já é feito com o OWL-ViT —
com o custo de qualidade e de memória descrito em "Memória: o limite real do aparelho".

O `servidor/instalar.sh` instala o Node 20 pelo NodeSource quando ele falta.

---

## Acessibilidade: o app usado com leitor de tela (0.15)

**Toda pessoa cega que usa este app tem VoiceOver ou TalkBack ligado.** É assim
que ela instalou o app, abriu o app e achou os botões. E, até a 0.14, o Íris
dizia cada frase **duas vezes** — uma pela própria voz, outra pelo leitor de
tela, porque a barra de status jogava o mesmo texto numa região
`aria-live="assertive"`.

Pior que o eco: `assertive` manda o leitor de tela **interromper** o que estava
lendo. A pessoa não conseguia ouvir o rótulo de um botão até o fim, porque cada
aviso do app cortava a frase no meio.

Nos Ajustes há agora **Quem fala**:

| | A voz do Íris | O leitor de tela |
|---|---|---|
| **Íris** (padrão) | tudo | nada |
| **Leitor de tela** | só obstáculo e manobra | todo o resto |
| **Os dois** | tudo | tudo (vai repetir) |

Cada frase tem um dono só. O padrão é "Íris" porque é o único valor com que o
app funciona para quem não usa leitor de tela; quem usa troca em dois toques.
Obstáculo e manobra continuam na voz do Íris mesmo no modo leitor: a fila do
leitor de tela pode estar ocupada lendo um botão, e atrasar um "pare" custa
caro. Regra em `politicaDeVoz()`, em `fala.js`.

**Outros defeitos corrigidos na mesma auditoria:**

- **A página não tinha cabeçalho nenhum.** Quem usa leitor de tela navega por
  cabeçalhos antes de tudo; o atalho de "próximo cabeçalho" não levava a lugar
  nenhum e a pessoa varria a tela elemento por elemento.
- **Dois dos três botões da barra usavam `disabled`**, e VoiceOver e TalkBack
  **pulam** controles desabilitados. Varrendo a barra inferior, a pessoa achava
  só o botão do meio e nunca descobria que "Ler texto" e "O que tem aqui?"
  existem. Agora é `aria-disabled`: o botão continua encontrável, é anunciado
  como indisponível, e tocar nele diz em voz alta o que falta fazer.
- **O botão Conversar tinha três estados e dois rótulos.** "Ouvindo… fale
  agora" e "Um instante…" produziam exatamente o mesmo nome acessível, então a
  transição não era anunciada — e saber se o app ainda está ouvindo é a única
  coisa que importa na hora de falar.
- **Uma região viva `assertive` para tudo** virou duas: `polite` para o comum,
  `assertive` só para o obstáculo iminente.

Tudo isso é guardado por `test/acessibilidade.test.mjs`, que falha se alguém
trocar `aria-disabled` por `disabled`, acrescentar botão sem rótulo, bloquear o
zoom ou criar uma segunda região `assertive`. Acessibilidade quebra em
silêncio: não dá erro, não aparece na tela, e quem percebe é o usuário cego, na
rua, meses depois.

## Barreiras de calçada e denúncias (0.15)

O que o Íris percebia morria na sessão. A pessoa desviava do buraco, chegava em
casa, e o buraco continuava lá para a próxima pessoa — o app era um instrumento
individual num problema coletivo.

`barreiras.js` guarda cada buraco, bueiro aberto, tapume e degrau com local e
data. E guarda o que **nenhum sensor produz**: a dificuldade que a barreira
causou. A diferença entre *"havia um tapume na calçada"* e *"havia um tapume na
calçada e eu precisei descer para a rua"* é a diferença entre um dado e uma
denúncia.

**O relato entra pela voz**, porque é o único caminho possível: uma pessoa cega
parada numa calçada quebrada não vai procurar botão na tela. Basta dizer o que
aconteceu — *"tropecei"*, *"tive que descer para a rua"*, *"não consegui
passar"*, *"eu caí"* — e o app completa o registro da barreira que acabou de
detectar, em vez de criar outro caso.

**A taxonomia não é nossa, de propósito**: são os seis tipos de barreira usados
no projeto Caminhar (Unifor / MPCE / LINO), que organiza reclamações de calçada
para fiscalização. Usar a mesma categorização é o que permite ao registro do
Íris entrar num painel que já existe, em vez de criar mais uma ilha de dados.

| Tipo | Norma |
|---|---|
| Passeio ausente | NBR 9050 6.10; Lei 13.146/2015 art. 3º |
| Infraestrutura degradada | NBR 9050 6.1.1; Código de Posturas |
| Pavimentação inadequada às normas técnicas | NBR 9050 6.1.1 e 6.9 |
| Piso tátil inadequado ou ausente | NBR 9050 6.9; NBR 16537 |
| Ocupação irregular | NBR 9050 6.1.2 (faixa livre de 1,20 m) |
| Falta de sinalização sonora | NBR 9050 6.12.2; CTB art. 80 §2º |

**Recorrência por distância, não por grade.** Cinco pessoas tropeçando no mesmo
buraco não são cinco buracos, e é a recorrência que move a fiscalização. A
primeira versão arredondava a coordenada para uma grade de 20 m — e nenhuma
grade serve: dois registros a dois metros caem em células diferentes sempre que
calham de estar nos dois lados de uma fronteira. Medido: cinco registros do
mesmo buraco, dentro de nove metros, viraram três "buracos". Agora a ocorrência
entra no caso mais próximo dentro de 20 m, e o centro do caso acompanha as
leituras.

**A prioridade é o dano, não a frequência.** Gravidade do tipo × recorrência,
mais o que de fato aconteceu com as pessoas. Uma barreira que já derrubou
alguém passa à frente de uma mais frequente em que todos desviaram tranquilos.

**O que a denúncia sempre diz**, e não é rodapé — é o que a mantém de pé: que a
classificação é automática e pode errar, que a localização vem de GPS de
celular com erro de 5 a 20 m, e que é recomendada verificação em campo. Sem
isso, a primeira contestação derruba o conjunto inteiro, inclusive as denúncias
corretas.

**Nada sai do aparelho.** O registro mora no `localStorage`; exportar é um
toque consciente em Ajustes → "Exportar denúncias". O arquivo não leva imagem
nenhuma e não identifica a pessoa: tipo, local aproximado, data e o que ela
contou.

**Material de treino.** `manifestoDeTreino()` monta o que o pipeline de
[`treino/`](treino/) consome, agrupado **por local** — tudo do mesmo ponto vai
junto para treino ou para validação, nunca para os dois. Sem isso o treino vira
decoreba: trinta fotos do mesmo buraco espalhadas dão mAP alto e modelo inútil.
Só entra o que tem evidência que a pessoa consentiu em guardar.

## Testes com personas (0.15)

`test/persona.test.mjs` é diferente dos outros testes: os outros verificam
regras ("a faixa não oscila"), este verifica **pessoas**. Monta a caminhada de
alguém com um jeito específico de andar e de ouvir, e cobra do app um orçamento
que aquela pessoa aguenta.

| Persona | Anda a | Orçamento | Por quê |
|---|---|---|---|
| Bengala, cegueira congênita | 1,2 m/s | 10 falas/min | A bengala já encontra o chão: repetir o que ela diz é ruído puro |
| Cão-guia | 1,5 m/s | 8 falas/min | O cão já desvia de obstáculo fixo; falta orientação, não inventário |
| Baixa visão | 1,0 m/s | 12 falas/min | Enxerga vulto; falta o detalhe e o degrau |
| Cegueira + perda auditiva | 0,8 m/s | 6 falas/min | Cada frase compete com o trânsito pelo pouco que ela escuta |

Os testes cobram, para **todas** elas: orçamento de fala respeitado, nenhuma
frase repetida mais de três vezes em dois minutos, obstáculo no caminho
anunciado a **pelo menos 4 metros** (três passos — o mínimo com que uma bengala
longa ainda encontra o obstáculo antes do corpo), perigo nunca habituado, e
quadra sem acontecimento nenhum terminando sem um único alarme.

Foi este arquivo que encontrou a habituação atrasando o aviso de um obstáculo
real e o corredor medido em ângulo. **Os números são contrato**: quem mudar a
política de fala e quebrar um deles defende o número novo, não ajusta o teste
até passar.

O protocolo para as sessões com pessoas de verdade — perfis, roteiros,
consentimento falado e critério de reprovação — está em
[`docs/PROTOCOLO-TESTE-CEGOS.md`](docs/PROTOCOLO-TESTE-CEGOS.md).

## Travamentos: três causas, e por que não deixavam rastro (0.15)

Relato de campo: *"ao marcar nas configurações identificar calçadas, o app para
e trava"*. Eram três defeitos somados.

**1. O laço de quadros podia morrer.** `processFrame` era protegido;
`bombearFala()` não era. Uma exceção ali escapava **antes** do
`requestAnimationFrame` da última linha, e o laço simplesmente não se
reagendava. O que a pessoa vê quando isso acontece é o pior cenário possível: a
câmera continua ligada, a imagem continua na tela, o app parece aceso — e não
fala mais nada, nunca. Quem não enxerga não tem como perceber que a imagem
congelou, e continua andando confiando num app que parou de olhar. O
reagendamento agora mora num `finally`.

**2. Carga concorrente de modelo.** `if (this.pipe) return` só protege depois
que o `await` terminou, e entre o começo e o fim passam segundos. Marcar
"identificar calçadas" com a percepção ligada disparava uma carga, o `start()`
disparava outra, marcar e desmarcar disparava mais — cada uma instanciando um
SegFormer inteiro, ~120 MB. O navegador mata a aba sem evento, sem erro e sem
log. O mesmo valia para o reconhecimento ampliado, a ~250 MB por cópia.

**3. Desligar não devolvia a memória.** Desmarcar a calçada parava o laço e
deixava o modelo carregado pelo resto da sessão. Quem desligasse a calçada para
ligar o ampliado — que é exatamente o que o app manda fazer — ficava com os
dois na memória mesmo tendo escolhido um.

Mais duas correções de apoio: o aviso de calçada ganhou **porteira de memória**
(era o segundo modelo mais caro e o único dos pesados sem nenhuma), e o laço do
piso passou a desacelerar também quando a análise é descartada por já haver
outra rodando.

**E uma caixa-preta.** Nenhum erro fora dos `try/catch` pontuais era registrado
em lugar nenhum, então o relato possível era "travou". Agora todo erro não
tratado e toda promessa rejeitada sem dono entram no diário da sessão e na
linha de diagnóstico dos Ajustes, com a etapa em que o app estava. Não conserta
nada — faz a falha deixar rastro, que é a diferença entre um defeito
investigável e um defeito eterno.

## Piloto com usuários cegos

Nos ajustes (ícone de engrenagem), ligue **Modo validação**. Aparecem dois botões grandes:

- **Avisou errado** — falso positivo
- **Não avisou** — obstáculo que passou batido (o dado mais importante)

Cada toque grava o que o app enxergava naquele instante. Ao final, **Exportar diário da
sessão** gera um JSON. Nada é enviado automaticamente; nenhuma imagem é gravada.

### O que medir

Quadros por segundo, tempo de detecção, bateria em 30 min, aquecimento, avisos corretos,
avisos falsos e obstáculos que passaram sem aviso. Teste também com o **VoiceOver** ou
**TalkBack** ligado, para ver se a voz do app e a do leitor de tela se atrapalham.

---

## Próximos passos

**Profundidade real** (Depth Anything V2) substituiria a estimativa por prior de tamanho —
é o maior salto de qualidade disponível, e roda no navegador. Vale mais do que qualquer
outra coisa nesta lista: a distância é hoje o número mais frágil do app, e ela entra em
toda decisão de alerta.

**Detector próprio de riscos de calçada.** O vocabulário aberto já reconhece buraco,
bueiro e degrau hoje, mas leva segundos por varredura. Um detector treinado rodaria a
cada quadro. O pipeline completo está em [`treino/`](treino/): exportador do diário
do piloto, preparação do dataset com divisão por local, treino em duas fases, validação
por recall de perto e exportação para TFLite. Precisa de GPU e, sobretudo, de coleta —
a micro2 não serve.

**Busca de lugar por voz dentro da navegação**, para quem não quer digitar endereço.
O ditado já existe no campo de destino; falta conversar ("a farmácia mais perto que
esteja aberta agora").

---

---

## Memória: o limite real do aparelho

É aqui que o app morre, e morre em silêncio: quando o navegador fica sem memória
ele mata a aba inteira. Nenhum código nosso roda nesse instante — não há evento, não
há erro, não há log. Quem está testando vê a página de erro do navegador e não tem
o que relatar além de "caiu".

**Quanto cada peça custa, por alto:**

| Peça | Memória |
|---|---|
| Detector de objetos (EfficientDet-Lite0 + WASM) | ~60 MB |
| Precisão alta (Lite2) em vez do Lite0 | +40 MB |
| Aviso de calçada (SegFormer-B0) | ~120 MB |
| Reconhecimento ampliado (OWL-ViT) | ~250 MB, com picos maiores |

Um celular comum tem 4 GB, dos quais o Chrome entrega bem menos a uma aba. Somar
detector, calçada e ampliado estoura.

**O que o app faz a respeito:**

1. **Calçada e ampliado não ligam juntos.** Ligar um desliga o outro, e o app diz
   por quê. Eram os dois modelos pesados disputando a mesma memória.
2. **Porteira de memória.** Abaixo de 4 GB declarados, o app recusa o
   reconhecimento ampliado antes de baixar 90 MB para depois cair.
3. **O laço de quadros para durante a varredura ampliada.** Manter o detector
   rápido a 12 qps com um segundo modelo na memória é o que estoura o aparelho.
4. **Guarda de queda.** O app grava uma marca ao começar e a apaga ao parar
   limpo. Se na abertura seguinte a marca ainda estiver lá, a sessão anterior foi
   morta pelo navegador: ele **desliga o que estava pesando, diz isso em voz alta**
   e volta funcionando. Sem isso, a pessoa reabre e cai de novo, para sempre.
5. **O service worker não guarda arquivo acima de 60 MB.** Quando a cota de
   armazenamento estoura, o navegador apaga tudo do domínio — inclusive os arquivos
   do app, que são o que o faz abrir sem internet. Perder o cache do modelo é
   baixar de novo; perder o cache do app é o app não abrir.

Em Ajustes há uma linha de diagnóstico com a memória do aparelho, os núcleos, os
modelos ligados e a etapa em que a última queda aconteceu. **É o que o piloto deve
copiar ao relatar uma queda.**

## Limitações da plataforma (iPhone)

| | Android nativo | iPhone (PWA) |
|---|---|---|
| Vibração | sim | **não** — substituída por bipe |
| Tecla de volume para descrever | sim | **não** — use os botões |
| Câmera com tela bloqueada | para | para |
| Chave de silencioso | — | no Safari 17+ o app tenta tocar mesmo assim |
