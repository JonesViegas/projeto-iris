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
| Diário do piloto | local, em JSON | para a validação com usuários |

### O que ainda **não** faz

**Arma de fogo não é detectada.** O COCO não tem classe de arma — há um teste que
trava isso no contrato. O app reconhece faca, tesoura e taco, e os anuncia como
"objeto pontiagudo", nunca como arma. Um falso positivo aqui causa pânico e pode
acusar alguém injustamente.

**Buraco não é detectado.** Não existe no COCO nem no ADE20K, e exige modelo treinado
especificamente — ver "Próximos passos". Até lá, o app não avisa buraco. Não prometa isso
a quem for testar.

---

## Ressalvas honestas

**A distância é estimada, não medida.** Ela vem do tamanho aparente do objeto comparado
à altura típica da classe (pessoa ≈ 1,70 m, carro ≈ 1,50 m). Objeto cortado pela borda do
quadro, classe fora do padrão (criança, caminhonete alta) ou câmera inclinada degradam a
estimativa. Quando a caixa toca a borda, o cálculo puxa para **mais perto**, porque errar
para longe é o erro perigoso. Medição real exigiria modelo de profundidade.

**A cor do semáforo é informativa, nunca permissiva.** A câmera não sabe se está vendo o
semáforo de pedestre ou o dos veículos. O app diz "semáforo verde à frente" e para por aí.

---

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Interface (Atkinson Hyperlegible, feita para baixa visão) |
| `app.js` | Câmera, laços de processamento, voz, bipe, tela sempre ligada |
| `core.js` | **Lógica pura**: espacial, distância, alertas, piso, descrição. Sem navegador |
| `vision.js` | Cor do semáforo e segmentação do piso |
| `ocr.js` | Leitura de texto |
| `diario.js` | Registro da sessão para o piloto |
| `sw.js` | Cache para uso offline |
| `test/core.test.mjs` | `node --test test/core.test.mjs` |

Toda regra de decisão mora em `core.js`, sem dependência de navegador, e é testada.

---

## Rodar local

```bash
node --test test/core.test.mjs    # 28 testes da lógica
node test/simular.mjs             # simula cenários e imprime o que seria falado
node test/simular.mjs faca        # um cenário só
npx serve .                       # http://localhost:3000
```

O **simulador** alimenta o pipeline real (espacial → aproximação → cortantes →
alertas → narrador) com cenas sintéticas a 12 qps e imprime a linha do tempo da
fala. Ele valida a *política de fala*, não a qualidade do detector: as detecções
ali são perfeitas, e na rua o EfficientDet erra. Quatro defeitos de fala foram
encontrados por ele antes de chegarem ao usuário.

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
tar czf - index.html app.js core.js vision.js ocr.js diario.js sw.js \
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
é o maior salto de qualidade disponível, e roda no navegador.

**Buraco e piso irregular** exigem treino próprio: dataset rotulado (RDD2022, conjuntos do
Roboflow), fine-tuning em GPU e validação separada antes de ir a usuário final. Não roda na
micro2, que não tem GPU.

---

## Limitações da plataforma (iPhone)

| | Android nativo | iPhone (PWA) |
|---|---|---|
| Vibração | sim | **não** — substituída por bipe |
| Tecla de volume para descrever | sim | **não** — use os botões |
| Câmera com tela bloqueada | para | para |
| Chave de silencioso | — | no Safari 17+ o app tenta tocar mesmo assim |
