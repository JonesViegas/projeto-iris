#!/usr/bin/env python3
"""Treina o detector de riscos do Íris.

Em duas fases, porque partir do peso COCO e soltar tudo de uma vez destrói o
que o modelo já sabia sobre borda, sombra e textura — e é justamente isso que
faz valer a pena partir dele:

  Fase 1, congelada (10 épocas): só a cabeça aprende as classes novas. Rápida.
  Fase 2, solta (o resto): tudo ajusta, com taxa baixa.

O aumento de dados está calibrado para o caso real, não para o padrão:

  - `degrees` baixo: a câmera do Íris fica aprumada na mão de quem anda. Girar
    45 graus ensina um mundo que o app nunca vai ver.
  - `fliplr` ligado: buraco não tem lado.
  - `flipud` desligado: tem. Buraco de cabeça para baixo não existe, e ensinar
    isso gasta capacidade do modelo com algo impossível.
  - `hsv_v` alto: sol a pino e sombra de marquise são o mesmo buraco, e essa é
    a variação que mais derruba o modelo na rua.

    python 3_treinar.py --dados dados/iris/dataset.yaml --modelo yolo11s --epocas 120
"""

import argparse
import sys
from pathlib import Path

import yaml


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dados", required=True, help="dataset.yaml gerado pelo passo 2")
    ap.add_argument("--classes", default="classes.yaml")
    ap.add_argument("--modelo", default=None, help="yolo11n | yolo11s | yolo11m")
    ap.add_argument("--epocas", type=int, default=None)
    ap.add_argument("--batch", type=int, default=None)
    ap.add_argument("--imgsz", type=int, default=None)
    ap.add_argument("--nome", default="iris")
    ap.add_argument("--dispositivo", default=0, help="0 para a primeira GPU, 'cpu' para desistir do prazo")
    args = ap.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("Falta o ultralytics: pip install -r requirements.txt", file=sys.stderr)
        return 1

    cfg = yaml.safe_load(Path(args.classes).read_text(encoding="utf-8"))
    t = cfg.get("treino", {})
    base = (args.modelo + ".pt") if args.modelo else t.get("modelo_base", "yolo11s.pt")
    epocas = args.epocas or t.get("epocas", 120)
    congeladas = t.get("epocas_congeladas", 10)
    imgsz = args.imgsz or t.get("imgsz", 640)
    batch = args.batch or t.get("batch", 16)

    aumento = dict(
        degrees=6.0,       # a câmera vai aprumada na mão; mais que isso é fantasia
        translate=0.12,
        scale=0.45,        # a mesma calçada a 1 m e a 6 m
        shear=2.0,
        perspective=0.0005,
        fliplr=0.5,
        flipud=0.0,        # buraco de cabeça para baixo não existe
        hsv_h=0.012, hsv_s=0.6,
        hsv_v=0.55,        # sol a pino e sombra de marquise
        mosaic=1.0,
        close_mosaic=15,   # as últimas épocas sem mosaico: o modelo vê a cena inteira
        erasing=0.2,
    )

    print(f"Fase 1 — cabeça nova, {congeladas} épocas congeladas")
    m = YOLO(base)
    m.train(
        data=args.dados, epochs=congeladas, imgsz=imgsz, batch=batch,
        freeze=10, lr0=0.01, warmup_epochs=2.0,
        project="runs", name=f"{args.nome}-fase1", exist_ok=True,
        device=args.dispositivo, patience=epocas, **aumento,
    )

    print(f"\nFase 2 — ajuste fino, {epocas} épocas")
    m2 = YOLO(Path("runs") / f"{args.nome}-fase1" / "weights" / "last.pt")
    r = m2.train(
        data=args.dados, epochs=epocas, imgsz=imgsz, batch=batch,
        lr0=0.002, lrf=0.01, warmup_epochs=1.0,
        cos_lr=True, patience=t.get("paciencia", 25),
        project="runs", name=args.nome, exist_ok=True,
        device=args.dispositivo, **aumento,
    )

    pesos = Path(r.save_dir) / "weights" / "best.pt"
    print(f"\nPesos: {pesos}")
    print("O mAP que o treino imprime NÃO autoriza nada. Rode agora:")
    print(f"  python 4_validar.py --pesos {pesos} --dados {args.dados}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
