// "Onde estou?" — situar a pessoa antes de guiá-la.
//
// A navegação responde "como chego lá". Antes dela vem uma pergunta que quem
// enxerga nem percebe que faz: "onde estou, e para que lado estou virado?".
// Sem isso, "siga para o leste" e "vire à direita" são instruções soltas no ar.
//
// O módulo junta três fontes, cada uma com o que sabe fazer:
//
//   GPS + geocodificação reversa — a rua, o número aproximado, o bairro.
//   OpenStreetMap (Overpass) — o que há em volta que serve de referência:
//     ponto de ônibus, faixa de pedestre, farmácia, entrada de prédio.
//   Bússola — transforma "a farmácia fica a nordeste" em "a farmácia fica à
//     sua direita", que é o que a pessoa consegue usar.
//
// A câmera entra depois, em app.js: a frase deste módulo vira o começo da
// descrição do que está à frente.
//
// Regras herdadas do resto do app:
//   - Sem bússola, nada de esquerda e direita: pontos cardeais e o aviso de que
//     o rumo é desconhecido. Apontar para o lado errado é pior que não apontar.
//   - Precisão ruim é dita em voz alta. "Você está na Rua X" com 60 m de erro
//     pode ser a rua de trás.
//   - Nenhuma imagem sai daqui. Só coordenadas, para serviços de mapa.
//
// Tudo o que decide é função pura e testada; o que fala com a rede recebe o
// `fetch` por parâmetro para poder ser testado sem rede.

import { distanciaM, rumo, diferencaAngular, cardeal, distanciaFalada } from "./navegacao.js";

// ============================================================
// Direção relativa
// ============================================================

/**
 * Converte a diferença entre o rumo da pessoa e o rumo do alvo em palavras.
 * Faixas largas de propósito: a bússola do celular treme 15 a 20 graus, e
 * "levemente à direita" com esse erro é ruído.
 */
export function direcaoRelativa(delta) {
  const a = Math.abs(delta);
  const lado = delta < 0 ? "esquerda" : "direita";
  if (a <= 25) return "à sua frente";
  if (a <= 65) return `à frente, à ${lado}`;
  if (a <= 115) return `à sua ${lado}`;
  if (a <= 155) return `atrás, à ${lado}`;
  return "atrás de você";
}

/**
 * Onde um ponto está em relação à pessoa. Com rumo conhecido, devolve lado;
 * sem rumo, devolve ponto cardeal — e marca `relativa: false` para quem montar
 * a frase saber que não pode falar em esquerda e direita.
 */
export function posicaoRelativa(origem, alvo, rumoPessoa = null) {
  const d = distanciaM(origem, alvo);
  const r = rumo(origem, alvo);
  if (rumoPessoa == null || !Number.isFinite(rumoPessoa)) {
    return { distanciaM: d, rumo: r, direcao: `ao ${cardeal(r)}`, relativa: false };
  }
  return { distanciaM: d, rumo: r, direcao: direcaoRelativa(diferencaAngular(rumoPessoa, r)), relativa: true };
}

// ============================================================
// Endereço falado
// ============================================================

/** Número de porta arredondado: o reverso erra alguns lotes, "perto do 200" é honesto. */
function numeroAproximado(n) {
  const v = parseInt(String(n ?? "").replace(/\D.*$/, ""), 10);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 20) return v;
  return Math.round(v / 10) * 10;
}

/**
 * Monta "Rua Barão de Melgaço, perto do número 200, no Centro" a partir do
 * endereço estruturado do Nominatim (ou de algo com os mesmos campos).
 */
export function enderecoFalado(end = {}) {
  const via = end.road ?? end.pedestrian ?? end.footway ?? end.path ?? end.square ?? null;
  const bairro = end.suburb ?? end.neighbourhood ?? end.quarter ?? end.city_district ?? null;
  const cidade = end.city ?? end.town ?? end.village ?? end.municipality ?? null;
  const num = numeroAproximado(end.house_number);
  const partes = [];
  if (via) partes.push(num ? `${via}, perto do número ${num}` : via);
  if (bairro) partes.push(`bairro ${bairro}`);
  else if (!via && cidade) partes.push(cidade);
  return partes.join(", ") || null;
}

// ============================================================
// Pontos de referência do OpenStreetMap
// ============================================================

/**
 * Como cada etiqueta do OSM vira palavra, e quanto ela vale como referência
 * para quem não enxerga. Prioridade 0 é o que importa para se locomover
 * (onde atravessar, onde pegar ônibus, onde há piso tátil); 2 é comércio, útil
 * para se situar mas secundário.
 */
