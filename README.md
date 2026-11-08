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

**Arma de fogo não é detectada.** O COCO não tem classe de arma — há um teste que
trava isso no contrato. O app reconhece faca, tesoura e taco, e os anuncia como
"objeto pontiagudo", nunca como arma. Um falso positivo aqui causa pânico e pode
acusar alguém injustamente.

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

### Simulador de voz no celular

`simulador/` toca no navegador, com a voz do aparelho, o que o app diria em nove cenas (onde estou,
rota, travessia, desvio, sem bússola, câmera). Roda o mesmo código do app, sem câmera nem GPS.

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
| `ocr.js` | Leitura de texto |
| `diario.js` | Registro da sessão para o piloto |
| `sw.js` | Cache para uso offline |
| `test/layout.test.mjs` | Guarda do grid: a câmera precisa ter altura |
| `test/carga.test.mjs` | Carrega o `app.js` num DOM de mentira e vê se sobrevive |
| `simulador/` | Simulador de voz para o celular: motor, página e montagem |

Toda regra de decisão mora em `core.js`, `fala.js` e `navegacao.js` — sem dependência de
navegador, e testada. `app.js` e os demais só fazem a ponte com a câmera, o GPS e a rede.

---

## Rodar local

```bash
node --test test/*.test.mjs      # 100 testes: lógica, fala, navegação, layout e carga
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
    localizar.js lugares.js embedder.js \
    manifest.webmanifest icons \
  | ssh sgcobra 'tar xzf - -C /opt/iris/web'
```

> **Por que não na micro2.** A tentativa inicial foi hospedar na micro2 (10.0.0.36) com
> proxy pela sgcobra. O iptables da micro2 foi liberado, mas a porta 8080 continua
> barrada na *Security List da Oracle Cloud* — a regra do iptables ficou com 0 pacotes,
> provando que o tráfego nem chega ao kernel. Só a 22 e a 8003 estão liberadas no console.
> Como o PWA é 100% client-side e o servidor só entrega ~244 KB de estáticos, servir pela
> sgcobra dá o mesmo resultado sem depender do console da Oracle.

Ao mudar arquivos do app, suba `VERSION` em `sw.js` — senão o navegador do testador
continua com a versão velha em cache.

---

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
