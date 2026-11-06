# De onde vêm as imagens

## Públicas — servem de pré-treino, nunca de conjunto final

| Conjunto | O que tem | A ressalva |
|---|---|---|
| **RDD2022** | ~47 mil imagens de dano em via, 6 países, inclusive rachadura e buraco | Fotografado do para-brisa de carro em movimento. Ponto de vista errado para o Íris |
| **Roboflow Universe — "pothole detection"** | Vários conjuntos de buraco, alguns já em YOLO | Qualidade do rótulo varia muito; revise antes de usar |
| **Roboflow Universe — "tactile paving"** | Piso tátil, sobretudo do Japão e da Coreia | O piso tátil brasileiro (NBR 9050) tem desenho e cor próprios |
| **Mapillary Vistas** | Cena de rua segmentada, inclui calçada e meio-fio | Licença de pesquisa; leia antes de usar em produto |

Baixe cada um para `dados/brutos/<nome>/` já convertido para YOLO. O passo 2
reindexa as classes pelo mapa `DE_PARA` em `2_preparar_dataset.py`.

## Própria — é esta que decide se funciona

Pelo menos **40% do conjunto**, e de preferência mais. Regras de coleta:

1. **Da altura e do ângulo de uso.** Celular na mão, na altura do peito,
   inclinado para baixo entre 20 e 40 graus. Não agachado, não de drone.
2. **Uma pasta por local.** O passo 2 divide treino/validação/teste por pasta;
   misturar locais numa pasta só reintroduz o vazamento que ele evita.
3. **O mesmo obstáculo em condições diferentes** conta como uma coleta boa:
   manhã, meio-dia, fim de tarde, molhado, seco, com sombra de poste em cima.
4. **Fotografe o que NÃO é.** Bueiro com tampa, mancha escura de óleo, remendo
   de asfalto, sombra redonda. Sem exemplos negativos difíceis o modelo chama
   toda mancha escura de buraco, e aí a pessoa desliga o app.
5. **Nada de pessoa identificável** sem autorização. Se entrar alguém no quadro,
   descarte ou recorte.

## Quanto dá para esperar

Com 1.500 instâncias por classe, metade próprias, um yolo11s chega a algo como
0,55 a 0,70 de mAP50 nessas classes — número modesto que, com recall alto de
perto, já é útil. Quem prometer 0,9 está medindo com vazamento.
