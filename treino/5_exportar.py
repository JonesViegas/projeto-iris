#!/usr/bin/env python3
"""Exporta o modelo treinado para rodar no celular, dentro do PWA.

Três formatos, três usos:

  tflite  — o que o MediaPipe do app já sabe carregar. É o caminho curto:
            entra em `MODELOS`, no app.js, ao lado dos EfficientDet.
  onnx    — para o transformers.js, se um dia o detector migrar para lá.
  ncnn    — menor e mais rápido em ARM, mas exige ponte própria. Não use sem
            necessidade medida.

Sobre o `--int8`: a quantização corta o tamanho em ~4x e o tempo pela metade,
e custa precisão. Quanto, ninguém sabe sem medir — e o quanto importa aqui,
porque o que se perde primeiro são as detecções de baixa confiança, que são
justamente as de objeto pequeno e longe. Por isso este script obriga a rodar
`4_validar.py` de novo depois. Exportar quantizado sem revalidar é desfazer a
validação em silêncio.

    python 5_exportar.py --pesos runs/iris/weights/best.pt --formato tflite --int8
"""

import argparse
import shutil
import sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pesos", required=True)
    ap.add_argument("--formato", default="tflite", choices=["tflite", "onnx", "ncnn"])
    ap.add_argument("--int8", action="store_true", help="quantiza; exige --dados para calibrar")
    ap.add_argument("--dados", help="dataset.yaml, usado como conjunto de calibração do int8")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--saida", type=Path, default=Path("modelos"))
    ap.add_argument("--nome", default="iris-riscos-v1")
    args = ap.parse_args()

    if args.int8 and not args.dados:
        print("--int8 precisa de --dados: a quantização calibra com imagens reais.\n"
              "Sem calibrar, ela usa faixas genéricas e o modelo despenca.", file=sys.stderr)
        return 1

    try:
        from ultralytics import YOLO
    except ImportError:
        print("Falta o ultralytics: pip install -r requirements.txt", file=sys.stderr)
        return 1

    modelo = YOLO(args.pesos)
    caminho = modelo.export(
        format=args.formato, imgsz=args.imgsz, int8=args.int8,
        data=args.dados if args.int8 else None, nms=True,
    )

    args.saida.mkdir(parents=True, exist_ok=True)
    origem = Path(caminho)
    destino = args.saida / f"{args.nome}{origem.suffix}"
    if origem.is_dir():
        destino = args.saida / args.nome
        shutil.copytree(origem, destino, dirs_exist_ok=True)
        tamanho = sum(f.stat().st_size for f in destino.rglob("*") if f.is_file())
    else:
        shutil.copy2(origem, destino)
        tamanho = destino.stat().st_size

    mb = tamanho / 1_000_000
    print(f"\n{destino}  —  {mb:.1f} MB")
    if mb > 15:
        print("AVISO: acima de 15 MB o primeiro uso no 4G fica doloroso e o Safari")
        print("do iPhone começa a derrubar o app por memória. Considere o yolo11n.")

    print("\nPara ligar no app:")
    print(f"  1. copie para /opt/iris/web/modelos/{destino.name}")
    print("  2. no app.js, acrescente em MODELOS:")
    print(f'       riscos: "/modelos/{destino.name}",')
    print('  3. no index.html, acrescente a opção no <select id="selModelo">')
    print("  4. no sw.js, suba a VERSION — senão o testador continua com a versão velha")

    if args.int8:
        print("\nA quantização mexeu nos pesos. Revalide ANTES de publicar:")
        print(f"  python 4_validar.py --pesos {destino} --dados {args.dados}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
