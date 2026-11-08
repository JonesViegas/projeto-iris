#!/usr/bin/env bash
# Monta o simulador de voz num arquivo HTML único, com o motor embutido.
#   bash simulador/montar.sh            -> simulador/simulador.html
# Abra o resultado no celular (sirva com `npx serve .`) ou publique como página.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
printf 'import { CENARIOS } from "%s/motor.js";\nwindow.IRIS_SIM = CENARIOS.map((c) => ({ ...c, linhas: c.gerar() }));\n' "$PWD" > "$tmp/entrada.js"
npx -y esbuild@0.24.0 "$tmp/entrada.js" --bundle --format=iife --minify --log-level=warning --outfile="$tmp/motor.js"
node -e '
const fs = require("fs");
const [pag, motor, saida] = process.argv.slice(1);
const corpo = fs.readFileSync(pag, "utf8").replace("/*MOTOR*/", () => fs.readFileSync(motor, "utf8"));
// Versão para publicar como Artifact (o esqueleto é posto na publicação) e
// versão completa, para abrir direto no navegador ou servir do próprio site.
fs.writeFileSync(saida.replace(".html", "-artifact.html"), corpo);
fs.writeFileSync(saida, "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n"
  + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n</head>\n<body>\n"
  + corpo + "\n</body>\n</html>\n");
' pagina.html "$tmp/motor.js" simulador.html
rm -rf "$tmp"
echo "simulador/simulador.html"
