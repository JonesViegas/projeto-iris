// Traçado de rota a pé, com dois provedores e uma saída só.
//
// O Google tem a melhor cobertura de calçada, travessia e ponto comercial no
// Brasil, mas exige chave com faturamento. O OSRM sobre OpenStreetMap não
// exige nada e cobre o traçado das vias, mas ignora boa parte das calçadas.
//
// A escolha não é ideológica: é de disponibilidade. Quem está na rua, cego,
// precisando chegar em algum lugar, não pode ficar sem rota porque a cota da
// API estourou. Então o Google é o principal e o OSRM é a rede de segurança —
// e o app DIZ qual dos dois está usando, porque a confiança no traçado muda.
//
// Os dois provedores devolvem a mesma forma, que é a que `navegacao.js` espera:
//
//   { origem, destino: {nome, lat, lng}, distanciaM, duracaoS, provedor,
//     passos: [{ instrucao, manobra, distanciaM, inicio, fim, via, polilinha }] }

export const Provedor = { GOOGLE: "google", OSM: "osm" };

// ============================================================
// Google Maps
// ============================================================

let googlePronto = null;

/** Carrega a Maps JavaScript API uma vez só. Devolve o objeto `google`. */
export function carregarGoogle(chave, { idioma = "pt-BR", regiao = "BR" } = {}) {
  if (googlePronto) return googlePronto;
  if (!chave) return Promise.reject(new Error("sem chave do Google Maps"));

  googlePronto = new Promise((resolve, reject) => {
    if (window.google?.maps?.DirectionsService) { resolve(window.google); return; }
    const cb = "__irisMapsPronto";
    window[cb] = () => resolve(window.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}`
      + `&libraries=places&language=${idioma}&region=${regiao}&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error("Maps JS não carregou (chave, faturamento ou rede)"));
    document.head.appendChild(s);
    // A API falha em silêncio quando a chave é inválida: ela só não chama o
    // callback. Sem este prazo, o app ficaria "procurando" para sempre.
    setTimeout(() => reject(new Error("Maps JS demorou demais")), 12000);
  }).catch((e) => { googlePronto = null; throw e; });

  return googlePronto;
}

const semHtml = (s) => String(s ?? "")
  .replace(/<div[^>]*>/gi, ". ")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "e")
  .replace(/\s+/g, " ")
  .trim();

/** Nome da via a partir da instrução do Google ("Vire à direita na Rua X"). */
function viaDaInstrucao(texto) {
  const m = texto.match(/\b(?:na|no|pela|pelo|em direção a|até)\s+([A-ZÀ-Ý][^,.;]{2,48})/);
  return m ? m[1].trim() : null;
}

const jaEhPonto = (d) => d && typeof d === "object"
  && Number.isFinite(d.lat) && Number.isFinite(d.lng);

async function rotaGoogle(chave, origem, destinoTexto, posicaoAtual) {
  const g = await carregarGoogle(chave);
  const destino = jaEhPonto(destinoTexto)
    ? { nome: destinoTexto.nome ?? "o destino", lat: destinoTexto.lat, lng: destinoTexto.lng }
    : await resolverDestinoGoogle(g, destinoTexto, posicaoAtual);

  const servico = new g.maps.DirectionsService();
  const r = await servico.route({
    origin: new g.maps.LatLng(origem.lat, origem.lng),
    destination: new g.maps.LatLng(destino.lat, destino.lng),
    travelMode: g.maps.TravelMode.WALKING,
    language: "pt-BR",
    region: "BR",
  });

  const perna = r.routes?.[0]?.legs?.[0];
  if (!perna) throw new Error("o Google não encontrou caminho a pé");

  const passos = perna.steps.map((s) => {
    const instrucao = semHtml(s.instructions);
    return {
      instrucao,
      manobra: s.maneuver ?? null,
      distanciaM: s.distance?.value ?? 0,
      inicio: { lat: s.start_location.lat(), lng: s.start_location.lng() },
      fim: { lat: s.end_location.lat(), lng: s.end_location.lng() },
      via: viaDaInstrucao(instrucao),
      polilinha: (s.path ?? []).map((p) => ({ lat: p.lat(), lng: p.lng() })),
    };
  });

  return {
    provedor: Provedor.GOOGLE,
    origem,
    destino,
    distanciaM: perna.distance?.value ?? 0,
    duracaoS: perna.duration?.value ?? null,
    passos,
  };
}