const CATALOGO = [
  { t: "highway", v: "bus_stop", nome: "ponto de ônibus", p: 0 },
  { t: "public_transport", v: "platform", nome: "ponto de ônibus", p: 0 },
  { t: "highway", v: "crossing", nome: "faixa de pedestre", p: 0 },
  { t: "highway", v: "traffic_signals", nome: "semáforo", p: 0 },
  { t: "railway", v: "station", nome: "estação", p: 0 },
  { t: "highway", v: "steps", nome: "escada", p: 0 },
  { t: "amenity", v: "hospital", nome: "hospital", p: 1 },
  { t: "amenity", v: "clinic", nome: "posto de saúde", p: 1 },
  { t: "amenity", v: "pharmacy", nome: "farmácia", p: 1 },
  { t: "amenity", v: "bank", nome: "banco", p: 1 },
  { t: "amenity", v: "atm", nome: "caixa eletrônico", p: 2 },
  { t: "amenity", v: "police", nome: "posto policial", p: 1 },
  { t: "amenity", v: "school", nome: "escola", p: 1 },
  { t: "amenity", v: "place_of_worship", nome: "igreja", p: 2 },
  { t: "amenity", v: "townhall", nome: "prefeitura", p: 1 },
  { t: "amenity", v: "post_office", nome: "agência dos Correios", p: 1 },
  { t: "amenity", v: "restaurant", nome: "restaurante", p: 2 },
  { t: "amenity", v: "cafe", nome: "lanchonete", p: 2 },
  { t: "amenity", v: "fast_food", nome: "lanchonete", p: 2 },
  { t: "amenity", v: "toilets", nome: "banheiro público", p: 1 },
  { t: "amenity", v: "bench", nome: "banco de praça", p: 2 },
  { t: "shop", v: "supermarket", nome: "supermercado", p: 1 },
  { t: "shop", v: "bakery", nome: "padaria", p: 2 },
  { t: "shop", v: "convenience", nome: "mercadinho", p: 2 },
  { t: "leisure", v: "park", nome: "praça", p: 2 },
  { t: "entrance", v: "*", nome: "entrada", p: 0 },
  { t: "shop", v: "*", nome: "loja", p: 2 },
];

/** Etiquetas do OSM -> { tipo, nome, prioridade, piso tátil? } ou null. */
export function classificarPonto(tags = {}) {
  for (const c of CATALOGO) {
    const v = tags[c.t];
    if (v == null || v === "no") continue;
    if (c.v !== "*" && v !== c.v) continue;
    return {
      tipo: c.nome,
      nome: tags.name ?? null,
      prioridade: c.p,
      pisoTatil: tags.tactile_paving === "yes",
      sonoro: tags["traffic_signals:sound"] === "yes",
    };
  }
  return null;
}

/** A consulta Overpass para um raio em volta da pessoa. Só nós: leve e rápido. */
export function consultaOverpass({ lat, lng }, raioM = 80) {
  const em = `(around:${Math.round(raioM)},${lat.toFixed(6)},${lng.toFixed(6)})`;
  return `[out:json][timeout:8];(`
    + `node["highway"~"^(bus_stop|crossing|traffic_signals)$"]${em};`
    + `node["public_transport"="platform"]${em};`
    + `node["amenity"]${em};`
    + `node["shop"]${em};`
    + `node["entrance"]${em};`
    + `node["railway"="station"]${em};`
    + `);out body 60;`;
}

/**
 * Escolhe as poucas referências que valem ser faladas. Ordena por prioridade
 * e, dentro dela, por distância. Duas faixas iguais no mesmo quarteirão viram
 * uma só: a mais perto.
 */
