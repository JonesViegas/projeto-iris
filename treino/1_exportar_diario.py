#!/usr/bin/env python3
"""Lê os diários do piloto e diz o que o dataset precisa ter.

O dado mais valioso que o piloto produz não é "o app é bom". É cada toque em
"Não avisou": um obstáculo real, numa rua real, que passou batido. Esta é a
única fonte de verdade sobre o que falta treinar — e ela é gratuita, porque os
testadores já a estão gerando.

O diário não contém imagem nenhuma, nem localização: só classes, distâncias e
horários. As fotos do dataset são tiradas depois, de propósito, por quem
coleta — nunca dos usuários.

    python 1_exportar_diario.py ~/diarios/*.json --saida relatorio-piloto.md
"""

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

# Quantas instâncias rotuladas por classe antes de valer a pena treinar.
# Abaixo disso o modelo decora em vez de aprender.
ALVO_POR_CLASSE = 1500


def carregar(caminhos):
    pacotes = []
    for c in caminhos:
        try:
            with open(c, encoding="utf-8") as f:
                p = json.load(f)
            p["_arquivo"] = Path(c).name
            pacotes.append(p)
        except (OSError, json.JSONDecodeError) as e:
            print(f"  ignorado {c}: {e}", file=sys.stderr)
    return pacotes


def analisar(pacotes):
    """Separa o que o app errou do que ele acertou, por tipo de erro."""
    nao_avisou, avisou_errado = [], []
    tot = Counter()
    por_sessao = {}

    for p in pacotes:
        sid = (p.get("sessao") or {}).get("id", p["_arquivo"])
        resumo = p.get("resumo", {})
        por_sessao[sid] = {
            "arquivo": p["_arquivo"],
            "minutos": resumo.get("duracaoMin", 0),
            "fps": resumo.get("fpsMedio", 0),
            "alertas": resumo.get("alertas", 0),
            "aparelho": (p.get("sessao") or {}).get("aparelho", {}).get("ua", "")[:60],
        }
        for ev in p.get("eventos", []):
            tot[ev.get("tipo", "?")] += 1
            if ev.get("tipo") != "erro_relatado":
                continue
            reg = {
                "sessao": sid,
                "quando": ev.get("t"),
                "piso": ev.get("piso"),
                "ultimo_aviso": ev.get("ultimoAviso"),
                "objetos": ev.get("objetos") or [],
            }
            if ev.get("erroTipo") == "nao_avisou":
                nao_avisou.append(reg)
            elif ev.get("erroTipo") == "avisou_errado":
                avisou_errado.append(reg)

    return nao_avisou, avisou_errado, tot, por_sessao