/**
 * "Rua 13 de Junho 200" é endereço; "farmácia" é busca. O geocodificador só
 * resolve o primeiro, então quando ele falha caímos na busca de lugares,
 * centrada em quem está pedindo — é o que faz "a padaria mais perto" funcionar.
 */
async function resolverDestinoGoogle(g, texto, posicaoAtual) {
  try {
    const geo = new g.maps.Geocoder();
    const r = await geo.geocode({
      address: texto,
      region: "BR",
      ...(posicaoAtual
        ? { bounds: new g.maps.Circle({
            center: new g.maps.LatLng(posicaoAtual.lat, posicaoAtual.lng), radius: 20000,
          }).getBounds() }
        : {}),
    });
    const hit = r.results?.[0];
    // Resultado vago (uma cidade inteira) não serve para andar a pé.
    const vago = hit?.types?.some((t) => ["locality", "administrative_area_level_1", "country"].includes(t));
    if (hit && !vago) {
      return {
        nome: hit.formatted_address?.split(",").slice(0, 2).join(",") ?? texto,
        lat: hit.geometry.location.lat(),
        lng: hit.geometry.location.lng(),
      };
    }
  } catch { /* cai para a busca de lugares */ }

  if (!g.maps.places || !posicaoAtual) throw new Error(`não achei "${texto}"`);
  const servico = new g.maps.places.PlacesService(document.createElement("div"));
  const lugar = await new Promise((resolve, reject) => {
    servico.textSearch({
      query: texto,
      location: new g.maps.LatLng(posicaoAtual.lat, posicaoAtual.lng),
      radius: 3000,
      language: "pt-BR",
    }, (res, status) => {
      if (status === g.maps.places.PlacesServiceStatus.OK && res?.[0]) resolve(res[0]);
      else reject(new Error(`não achei "${texto}" por perto`));
    });
  });
  return {
    nome: lugar.name ?? texto,
    lat: lugar.geometry.location.lat(),
    lng: lugar.geometry.location.lng(),
  };
}

// ============================================================
// OpenStreetMap: Nominatim + OSRM
// ============================================================
// Sem chave e sem cadastro. Em troca: o servidor público do OSRM é de
// demonstração, não tem acordo de nível de serviço e pede no máximo uma
// requisição por segundo. Para o piloto serve; para uso de verdade, hospede o
// seu (o README explica) ou contrate um provedor.

const OSRM = "https://router.project-osrm.org";
const NOMINATIM = "https://nominatim.openstreetmap.org";

let ultimaNominatim = 0;
async function esperarCota() {
  const espera = 1100 - (Date.now() - ultimaNominatim);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaNominatim = Date.now();
}

async function resolverDestinoOsm(texto, posicaoAtual) {
  await esperarCota();
  const u = new URL(`${NOMINATIM}/search`);
  u.searchParams.set("q", texto);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "1");
  u.searchParams.set("countrycodes", "br");
  u.searchParams.set("accept-language", "pt-BR");
  if (posicaoAtual) {
    const d = 0.18; // ~20 km
    u.searchParams.set("viewbox", [
      posicaoAtual.lng - d, posicaoAtual.lat + d, posicaoAtual.lng + d, posicaoAtual.lat - d,
    ].join(","));
    u.searchParams.set("bounded", "0");
  }
  const r = await fetch(u, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("busca de endereço indisponível");
  const j = await r.json();
  if (!j?.[0]) throw new Error(`não achei "${texto}"`);
  return {
    nome: (j[0].display_name ?? texto).split(",").slice(0, 2).join(","),
    lat: Number(j[0].lat),
    lng: Number(j[0].lon),
  };
}

const LADO = { left: "à esquerda", right: "à direita", "slight left": "levemente à esquerda",
  "slight right": "levemente à direita", "sharp left": "bem à esquerda",
  "sharp right": "bem à direita", straight: "em frente", uturn: "em sentido contrário" };

