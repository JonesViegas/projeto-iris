// Proxy da descrição detalhada do Íris.
//
// Existe por um motivo só: a chave da API não pode morar no PWA. Um PWA é
// código aberto no navegador de quem usa — qualquer pessoa abre as ferramentas
// de desenvolvedor e copia a chave. Então o app fala com este processo, que
// roda no servidor do projeto, e só ele conhece a chave.
//
// Ele também é o lugar certo para três coisas que o navegador não pode garantir:
// limite de uso por aparelho, política de privacidade aplicada de verdade
// (nada de imagem em disco, nada em log), e o texto do prompt sob controle do
// projeto, não do cliente.
//
// Rodar:
//   cd servidor && npm install && ANTHROPIC_API_KEY=sk-ant-... node proxy-descricao.mjs
//
// Atrás do nginx, com o app em https://iris.viegastechs.com.br:
//   location /api/descrever { proxy_pass http://127.0.0.1:8787/descrever; }

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORTA = Number(process.env.PORTA ?? 8787);
const ORIGENS = (process.env.ORIGENS ?? "https://iris.viegastechs.com.br,http://localhost:3000")
  .split(",").map((s) => s.trim());

// Opus 5.5 é o modelo mais capaz da faixa e dá a melhor leitura espacial de
// uma cena. Se a latência na rua pesar mais que a riqueza da descrição,
// claude-haiku-5-5 responde bem mais rápido e custa uma fração — é uma troca
// legítima para este caso, e basta mudar esta linha.
const MODELO = "claude-opus-5-5";
const MAX_TOKENS = 500;          // descrição falada: curta de propósito
const LIMITE_CORPO = 3 * 1024 * 1024;

const cliente = new Anthropic();   // lê ANTHROPIC_API_KEY do ambiente

// ============================================================
// O prompt
// ============================================================
// Vale mais do que o resto do arquivo. Um modelo de visão solto descreve a
// imagem como quem escreve legenda de foto: "uma cena urbana movimentada ao
// entardecer". Isso é inútil para quem precisa atravessar a sala.

const SISTEMA = `Você descreve o ambiente para uma pessoa cega que está no local, segurando o celular à frente do corpo. Ela não vê nada: sua descrição é a visão dela.

Como descrever:
- Comece pelo que importa para se locomover e se situar, não pelo que é bonito.
- Organize no espaço, da esquerda para a direita, e diga o que está perto antes do que está longe. Use "à sua esquerda", "bem à frente", "à sua direita".
- Dê o caminho livre quando houver: por onde dá para andar sem esbarrar.
- Diga onde ficam portas, balcões, filas, escadas, degraus, corrimãos, assentos livres e placas com texto legível.
- Texto de placa ou letreiro: leia literalmente, entre aspas.
- Seja concreto e curto. De três a cinco frases faladas. Nada de introdução nem de "nesta imagem vemos".

Limites que você não ultrapassa:
- Nunca diga que é seguro atravessar, avançar ou descer. Você vê um instante, não vê o trânsito. Descreva o semáforo e a faixa; a decisão é de quem está lá.
- Não descreva raça, etnia, provável religião, peso, beleza, orientação, deficiência aparente ou estado de saúde de ninguém. Diga "uma pessoa", "duas pessoas", "alguém de uniforme" quando o uniforme importa para a tarefa.
- Não tente identificar ninguém pelo nome.
- Não invente. Se a imagem estiver escura, tremida ou cortada, diga isso em uma frase e descreva só o que dá para ver.

Responda em português do Brasil, em texto corrido, pronto para ser lido em voz alta. Sem listas, sem marcadores, sem títulos.`;

function instrucaoDoContexto(ctx) {
  if (!ctx) return "Descreva o ambiente.";
  const partes = [];
  if (Array.isArray(ctx.objetos) && ctx.objetos.length) {
    const txt = ctx.objetos
      .map((o) => `${o.classe}${o.direcao ? ` ${o.direcao}` : ""}${o.metros != null ? ` a ${o.metros} m` : ""}`)
      .join("; ");
    // A escala métrica vem do detector local, que mede; o modelo de visão não
    // tem como medir. Dar os números a ele evita que ele chute distâncias.
    partes.push(`O aplicativo já detectou, com medição de distância no próprio aparelho: ${txt}. `
      + `Use essas distâncias em vez de estimar as suas.`);
  }
  if (ctx.piso) partes.push(`O piso logo à frente foi identificado como ${ctx.piso}.`);
  if (ctx.navegando) partes.push(`A pessoa está indo a pé para ${ctx.navegando}.`);
  partes.push("Descreva o ambiente.");
  return partes.join(" ");
}

