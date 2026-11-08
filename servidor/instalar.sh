#!/usr/bin/env bash
# Instala o proxy da descrição/conversa do Projeto Íris na sgcobra.
#
# Rode NO SERVIDOR, como ubuntu (sudo sem senha):
#   ANTHROPIC_API_KEY=sk-ant-... bash instalar.sh
#
# Ou, se a chave já estiver em /etc/iris/descricao.env, sem variável nenhuma:
#   bash instalar.sh
#
# É idempotente: rodar duas vezes não quebra nada. Só a chave é que não é
# sobrescrita por engano — para trocá-la, edite /etc/iris/descricao.env.
set -euo pipefail

DESTINO=/opt/iris/servidor
ENVDIR=/etc/iris
ENVFILE="$ENVDIR/descricao.env"
UNIDADE=/etc/systemd/system/iris-descricao.service
VHOST=/etc/nginx/sites-available/iris
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> usuário de serviço"
# Sem shell e sem home: este processo só precisa falar na porta 8787.
id iris >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin iris

echo "==> arquivos em $DESTINO"
sudo mkdir -p "$DESTINO"
sudo cp "$AQUI/proxy-descricao.mjs" "$AQUI/package.json" "$DESTINO/"
sudo chown -R iris:iris "$DESTINO"

echo "==> dependências"
# npm precisa escrever em node_modules; roda como iris para não deixar root lá.
sudo -u iris env HOME="$DESTINO" npm --prefix "$DESTINO" install --omit=dev --no-audit --no-fund

echo "==> chave"
sudo mkdir -p "$ENVDIR"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  # umask antes do redirecionamento: o arquivo nunca chega a existir legível.
  sudo install -m 600 -o root -g root /dev/null "$ENVFILE"
  printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" | sudo tee "$ENVFILE" >/dev/null
  echo "    chave gravada em $ENVFILE (modo 600)"
elif sudo test -s "$ENVFILE"; then
  echo "    $ENVFILE já existe; mantido"
else
  echo "ERRO: sem ANTHROPIC_API_KEY no ambiente e sem $ENVFILE." >&2
  echo "      Rode: ANTHROPIC_API_KEY=sk-ant-... bash instalar.sh" >&2
  exit 1
fi
sudo chmod 600 "$ENVFILE"

echo "==> serviço"
sudo tee "$UNIDADE" >/dev/null <<'UNIT'
[Unit]
Description=Proxy da descrição e da conversa do Projeto Íris
After=network.target

[Service]
Type=simple
User=iris
WorkingDirectory=/opt/iris/servidor
Environment=PORTA=8787
Environment=ORIGENS=https://iris.viegastechs.com.br
EnvironmentFile=/etc/iris/descricao.env
ExecStart=/usr/bin/node proxy-descricao.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now iris-descricao
sleep 1
sudo systemctl is-active --quiet iris-descricao || { sudo journalctl -u iris-descricao -n 30 --no-pager; exit 1; }

echo "==> saúde do proxy"
curl -fsS http://127.0.0.1:8787/saude && echo

echo "==> nginx"
# As duas rotas ficam num arquivo só, incluído pelo vhost. Assim este script
# nunca reescreve o vhost — ele só garante a linha de include.
sudo tee /etc/nginx/snippets/iris-api.conf >/dev/null <<'NGINX'
# Rotas do proxy do Íris. Nada aqui entra em cache: a resposta é de um
# instante só, e guardar a foto de alguém não é opção.
location /api/descrever {
    proxy_pass http://127.0.0.1:8787/descrever;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 4m;
    proxy_read_timeout 60s;
}
location /api/conversar {
    proxy_pass http://127.0.0.1:8787/conversar;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 4m;
    proxy_read_timeout 60s;
}
NGINX

if ! sudo grep -q "snippets/iris-api.conf" "$VHOST"; then
  echo "    falta o include no vhost. Acrescente DENTRO do bloco server {} de $VHOST:"
  echo
  echo "        include snippets/iris-api.conf;"
  echo
  echo "    e depois: sudo nginx -t && sudo systemctl reload nginx"
else
  sudo nginx -t && sudo systemctl reload nginx
  echo "    nginx recarregado"
fi

echo
echo "Pronto. Teste de fora:"
echo "  curl -s https://iris.viegastechs.com.br/api/descrever -X POST \\"
echo "       -H 'Content-Type: application/json' -d '{}'"
echo "  (deve responder {\"erro\":\"imagem ausente\"} — isso já prova que a rota chega ao proxy)"
echo
echo "No app: Ajustes -> Descrição detalhada, endereço https://iris.viegastechs.com.br/api/descrever"
