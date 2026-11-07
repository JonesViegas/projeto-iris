# Íris — Roteiro de aprendizagem de máquina: situar, descrever, guiar

> Objetivo implícito do projeto: ser os olhos da pessoa e **posicioná-la no ambiente**.
> Isso tem três perguntas, nesta ordem: **onde estou?** → **o que tem à minha volta?** →
> **como chego lá?** A versão 0.9 respondia bem a segunda e a terceira. A 0.10 fecha a primeira.

## Diagnóstico da 0.9 (o que já existe)

| Pergunta | Já resolvido | Lacuna |
|---|---|---|
| Onde estou? | GPS e bússola existiam só *dentro* da navegação | Ninguém dizia a rua, o rumo nem as referências antes de sair. Dentro de casa, nada. |
| O que tem à volta? | EfficientDet (80 classes), SegFormer (piso), OWL-ViT (30 riscos), OCR, VLM opcional | Distância por prior de tamanho (frágil); a descrição não sabia *onde* a pessoa estava. |
| Como chego lá? | Google/OSRM, manobras em metros e passos, travessia, fora de rota | Destinos pessoais ("casa", "trabalho") precisavam ser digitados como endereço. |

Pontos fortes que a 0.10 preserva: lógica pura testada (`core.js`, `fala.js`, `navegacao.js`),
fila de fala com prioridade e validade, nada de imagem saindo do aparelho sem consentimento falado,
nunca mandar atravessar, nunca dizer esquerda/direita sem rumo conhecido.

## O que a 0.10 entrega

### 1. "Onde estou?" — `localizar.js`
Botão ao lado de "Ir para…". Num toque:

1. GPS + bússola em paralelo (a bússola nasce dentro do toque, exigência do iPhone).
2. Geocodificação reversa (Nominatim) → rua, número aproximado, bairro.
3. Overpass (OpenStreetMap) num raio de 80 m → referências que importam para locomoção:
   ponto de ônibus, faixa (com piso tátil / sinal sonoro), semáforo, escada, entrada, depois comércio.
4. Cada referência ganha **lado relativo** (com bússola) ou **ponto cardeal** (sem bússola) e
   distância em metros e passos.
5. Com a câmera ligada, a frase do lugar abre a descrição da câmera **numa fala só**, e o endereço
   vai como contexto para a descrição detalhada (o modelo liga "a farmácia à sua direita" à fachada que vê).

Exemplo real do simulador:
> Você está na Rua Barão de Melgaço, perto do número 2150, bairro Centro Norte. Você está virado
> para o norte. Perto de você: faixa de pedestre, com piso tátil, à sua frente, a 20 metros, uns 25
> passos; ponto de ônibus, atrás de você, a 40 metros; farmácia Pague Menos, à sua direita, a 15
> metros, uns 20 passos. Pela câmera: …

### 2. Lugares familiares — `lugares.js` + `embedder.js` (aprendizagem de máquina no aparelho)
A pessoa ensina o app: "memorize como *portão de casa*". O app tira 8 quadros enquanto ela gira o
celular, transforma cada um num vetor de 1024 números (MobileNet-V3 via MediaPipe ImageEmbedder,
~4 MB) e guarda **só os vetores** (IndexedDB). Para reconhecer: 3 quadros → vizinhos mais próximos
por cosseno, média dos k=3 melhores, limiar 0,78 e margem 0,03 sobre o segundo colocado, votação
entre quadros, e o GPS descarta lugares a mais de 300 m.

- Funciona **onde o GPS não funciona** (dentro de casa, prédio, shopping).
- Lugar memorizado com GPS bom vira **destino de navegação**: "Ir para casa".
- Esquecer é apagar uma linha; nada sai do aparelho; do vetor não se reconstrói a foto.

### Testes
21 testes novos (`test/localizar.test.mjs`, `test/lugares.test.mjs`); suíte inteira: 89, todos passando.

## Próximas etapas (em ordem de impacto)

| # | Etapa | Modelo / técnica | Por quê | Esforço |
|---|---|---|---|---|
| 1 | **Profundidade real** | Depth Anything V2 Small (ONNX, transformers.js, WebGPU) a 2–4 qps, calibrada pelo prior de tamanho | A distância é o número mais frágil e entra em todo alerta. Também dá "caminho livre" por coluna da imagem. | Médio |
| 2 | **Calibrar lugares familiares no piloto** | Coletar pares (mesmo lugar / outro lugar) e ajustar limiar e margem por curva ROC | 0,78 é um chute educado; o erro caro é dizer o lugar errado | Baixo |
| 3 | **Alinhamento de rumo pela câmera** | Comparar o rumo da rua (polilinha do OSM) com linhas de fuga da calçada (segmentação já existente) | Bússola sofre com metal e ímã; parada na esquina é quando mais importa | Médio |
| 4 | **Detector próprio de riscos de calçada** | YOLO/EfficientDet treinado com `treino/` (buraco, bueiro, degrau, tapume, piso tátil) | Roda a cada quadro, ao contrário do OWL-ViT | Alto (coleta) |
| 5 | **Reconhecer o tipo de ambiente** | Classificador de cena (Places365 MobileNet) | "Você parece estar num corredor / numa recepção" quando não há GPS nem lugar memorizado | Baixo |
| 6 | **Conversa por voz** | VLM no proxy com o contexto local (objetos, piso, lugar, rota) | "Onde fica a porta?", "tem cadeira livre?" — pergunta e resposta, não só descrição | Médio |
| 7 | **Mapa colaborativo com o Lumiar** | Eventos `LOCALIZACAO` e `RISCO_ABERTO`, sem imagem | Riscos e entradas acessíveis viram dado público | Médio |

## Riscos e ressalvas
- Overpass e Nominatim públicos têm limite de uso; para escala, hospedar ou contratar.
- OSM no Brasil é desigual: em bairros pouco mapeados, haverá poucas referências — a frase diz isso.
- Reconhecimento de lugar muda com luz (dia/noite): memorizar o mesmo lugar em horários diferentes.