/** O OSRM devolve manobra estruturada, não frase. A frase é construída aqui. */
function instrucaoOsm(m, via) {
  const onde = via ? ` na ${via}` : "";
  const mod = LADO[m?.modifier] ?? "";
  switch (m?.type) {
    case "depart": return `Siga${via ? ` pela ${via}` : ""}.`;
    case "arrive": return "Chegada.";
    case "turn": return `Vire ${mod}${onde}.`;
    case "new name": return `Continue${onde}.`;
    case "continue": return `Continue ${mod}${onde}.`;
    case "merge": return `Entre ${mod}${onde}.`;
    case "fork": return `Na bifurcação, mantenha-se ${mod}${onde}.`;
    case "end of road": return `No fim da rua, vire ${mod}${onde}.`;
    case "roundabout": case "rotary": return `Na rotatória, pegue a saída${onde}.`;
    default: return `Siga ${mod}${onde}.`.replace(/\s+/g, " ");
  }
}

async function rotaOsm(origem, destinoTexto, posicaoAtual) {
  const destino = jaEhPonto(destinoTexto)
    ? { nome: destinoTexto.nome ?? "o destino", lat: destinoTexto.lat, lng: destinoTexto.lng }
    : await resolverDestinoOsm(destinoTexto, posicaoAtual);
  const u = `${OSRM}/route/v1/foot/${origem.lng},${origem.lat};${destino.lng},${destino.lat}`
    + `?overview=full&geometries=geojson&steps=true`;
  const r = await fetch(u);
  if (!r.ok) throw new Error("serviço de rotas indisponível");
  const j = await r.json();
  const rota = j?.routes?.[0];
  const perna = rota?.legs?.[0];
  if (!perna) throw new Error("não há caminho a pé até lá");

  const passos = perna.steps.map((s) => {
    const via = s.name || null;
    const coords = (s.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    const loc = s.maneuver?.location;
    return {
      instrucao: instrucaoOsm(s.maneuver, via),
      manobra: s.maneuver?.type ?? null,
      distanciaM: s.distance ?? 0,
      inicio: coords[0] ?? (loc ? { lat: loc[1], lng: loc[0] } : origem),
      fim: coords[coords.length - 1] ?? (loc ? { lat: loc[1], lng: loc[0] } : destino),
      via,
      polilinha: coords,
    };
  }).filter((p) => p.distanciaM > 0 || p.manobra === "arrive");

  return {
    provedor: Provedor.OSM,
    origem,
    destino,
    distanciaM: rota.distance ?? 0,
    duracaoS: rota.duration ?? null,
    passos,
  };
}

// ============================================================
// A porta de entrada
// ============================================================

/**
 * Traça a rota a pé. Tenta o Google; se não houver chave ou ele falhar, cai
 * para o OpenStreetMap. Devolve também `avisoDeQualidade` quando o traçado
 * veio do plano B — quem está andando merece saber em que está pisando.
 */
export async function tracarRota({ chaveGoogle, origem, destino, posicaoAtual = origem }) {
  if (!origem || origem.lat == null) throw new Error("sem posição de partida");
  // O destino pode vir como texto, para buscar, ou como ponto já resolvido —
  // é assim que um provedor registrado (o Lumiar, por exemplo) entrega um
  // lugar sem passar pelo buscador, e é assim que o recálculo reaproveita o
  // destino que já foi encontrado uma vez.
  const temDestino = jaEhPonto(destino) || String(destino ?? "").trim();
  if (!temDestino) throw new Error("sem destino");

  let erroGoogle = null;
  if (chaveGoogle) {
    try {
      return await rotaGoogle(chaveGoogle, origem, destino, posicaoAtual);
    } catch (e) {
      erroGoogle = e;
      console.warn("Google Maps falhou, caindo para OpenStreetMap:", e?.message ?? e);
    }
  }

  const r = await rotaOsm(origem, destino, posicaoAtual);
  r.avisoDeQualidade = chaveGoogle
    ? "O Google Maps não respondeu. Usando OpenStreetMap, que conhece menos calçadas."
    : "Usando OpenStreetMap. Sem chave do Google, as calçadas e travessias podem faltar.";
  r.erroGoogle = erroGoogle?.message ?? null;
  return r;
}
