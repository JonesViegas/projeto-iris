#!/usr/bin/env python3
"""Valida o modelo pelos números que importam para quem não enxerga.

O `val` do ultralytics devolve mAP. mAP é uma média sobre todas as distâncias e
todos os limiares, e por isso esconde exatamente o que aqui decide tudo:

    **um buraco a 3 metros que o modelo não achou.**

A 3 metros, andando a 1,2 m/s, sobram dois segundos e meio. Um modelo que acha
90% dos buracos a 15 metros e 60% dos buracos a 3 metros tem mAP respeitável e
é perigoso. Um que acha 70% longe e 92% perto é pior no papel e melhor na rua.

Por isso o critério aqui é **recall por faixa de distância**, com a distância
calculada da mesma forma que o app calcula (projeção pinhole pela altura
aparente da caixa) — validar numa unidade e usar outra é validar outra coisa.

Sai com código 1 se algum piso de classes.yaml não for batido. Serve para
barrar o deploy num pipeline, e serve para barrar o entusiasmo.

    python 4_validar.py --pesos runs/iris/weights/best.pt --dados dados/iris/dataset.yaml
"""

import argparse
import math
import sys
from collections import defaultdict
from pathlib import Path

import yaml

# Mesmos valores de aberto.js: a validação precisa falar a língua do app.
ALTURA_M = {
    "buraco": 0.35, "bueiro_aberto": 0.6, "degrau": 0.18,
    "calcada_quebrada": 0.4, "tapume_obra": 2.2, "piso_tatil": 0.4,
}
FOV_VERTICAL_RAD = math.radians(48)
IOU_MIN = 0.5
CONFIANCA = 0.25


def distancia_m(nome, altura_rel):
    """d = H / (2 · h · tan(fov/2)) — a fórmula de core.js, em Python."""
    H = ALTURA_M.get(nome)
    if not H or altura_rel <= 0.001:
        return None
    return H / (2 * altura_rel * math.tan(FOV_VERTICAL_RAD / 2))


def faixa_de(d, faixas):
    if d is None:
        return None
    for nome, (lo, hi) in faixas.items():
        if lo <= d < hi:
            return nome
    return "longe"


