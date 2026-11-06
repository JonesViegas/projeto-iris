# Treino próprio — riscos de calçada brasileira

Pipeline para treinar o detector que o Íris não tem: **buraco, bueiro aberto, degrau,
calçada quebrada, tapume de obra, piso tátil**. Nenhum conjunto pronto cobre isso da
altura de quem anda com o celular na mão.

---

## Leia isto antes de começar

**Treinar não é rodar um script.** É coletar e rotular imagens, e isso é 80% do
trabalho e 100% do que determina se o modelo funciona. As três ilusões mais caras:

**"Uso RDD2022 e pronto."** O RDD2022 é o melhor conjunto público de dano em via, com
~47 mil imagens rotuladas. Ele foi fotografado **do para-brisa de um carro**, olhando a
pista, a 40 km/h. O Íris olha a calçada, de 1,5 m de altura, parado ou a 4 km/h, com a
câmera inclinada. São domínios diferentes: um modelo treinado só no RDD2022 acerta
buraco de asfalto visto de longe e erra buraco de calçada visto de cima. Use-o como
**pré-treino**, nunca como conjunto final.

**"Mil imagens bastam."** Para uma classe fácil e visualmente consistente, talvez. Buraco
não é: ele muda com a luz, com a sombra, com estar seco ou cheio d'água, com o tipo de
piso. Conte com **1.500 a 3.000 instâncias rotuladas por classe**, e com metade delas
vindo das ruas onde o app vai ser usado.

**"Depois eu valido."** Um detector de obstáculo para pessoa cega tem um erro barato e um
caro. Avisar de um buraco que não existe é barato — a pessoa desvia à toa. **Não avisar
de um buraco que existe é uma queda.** Isso muda o que se otimiza: recall alto na faixa de
0 a 4 metros vale mais do que mAP bonito. O script `4_validar.py` mede exatamente isso, e
é ele que decide se o modelo pode ir a um usuário, não a métrica do treino.

---

## O que você precisa

| | |
|---|---|
| GPU | NVIDIA com 8 GB ou mais. A micro2 não serve: não tem GPU |
| Tempo | ~4 h de treino por rodada numa RTX 3060; o rótulo leva semanas |
| Python | 3.10 ou superior |
| Rotulagem | [Label Studio](https://labelstud.io) ou [CVAT](https://cvat.ai), os dois gratuitos |

```bash
cd treino
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

---

## O caminho, em cinco passos

### 1. Puxar do piloto o que o app está errando

O diário que os testadores exportam já registra **onde o app não avisou**. Cada toque em
"Não avisou" é um caso real de falha, com contexto. É a lista de compras do dataset.

```bash
python 1_exportar_diario.py ~/diarios/*.json --saida relatorio-piloto.md
```

Saem duas coisas: um relatório do que mais falha e um `plano-de-coleta.csv` dizendo
quantas imagens de cada classe faltam. Colete seguindo esse plano, não por intuição.

> **Privacidade.** O diário não contém imagem nenhuma — só classes, distâncias e
> horários. As fotos do dataset são tiradas por você, de propósito, não dos usuários.

### 2. Montar o conjunto

```bash
# baixe antes: RDD2022 e os conjuntos do Roboflow listados em fontes.md
python 2_preparar_dataset.py --fontes dados/brutos --saida dados/iris --proprias dados/coletadas
```

Esse script faz a parte que mais gente erra: **separa treino, validação e teste por
local**, não por sorteio. Trinta fotos do mesmo buraco de ângulos diferentes, espalhadas
no sorteio, deixam o modelo com 0,95 de mAP e inútil na rua — ele decorou aquele buraco.
Separando por local, a validação mede generalização de verdade.

### 3. Treinar

```bash
python 3_treinar.py --dados dados/iris/dataset.yaml --modelo yolo11s --epocas 120
```

Começa do peso COCO, que já sabe bordas, sombra e textura. Duas fases: congelado por 10
épocas para a cabeça aprender as classes novas, depois tudo solto com taxa baixa.

### 4. Validar como se fosse para a rua

```bash
python 4_validar.py --pesos runs/iris/weights/best.pt --dados dados/iris/dataset.yaml
```

Reprova o modelo se ele não bater os pisos mínimos de `classes.yaml`. **Recall por faixa
de distância** é o número que manda. Um modelo com mAP 0,62 e recall 0,91 de perto é
melhor, aqui, do que um com mAP 0,71 e recall 0,74.

### 5. Exportar e ligar no app

```bash
python 5_exportar.py --pesos runs/iris/weights/best.pt --formato tflite --int8
```

Sai um `.tflite` quantizado de 6 a 12 MB. Para ligar no PWA, hospede junto dos estáticos
e acrescente a entrada em `MODELOS`, no `app.js`:

```js
const MODELOS = {
  lite2: "…/efficientdet_lite2.tflite",
  lite0: "…/efficientdet_lite0.tflite",
  riscos: "/modelos/iris-riscos-v1.tflite",   // o seu
};
```

E uma opção no `<select id="selModelo">` do `index.html`. O detector de riscos **soma** ao
de objetos; não substitui. Pessoa e carro continuam vindo do COCO.

---

## Antes de levar a um usuário cego

Nenhum número de validação autoriza isso sozinho. O mínimo:

1. Os pisos de `classes.yaml` batidos no conjunto de **teste**, que o treino nunca viu.
2. Uma caminhada gravada de 30 minutos em rua real, contando à mão os obstáculos perdidos.
3. Teste com quem enxerga, usando venda, antes de testar com quem não enxerga.
4. O `README.md` do app atualizado dizendo o que a versão detecta — e o que ainda não.

E a regra que não muda: **o Íris é complemento da bengala, nunca substituto.** Um modelo
melhor não altera essa frase.

---

## Enquanto o treino não existe

O app já reconhece essas mesmas classes **hoje**, sem treino nenhum, pelo vocabulário
aberto ([`../aberto.js`](../aberto.js), OWL-ViT): liga-se em Ajustes → "Reconhecimento ampliado". É mais
lento (1 a 4 s por varredura, contra 40 ms) e erra mais, por isso roda sob demanda e não a
cada quadro. Vale como ponte, e como forma de descobrir quais classes merecem o treino.
