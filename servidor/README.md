# Proxy da descrição detalhada

Processo pequeno que guarda a chave da API e fala com o modelo de visão. O PWA fala com
ele; ele fala com o modelo. É a única peça do Íris que fica fora do aparelho do usuário.

**Ele só é necessário se a descrição detalhada for usada.** Sem ele, o app continua
inteiro: detecção, distância, semáforo, piso, OCR, navegação a pé e descrição local
funcionam sem internet depois do primeiro uso, e nenhuma imagem sai do aparelho.

---

## Por que não colocar a chave no PWA

Porque não existe "esconder" nada num PWA. O código roda no navegador do usuário e
qualquer pessoa abre as ferramentas de desenvolvedor e copia a chave em dez segundos.
Chave copiada é fatura sua. Por isso o `nuvem.js` não tem campo de chave: só campo de
endereço do proxy.

---

## Subir

```bash
cd servidor
npm install
export ANTHROPIC_API_KEY=sk-ant-...
node proxy-descricao.mjs           # escuta em 127.0.0.1:8787
```

Variáveis:

| | |
|---|---|
| `ANTHROPIC_API_KEY` | obrigatória |
| `PORTA` | 8787 |
| `ORIGENS` | origens aceitas, separadas por vírgula |

## De onde vem a chave

A chave é do **Console** (`platform.claude.com`), não do app do Claude. São contas
separadas, com cobrança separada.

O detalhe que importa aqui: os planos **Max, Ultra e Team incluem créditos mensais de
API**, que só precisam ser reivindicados. No Team são 20 dólares por assento padrão e
100 por assento premium, somados num saldo único do time, com teto de 500. Quem
reivindica é o Primary Owner ou um Owner do time, ligando o time a uma organização do
Console; do lado do Console é preciso papel de Owner, Admin ou Billing. Assinantes
novos só conseguem depois de sete dias no plano. O crédito não usado expira no fim do
ciclo, e quando acaba as chamadas param até o mês seguinte (a menos que a organização
compre crédito ou ligue recarga automática) — nunca cai na fatura do plano do Claude.
Cada plano liga a **uma** organização do Console, e mudar isso depois exige falar com o
suporte.

### Quanto custa uma conversa

Cada turno manda uma foto de 1024 px de largura (`LARGURA_MAX` em `nuvem.js`), o prompt
de sistema, o contexto do detector e até seis turnos de histórico em texto. Dá da ordem
de 2.600 tokens de entrada e 120 de saída por turno.

| Modelo | Por turno | Conversa de 10 turnos | O que 20 dólares compram |
|---|---|---|---|
| `claude-opus-5-5` (o que está no código) | ~US$ 0,013 | ~US$ 0,13 | ~150 conversas |
| `claude-haiku-5-5` | ~US$ 0,0003 | ~US$ 0,003 | ~6.000 conversas |

São estimativas, não medições — o número real sai do `console.log` de uso que o proxy
já escreve a cada chamada (`entrada=` e `saída=`). A troca de modelo é uma linha
(`MODELO`, no topo do `proxy-descricao.mjs`) e é uma decisão de projeto: o Opus lê a
cena bem melhor, que é justamente o que esta aplicação precisa; o Haiku responde mais
rápido e cabe num crédito apertado. Em piloto com usuários, meça antes de decidir.

## Como serviço, na sgcobra

O jeito curto, com tudo junto (usuário de serviço, dependências, chave em arquivo 600,
unidade do systemd, rotas do nginx e teste de saúde):

```bash
# na sua máquina
scp servidor/*.mjs servidor/package.json servidor/instalar.sh sgcobra:/tmp/iris-servidor/
# no servidor
ssh sgcobra 'cd /tmp/iris-servidor && ANTHROPIC_API_KEY=sk-ant-... bash instalar.sh'
```

O script é idempotente e **não sobrescreve a chave** se ela já existir em
`/etc/iris/descricao.env`. O que ele faz por dentro está descrito abaixo.

### O mesmo, à mão

```ini
# /etc/systemd/system/iris-descricao.service
[Unit]
Description=Proxy da descrição do Projeto Íris
After=network.target

[Service]
Type=simple
User=iris
WorkingDirectory=/opt/iris/servidor
Environment=PORTA=8787
Environment=ORIGENS=https://iris.viegastechs.com.br
EnvironmentFile=/etc/iris/descricao.env    # ANTHROPIC_API_KEY=... chmod 600
ExecStart=/usr/bin/node proxy-descricao.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now iris-descricao
```

No vhost `/etc/nginx/sites-available/iris`:

```nginx
location /api/descrever {
    proxy_pass http://127.0.0.1:8787/descrever;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 4m;
    proxy_read_timeout 30s;
}
# Conversa por voz (0.12): mesma chave, mesmo limite de uso
location /api/conversar {
    proxy_pass http://127.0.0.1:8787/conversar;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 4m;
    proxy_read_timeout 30s;
}
```

Teste: `curl https://iris.viegastechs.com.br/api/descrever` deve responder 404 do
proxy (rota só aceita POST), e `curl http://127.0.0.1:8787/saude` deve devolver JSON.

---

## Custo

Uma pergunta da conversa custa parecido com uma descrição (uma foto, resposta mais curta, mais
umas centenas de fichas de histórico em texto).

Uma descrição manda uma foto de 1024 px e recebe de três a cinco frases. Dá em torno de
1.600 fichas de entrada e 150 de saída. Com o `claude-opus-5-5` configurado
(US$ 4,00 por milhão de entrada e US$ 20,00 de saída), sai perto de **US$ 0,009 por
descrição** — cerca de mil descrições por dez dólares.

Se o piloto crescer e o custo pesar, trocar `MODELO` para `claude-haiku-5-5`
(US$ 0,10 / US$ 0,50 por milhão) derruba para cerca de **US$ 0,0003** por descrição, e
responde bem mais rápido — o que, para alguém parado na calçada esperando, vale por si.
A descrição fica mais simples. É uma linha no arquivo.

O limite embutido é de 20 chamadas por minuto por IP. Numa rede móvel vários usuários
compartilham o mesmo IP, então, se o piloto crescer, troque o limite por IP por um
limite por aparelho (um identificador gerado no app e enviado no corpo).

---

## O que o proxy registra

Só número: fichas de entrada, fichas de saída, horário, e o erro quando falha.

**Nunca a imagem. Nunca o texto da descrição.** Para onde a pessoa aponta a câmera é
assunto dela — e um registro desses, num piloto com usuários cegos, seria um arquivo do
cotidiano de pessoas que confiaram no app. Se você precisar depurar uma descrição ruim,
peça à pessoa que reproduza com você junto, e não ligue registro de conteúdo.