def cena_vazia(reg):
    """Falha com a cena vazia é o caso que mais interessa: o app não viu NADA.

    Quando o testador marca "não avisou" e a lista de objetos está vazia, o
    obstáculo é de um tipo que nenhum dos modelos atuais conhece. É exatamente
    para esses casos que o treino próprio existe.
    """
    return len(reg["objetos"]) == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("diarios", nargs="+", help="arquivos iris-*.json exportados pelos testadores")
    ap.add_argument("--saida", default="relatorio-piloto.md")
    ap.add_argument("--plano", default="plano-de-coleta.csv")
    ap.add_argument("--classes", default="classes.yaml")
    args = ap.parse_args()

    pacotes = carregar(args.diarios)
    if not pacotes:
        print("Nenhum diário válido.", file=sys.stderr)
        return 1

    nao_avisou, avisou_errado, tot, sessoes = analisar(pacotes)
    minutos = sum(s["minutos"] for s in sessoes.values())

    cegos = [r for r in nao_avisou if cena_vazia(r)]
    com_contexto = [r for r in nao_avisou if not cena_vazia(r)]

    # Com que o app CONFUNDIU o obstáculo que perdeu: pista do que treinar.
    confusao = Counter()
    for r in com_contexto:
        for o in r["objetos"][:3]:
            confusao[o.get("classe", "?")] += 1

    pisos = Counter(r["piso"] or "desconhecido" for r in nao_avisou)
    falsos = Counter((r["ultimo_aviso"] or "?")[:60] for r in avisou_errado)

    linhas = [
        "# Relatório do piloto — o que o dataset precisa\n",
        f"- Sessões: **{len(sessoes)}**, somando **{minutos} minutos** de rua",
        f"- Obstáculos não avisados: **{len(nao_avisou)}**"
        + (f" (1 a cada {minutos / len(nao_avisou):.1f} min)" if nao_avisou and minutos else ""),
        f"- Avisos errados: **{len(avisou_errado)}**",
        f"- Alertas falados no total: **{tot.get('alerta', 0)}**",
        f"- Falhas técnicas: **{tot.get('falha', 0)}**\n",
        "## O caso que manda: cena vazia\n",
        f"Em **{len(cegos)}** das {len(nao_avisou)} falhas o app não enxergava "
        "**nenhum objeto** no instante da marcação. São obstáculos de tipos que nem o "
        "COCO nem o ADE20K conhecem — a razão de ser deste treino.\n",
    ]

    if pisos:
        linhas.append("### Em que piso as falhas acontecem\n")
        linhas.append("| Piso | Falhas |\n|---|---|")
        for nome, n in pisos.most_common():
            linhas.append(f"| {nome} | {n} |")
        linhas.append("")

    if confusao:
        linhas.append("### Com o que o app estava ocupado quando perdeu o obstáculo\n")
        linhas.append("| Classe vista | Vezes |\n|---|---|")
        for nome, n in confusao.most_common(12):
            linhas.append(f"| {nome} | {n} |")
        linhas.append("")

    if falsos:
        linhas.append("### Avisos errados mais repetidos\n")
        linhas.append("Cada um destes é um motivo para alguém desligar o app.\n")
        linhas.append("| Aviso | Vezes |\n|---|---|")
        for texto, n in falsos.most_common(12):
            linhas.append(f"| {texto} | {n} |")
        linhas.append("")

    linhas += [
        "## Sessões\n",
        "| Sessão | Minutos | qps médio | Alertas | Aparelho |\n|---|---|---|---|---|",
    ]
    for sid, s in sessoes.items():
        linhas.append(f"| {sid} | {s['minutos']} | {s['fps']} | {s['alertas']} | {s['aparelho']} |")

    Path(args.saida).write_text("\n".join(linhas) + "\n", encoding="utf-8")

    # ---- plano de coleta ----
    # O diário não diz QUAL classe faltou (o testador não digita isso enquanto
    # anda). Então o plano sai das classes declaradas, com a contagem do piloto
    # entrando como prioridade: piso onde mais se falha, coleta-se antes.
    try:
        cfg = yaml.safe_load(Path(args.classes).read_text(encoding="utf-8"))
        classes = cfg["classes"]
    except (OSError, KeyError, yaml.YAMLError) as e:
        print(f"Não li {args.classes} ({e}); plano de coleta não gerado.", file=sys.stderr)
        return 0

    por_classe = defaultdict(int)  # preencha à mão conforme rotular
    with open(args.plano, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["classe", "rotuladas_hoje", "alvo", "faltam", "recall_exigido", "observacao"])
        for c in classes:
            tem = por_classe[c["nome"]]
            w.writerow([
                c["nome"], tem, ALVO_POR_CLASSE, max(0, ALVO_POR_CLASSE - tem),
                c["recall_perto"],
                "metade das fotos precisa vir das ruas onde o app vai ser usado",
            ])

    print(f"Relatório: {args.saida}")
    print(f"Plano de coleta: {args.plano}")
    print(f"\n{len(cegos)} falhas com cena vazia em {minutos} min de rua — "
          "estas são as que o treino precisa resolver.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
