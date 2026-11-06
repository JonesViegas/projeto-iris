#!/usr/bin/env python3
"""Monta o dataset YOLO do Íris a partir das fontes públicas e da coleta própria.

A parte que quase todo mundo erra está aqui, e não no treino: **a divisão**.

Se você sortear imagens entre treino, validação e teste, e tiver tirado trinta
fotos do mesmo buraco de ângulos diferentes — que é o que se faz ao coletar —
o mesmo buraco cai nos três conjuntos. O modelo decora aquele buraco, a
validação aplaude, e na rua ele não acha nenhum outro. Dá mAP 0,95 e um app que
deixa a pessoa cair.

Por isso a divisão aqui é **por local**: todas as fotos de um mesmo lugar ficam
no mesmo conjunto. O número que sai é mais feio e é verdadeiro.

Espera a coleta própria neste formato:

    dados/coletadas/
      local-001-rua-13-de-junho/
        img_0001.jpg
        img_0001.txt        # YOLO: classe cx cy w h, normalizado
      local-002-praca-alencastro/
        ...

    python 2_preparar_dataset.py --fontes dados/brutos --proprias dados/coletadas --saida dados/iris
"""

import argparse
import hashlib
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

IMAGENS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# As fontes públicas usam nomes próprios. Sem este mapa, "D40" do RDD2022 e
# "pothole" do Roboflow viram classes diferentes do mesmo buraco.
DE_PARA = {
    # RDD2022 (nomenclatura do desafio)
    "D40": "buraco", "D44": "calcada_quebrada", "D20": "calcada_quebrada",
    # Roboflow e congêneres
    "pothole": "buraco", "potholes": "buraco", "hole": "buraco",
    "manhole": "bueiro_aberto", "open-manhole": "bueiro_aberto",
    "stairs": "degrau", "step": "degrau", "curb": "degrau",
    "broken-sidewalk": "calcada_quebrada", "cracked": "calcada_quebrada",
    "construction": "tapume_obra", "barrier": "tapume_obra",
    "tactile": "piso_tatil", "tactile-paving": "piso_tatil",
}


def ler_classes(caminho):
    cfg = yaml.safe_load(Path(caminho).read_text(encoding="utf-8"))
    nomes = [c["nome"] for c in sorted(cfg["classes"], key=lambda c: c["id"])]
    return cfg, nomes, {n: i for i, n in enumerate(nomes)}


def local_de(img, raiz):
    """O 'local' de uma imagem: a pasta imediata, para a coleta própria;
    um balde estável por nome de arquivo, para as fontes públicas (onde não há
    como saber o que é o mesmo lugar)."""
    rel = img.relative_to(raiz)
    if len(rel.parts) > 1:
        return rel.parts[0]
    return "publico-" + hashlib.sha1(img.stem.encode()).hexdigest()[:4]


def reindexar(txt, mapa_origem, indices):
    """Converte um .txt YOLO para os ids do Íris. Descarta linhas de classes
    que não nos interessam — girafa do COCO não entra aqui."""
    saida = []
    for linha in txt.splitlines():
        partes = linha.split()
        if len(partes) < 5:
            continue
        bruto = partes[0]
        nome = mapa_origem.get(bruto, DE_PARA.get(bruto))
        if nome is None or nome not in indices:
            continue
        saida.append(" ".join([str(indices[nome])] + partes[1:]))
    return saida


def coletar(raiz, mapa_origem, indices):
    """Devolve [(imagem, [linhas yolo], local)] de uma árvore."""
    itens = []
    if not raiz or not raiz.exists():
        return itens
    for img in sorted(raiz.rglob("*")):
        if img.suffix.lower() not in IMAGENS:
            continue
        rot = img.with_suffix(".txt")
        if not rot.exists():
            continue
        linhas = reindexar(rot.read_text(encoding="utf-8"), mapa_origem, indices)
        if not linhas:
            continue                      # imagem sem nenhuma classe nossa
        itens.append((img, linhas, local_de(img, raiz)))
    return itens