export function selecionarReferencias(elementos, origem, rumoPessoa = null, { max = 4, raioM = 80 } = {}) {
  const vistos = new Set();
  return (elementos ?? [])
    .map((e) => {
      const c = classificarPonto(e.tags);
      if (!c || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return null;
      const pos = posicaoRelativa(origem, { lat: e.lat, lng: e.lon }, rumoPessoa);
      return { ...c, ...pos, lat: e.lat, lng: e.lon };
    })
    .filter((r) => r && r.distanciaM <= raioM)
    .sort((a, b) => a.prioridade - b.prioridade || a.distanciaM - b.distanciaM)
    .filter((r) => {
      const chave = `${r.tipo}|${r.nome ?? ""}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .slice(0, max);
}

/** "farmácia Pague Menos, à sua direita, a 15 metros, uns 20 passos" */
export function referenciaFalada(r) {
  const nome = r.nome && r.nome.toLowerCase() !== r.tipo ? `${r.tipo} ${r.nome}` : r.tipo;
  const extra = [r.pisoTatil ? "com piso tátil" : null, r.sonoro ? "com sinal sonoro" : null]
    .filter(Boolean).join(" e ");
  const dist = r.distanciaM < 4 ? "bem perto" : `a ${distanciaFalada(r.distanciaM)}`;
  return `${nome}${extra ? `, ${extra}` : ""}, ${r.direcao}, ${dist}`;
}

// ============================================================
// A frase
// ============================================================

export const PRECISAO_BOA_M = 20;
export const PRECISAO_RUIM_M = 50;

/**
 * Monta o que a pessoa ouve. Ordem fixa — lugar, confiança, rumo, referências —
 * para que, depois de duas ou três vezes, ela saiba onde cada informação vem.
 */
export function fraseOndeEstou({
  endereco = null, precisaoM = null, rumoPessoa = null, referencias = [], familiar = null,
} = {}) {
  const frases = [];

  if (familiar) frases.push(`Este lugar parece ser ${familiar}.`);

  if (endereco) frases.push(`Você está na ${endereco}.`);
  else frases.push("Não consegui o nome da rua aqui.");

  if (precisaoM != null && precisaoM > PRECISAO_RUIM_M) {
    frases.push(`O sinal de GPS está fraco, erro de uns ${Math.round(precisaoM / 10) * 10} metros. Pode ser a rua ao lado.`);
  } else if (precisaoM != null && precisaoM > PRECISAO_BOA_M) {
    frases.push(`Precisão de uns ${Math.round(precisaoM / 5) * 5} metros.`);
  }

  if (rumoPessoa != null && Number.isFinite(rumoPessoa)) {
    frases.push(`Você está virado para o ${cardeal(rumoPessoa)}.`);
  } else {
    frases.push("Não sei para que lado você está virado, então indico pelos pontos cardeais.");
  }

  if (referencias.length) {
    frases.push(`Perto de você: ${referencias.map(referenciaFalada).join("; ")}.`);
  } else {
    frases.push("Não achei pontos de referência no mapa aqui perto.");
  }

  return frases.join(" ");
}

// ============================================================
// Rede (com fetch injetável)
// ============================================================

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";

let ultimaNominatim = 0;
async function cotaNominatim() {
  const espera = 1100 - (Date.now() - ultimaNominatim);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaNominatim = Date.now();
}

/** Endereço estruturado do ponto, ou null. */
export async function reverso({ lat, lng }, { fetch: f = globalThis.fetch, timeoutMs = 8000 } = {}) {
  await cotaNominatim();
  const u = new URL(`${NOMINATIM}/reverse`);
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("zoom", "18");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("accept-language", "pt-BR");
  const r = await f(u, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("geocodificação indisponível");
  const j = await r.json();
  return j?.address ?? null;
}

/** Nós do OSM em volta, crus. */
export async function pontosProximos(pos, { fetch: f = globalThis.fetch, raioM = 80, timeoutMs = 9000 } = {}) {
  const r = await f(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(consultaOverpass(pos, raioM))}`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error("mapa de referências indisponível");
  const j = await r.json();
  return j?.elements ?? [];
}

/**
 * Tudo junto. Cada fonte falha sozinha: sem Overpass ainda há endereço; sem
 * endereço ainda há referências. Devolve a frase e os dados, para o app
 * mostrar na tela e mandar como contexto à descrição detalhada.
 */
export async function ondeEstou(pos, { rumoPessoa = null, familiar = null, fetch: f, raioM = 80 } = {}) {
  const [end, nos] = await Promise.allSettled([
    reverso(pos, { fetch: f }),
    pontosProximos(pos, { fetch: f, raioM }),
  ]);
  const endereco = end.status === "fulfilled" ? enderecoFalado(end.value ?? {}) : null;
  const referencias = nos.status === "fulfilled"
    ? selecionarReferencias(nos.value, pos, rumoPessoa, { raioM })
    : [];
  const texto = fraseOndeEstou({ endereco, precisaoM: pos.precisaoM ?? null, rumoPessoa, referencias, familiar });
  return { texto, endereco, referencias, falhas: [end, nos].filter((x) => x.status === "rejected").length };
}