def iou(a, b):
    """Caixas em (cx, cy, w, h) normalizado."""
    def cantos(c):
        return (c[0] - c[2] / 2, c[1] - c[3] / 2, c[0] + c[2] / 2, c[1] + c[3] / 2)
    ax0, ay0, ax1, ay1 = cantos(a)
    bx0, by0, bx1, by1 = cantos(b)
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def ler_rotulos(txt):
    saida = []
    for linha in Path(txt).read_text(encoding="utf-8").splitlines():
        p = linha.split()
        if len(p) >= 5:
            saida.append((int(p[0]), tuple(float(x) for x in p[1:5])))
    return saida


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pesos", required=True)
    ap.add_argument("--dados", required=True)
    ap.add_argument("--classes", default="classes.yaml")
    ap.add_argument("--split", default="test", choices=["test", "val"],
                    help="use 'test': é o conjunto que o treino nunca viu")
    ap.add_argument("--confianca", type=float, default=CONFIANCA)
    args = ap.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("Falta o ultralytics: pip install -r requirements.txt", file=sys.stderr)
        return 1

    cfg = yaml.safe_load(Path(args.classes).read_text(encoding="utf-8"))
    faixas = {k: tuple(v) for k, v in cfg["faixas_m"].items()}
    por_id = {c["id"]: c for c in cfg["classes"]}
    nomes = {c["id"]: c["nome"] for c in cfg["classes"]}

    d = yaml.safe_load(Path(args.dados).read_text(encoding="utf-8"))
    raiz = Path(d["path"])
    sub = d.get(args.split) or d["val"]
    imgs = sorted(p for p in (raiz / sub).glob("*") if p.suffix.lower() in
                  {".jpg", ".jpeg", ".png", ".bmp", ".webp"})
    if not imgs:
        print(f"Nenhuma imagem em {raiz / sub}", file=sys.stderr)
        return 1

    modelo = YOLO(args.pesos)

    # achou[(classe, faixa)] / total[(classe, faixa)]  -> recall
    achou, total = defaultdict(int), defaultdict(int)
    acertos, previsoes = defaultdict(int), defaultdict(int)

    print(f"Avaliando {len(imgs)} imagens de '{args.split}' …")
    for img in imgs:
        rot = raiz / "labels" / Path(sub).name / (img.stem + ".txt")
        verdade = ler_rotulos(rot) if rot.exists() else []

        r = modelo.predict(img, conf=args.confianca, verbose=False)[0]
        preditas = []
        for b in r.boxes:
            cls = int(b.cls.item())
            x, y, w, h = b.xywhn[0].tolist()
            preditas.append((cls, (x, y, w, h)))
            previsoes[cls] += 1

        usadas = set()
        for cls, caixa in verdade:
            nome = nomes.get(cls, str(cls))
            f = faixa_de(distancia_m(nome, caixa[3]), faixas) or "longe"
            total[(cls, f)] += 1

            melhor, melhor_iou = None, IOU_MIN
            for i, (pc, pb) in enumerate(preditas):
                if i in usadas or pc != cls:
                    continue
                v = iou(caixa, pb)
                if v >= melhor_iou:
                    melhor, melhor_iou = i, v
            if melhor is not None:
                usadas.add(melhor)
                achou[(cls, f)] += 1
                acertos[cls] += 1

    # ---------------- relatório ----------------
    largura = 74
    print("\n" + "=" * largura)
    print(f"{'classe':<20}{'perto':>10}{'médio':>10}{'longe':>10}{'precisão':>12}{'':>2}")
    print("-" * largura)

    reprovas = []
    for cid, c in sorted(por_id.items()):
        linha = f"{c['nome']:<20}"
        r_perto = None
        for f in ("perto", "medio", "longe"):
            t = total[(cid, f)]
            a = achou[(cid, f)]
            rec = (a / t) if t else None
            if f == "perto":
                r_perto = rec
            linha += f"{(f'{rec:.2f}' if rec is not None else '—'):>10}"

        p = previsoes[cid]
        prec = (acertos[cid] / p) if p else None
        linha += f"{(f'{prec:.2f}' if prec is not None else '—'):>12}"

        falhou = []
        if r_perto is None:
            falhou.append("sem amostra de perto no conjunto de teste")
        elif r_perto < c["recall_perto"]:
            falhou.append(f"recall perto {r_perto:.2f} < {c['recall_perto']}")
        if prec is not None and prec < c["precisao_min"]:
            falhou.append(f"precisão {prec:.2f} < {c['precisao_min']}")

        linha += "  REPROVA" if falhou else "  ok"
        print(linha)
        for m in falhou:
            print(f"{'':<20}  → {m}")
            reprovas.append((c["nome"], m))

    print("=" * largura)
    amostras_perto = sum(v for (c, f), v in total.items() if f == "perto")
    print(f"Instâncias de perto no teste: {amostras_perto}")
    if amostras_perto < 100:
        print("AVISO: menos de 100 instâncias de perto. O recall acima é um palpite,")
        print("não uma medida. Colete mais fotos tiradas a menos de 4 metros.")

    if reprovas:
        print(f"\n{len(reprovas)} critério(s) não batido(s). O modelo NÃO vai a usuário.")
        return 1

    print("\nPisos batidos. Antes de ir a um usuário cego, faltam ainda:")
    print("  1. caminhada gravada de 30 min em rua real, com contagem à mão")
    print("  2. teste com pessoa vendada")
    print("  3. README do app atualizado com o que esta versão detecta — e o que não")
    return 0


if __name__ == "__main__":
    sys.exit(main())