// ============================================================
// Limite de uso
// ============================================================
// Sem isto, uma aba esquecida aberta consome a cota do projeto inteiro.

const janelas = new Map();
const LIMITE = 20;            // chamadas
const JANELA_MS = 60 * 1000;

function dentroDaCota(ip) {
  const agora = Date.now();
  const atual = janelas.get(ip)?.filter((t) => agora - t < JANELA_MS) ?? [];
  if (atual.length >= LIMITE) return false;
  atual.push(agora);
  janelas.set(ip, atual);
  return true;
}
setInterval(() => {
  const agora = Date.now();
  for (const [ip, ts] of janelas) {
    const vivos = ts.filter((t) => agora - t < JANELA_MS);
    if (vivos.length) janelas.set(ip, vivos); else janelas.delete(ip);
  }
}, JANELA_MS).unref();

// ============================================================
// Servidor
// ============================================================

function cors(req, res) {
  const origem = req.headers.origin;
  if (origem && ORIGENS.includes(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function responder(res, status, corpo) {
  const txt = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(txt);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > LIMITE_CORPO) { reject(new Error("corpo grande demais")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString("utf8"))); }
      catch { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

const servidor = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "GET" && req.url === "/saude") { responder(res, 200, { ok: true, modelo: MODELO }); return; }
  if (req.method !== "POST" || !req.url.startsWith("/descrever")) { responder(res, 404, { erro: "rota desconhecida" }); return; }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim()
    ?? req.socket.remoteAddress ?? "desconhecido";
  if (!dentroDaCota(ip)) { responder(res, 429, { erro: "limite de uso atingido" }); return; }

  let corpo;
  try { corpo = await lerCorpo(req); }
  catch (e) { responder(res, 400, { erro: e.message }); return; }

  if (typeof corpo?.imagem !== "string" || corpo.imagem.length < 100) {
    responder(res, 400, { erro: "imagem ausente" });
    return;
  }

  try {
    const resposta = await cliente.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: SISTEMA,
      // Descrição falada que alguém espera de pé na rua: latência pesa mais do
      // que profundidade de raciocínio. Em Opus 5.5 o pensamento não desliga,
      // então o controle é o esforço.
      output_config: { effort: "low" },
      // Se um classificador de segurança recusar, o servidor tenta outro
      // modelo sozinho em vez de devolver silêncio a quem está na calçada.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: corpo.imagem } },
          { type: "text", text: instrucaoDoContexto(corpo.contexto) },
        ],
      }],
    });

    if (resposta.stop_reason === "refusal") {
      responder(res, 200, {
        texto: "Não consegui descrever esta cena. Tente apontar a câmera um pouco diferente.",
        recusado: true,
      });
      return;
    }

    const texto = resposta.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    // Nunca registramos a imagem nem o texto da descrição: o que a pessoa
    // aponta a câmera é assunto dela. Só os números de uso.
    console.log(`[${new Date().toISOString()}] descrição ok `
      + `entrada=${resposta.usage.input_tokens} saída=${resposta.usage.output_tokens}`);

    responder(res, 200, { texto: texto || "Não consegui descrever esta cena." });
  } catch (e) {
    const status = e?.status ?? 500;
    console.error(`[${new Date().toISOString()}] falha ${status}: ${e?.message ?? e}`);
    if (status === 429) { responder(res, 429, { erro: "serviço ocupado" }); return; }
    responder(res, 502, { erro: "o serviço de descrição falhou" });
  }
});

servidor.listen(PORTA, "127.0.0.1", () => {
  console.log(`Proxy de descrição do Íris em http://127.0.0.1:${PORTA} — modelo ${MODELO}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("AVISO: ANTHROPIC_API_KEY não está no ambiente. As chamadas vão falhar.");
  }
});