def dividir(itens, cfg):
    """Divide por LOCAL, e equilibra pelo número de instâncias, não de imagens:
    um local com 200 caixas pesa mais que um com 3."""
    d = cfg["divisao"]
    if d.get("por") != "local":
        print("AVISO: divisão aleatória pedida. Isso vaza o mesmo obstáculo entre "
              "treino e teste e infla a métrica. Veja o cabeçalho deste arquivo.",
              file=sys.stderr)

    por_local = defaultdict(list)
    for it in itens:
        por_local[it[2]].append(it)

    # Ordem estável e maior-primeiro: dois treinos com o mesmo dado produzem a
    # mesma divisão, o que é o mínimo para comparar duas rodadas entre si.
    peso = lambda k: sum(len(i[1]) for i in por_local[k])
    locais = sorted(por_local, key=lambda k: (-peso(k), k))

    total = sum(len(i[1]) for i in itens)
    alvo = {"treino": d["treino"] * total, "validacao": d["validacao"] * total,
            "teste": d["teste"] * total}
    conj = {k: [] for k in alvo}
    soma = {k: 0 for k in alvo}

    # Guloso: cada local inteiro vai para o conjunto que está mais longe da
    # sua cota. Mantém o local indivisível e as proporções próximas do pedido.
    for loc in locais:
        falta = {k: alvo[k] - soma[k] for k in alvo}
        destino = max(falta, key=falta.get)
        conj[destino].extend(por_local[loc])
        soma[destino] += sum(len(i[1]) for i in por_local[loc])
    return conj


def escrever(conj, saida, nomes):
    for parte, itens in conj.items():
        (saida / "images" / parte).mkdir(parents=True, exist_ok=True)
        (saida / "labels" / parte).mkdir(parents=True, exist_ok=True)
        for i, (img, linhas, local) in enumerate(itens):
            base = f"{local}_{i:05d}"
            shutil.copy2(img, saida / "images" / parte / f"{base}{img.suffix.lower()}")
            (saida / "labels" / parte / f"{base}.txt").write_text(
                "\n".join(linhas) + "\n", encoding="utf-8")

    (saida / "dataset.yaml").write_text(yaml.safe_dump({
        "path": str(saida.resolve()),
        "train": "images/treino",
        "val": "images/validacao",
        "test": "images/teste",
        "names": {i: n for i, n in enumerate(nomes)},
    }, allow_unicode=True, sort_keys=False), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fontes", type=Path, help="árvore com os conjuntos públicos já em formato YOLO")
    ap.add_argument("--proprias", type=Path, help="árvore da coleta própria, uma pasta por local")
    ap.add_argument("--saida", type=Path, required=True)
    ap.add_argument("--classes", default="classes.yaml")
    args = ap.parse_args()

    cfg, nomes, indices = ler_classes(args.classes)
    mapa_origem = {n: n for n in nomes}   # quem já vem com o nosso nome passa direto

    publicas = coletar(args.fontes, mapa_origem, indices)
    proprias = coletar(args.proprias, mapa_origem, indices)
    itens = publicas + proprias
    if not itens:
        print("Nenhuma imagem com rótulo das nossas classes foi encontrada.", file=sys.stderr)
        return 1

    conj = dividir(itens, cfg)
    args.saida.mkdir(parents=True, exist_ok=True)
    escrever(conj, args.saida, nomes)

    # ---- o relatório que decide se dá para treinar ----
    print(f"\nImagens: {len(itens)}  ({len(publicas)} públicas, {len(proprias)} próprias)")
    for parte, lista in conj.items():
        caixas = sum(len(i[1]) for i in lista)
        locais = len({i[2] for i in lista})
        print(f"  {parte:10} {len(lista):5} imagens  {caixas:6} caixas  {locais:4} locais")

    cont = Counter()
    for _, linhas, _ in itens:
        for l in linhas:
            cont[nomes[int(l.split()[0])]] += 1

    print("\nInstâncias por classe:")
    magras = []
    for c in cfg["classes"]:
        n = cont.get(c["nome"], 0)
        marca = "" if n >= 1500 else "  <-- POUCO"
        if n < 1500:
            magras.append(c["nome"])
        print(f"  {c['nome']:20} {n:6}{marca}")

    # A proporção de dado próprio é o que decide se o modelo vai funcionar na
    # calçada ou só no para-brisa de quem fotografou o conjunto público.
    frac = len(proprias) / len(itens)
    print(f"\nColeta própria: {frac:.0%} do conjunto")
    if frac < 0.4:
        print("  AVISO: abaixo de 40%, o modelo tende a herdar o ponto de vista do carro,")
        print("  que não é o do pedestre. Colete mais antes de treinar.")
    if magras:
        print(f"  AVISO: classes com menos de 1500 instâncias: {', '.join(magras)}")

    print(f"\n{args.saida / 'dataset.yaml'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
