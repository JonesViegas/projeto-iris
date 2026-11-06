// Navegação a pé para quem não enxerga.
//
// Guiar um pedestre cego não é guiar um carro com a voz mais lenta. Três
// diferenças mandam no desenho deste módulo:
//
//   1. O carro sabe para onde aponta; o pedestre, não. Um motorista está
//      sempre alinhado com a via, então "vire à direita" é sempre verdade.
//      Uma pessoa parada na calçada pode estar virada para qualquer lado — e
//      "vire à direita" dito sem saber o rumo dela manda a pessoa para a rua.
//      Por isso aqui NENHUM giro relativo sai sem rumo confiável. Sem bússola,
//      falamos em pontos cardeais e dizemos que não sabemos o rumo.
//
//   2. A margem é de metros, não de dezenas. O GPS de celular erra 5 a 15 m na
//      cidade — da largura de uma via inteira. Um aviso de manobra a 50 m é
//      inútil; a 5 m, tarde. A janela boa é 20-30 m para preparar e 8 m para
//      executar, e é isso que está codificado abaixo.
//
//   3. Travessia é onde se morre. O app NUNCA diz "pode atravessar". Ele diz
//      que há travessia, manda parar, e devolve a decisão a quem está lá.
//
// Sem dependência de navegador: `node --test test/navegacao.test.mjs`.

const R_TERRA_M = 6371000;
const rad = (g) => (g * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// ============================================================
// Geodésia
// ============================================================

/** Distância em metros entre dois pontos {lat, lng}. */
export function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumo de a para b, em graus de 0 (norte) a 360, sentido horário. */
export function rumo(a, b) {
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Diferença angular com sinal: negativo à esquerda, positivo à direita, -180..180. */
export function diferencaAngular(de, para) {
  let d = (para - de + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * Distância em metros de um ponto ao segmento a-b.
 * Projeção plana local: em segmentos de rua (dezenas de metros) o erro é
 * irrelevante e evita trigonometria esférica a cada quadro de GPS.
 */
export function distanciaAoSegmento(p, a, b) {
  const mPorGrauLat = 111320;
  const mPorGrauLng = 111320 * Math.cos(rad(p.lat));
  const px = (p.lng - a.lng) * mPorGrauLng;
  const py = (p.lat - a.lat) * mPorGrauLat;
  const bx = (b.lng - a.lng) * mPorGrauLng;
  const by = (b.lat - a.lat) * mPorGrauLat;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Menor distância do ponto à linha quebrada. */
export function distanciaAPolilinha(p, pontos) {
  if (!pontos || pontos.length === 0) return Infinity;
  if (pontos.length === 1) return distanciaM(p, pontos[0]);
  let min = Infinity;
  for (let i = 0; i < pontos.length - 1; i++) {
    const d = distanciaAoSegmento(p, pontos[i], pontos[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

// ============================================================
// Como se fala uma direção
// ============================================================

export const CARDEAIS = [
  "norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste",
];

/** 0-360 graus -> "nordeste". */
export function cardeal(graus) {
  const i = Math.round(((graus % 360) + 360) % 360 / 45) % 8;
  return CARDEAIS[i];
}

/**
 * Giro relativo em linguagem de pedestre.
 * O limiar de 20 graus existe porque o GPS e a bússola do celular tremem nessa
 * ordem de grandeza: abaixo disso, "vire" seria tremor virando instrução.
 */
export function giroFalado(delta) {
  const a = Math.abs(delta);
  const lado = delta < 0 ? "à esquerda" : "à direita";
  if (a < 20) return "siga em frente";
  if (a < 50) return `vire levemente ${lado}`;
  if (a < 120) return `vire ${lado}`;
  if (a < 160) return `vire bem ${lado}`;
  return "dê meia-volta";
}

/**
 * Distância falada para pedestre. Abaixo de 30 m damos também o número de
 * passos: muita gente treinada em orientação e mobilidade conta passos, e um
 * número de passos é executável de imediato, enquanto "doze metros" exige
 * converter de cabeça enquanto se anda.
 */
export function distanciaFalada(m, { passoM = 0.75 } = {}) {
  if (m == null || !isFinite(m)) return null;
  if (m < 4) return "bem à sua frente";
  if (m < 30) {
    const passos = Math.round(m / passoM / 5) * 5;
    return `${Math.round(m)} metros, uns ${passos} passos`;
  }
  // Arredondar 180 para 200 tira 26 passos de quem conta passos. Abaixo de
  // meio quilômetro a dezena é o grão certo; acima, a precisão não muda nada.
  if (m < 500) return `${Math.round(m / 10) * 10} metros`;
  if (m < 1000) return `${Math.round(m / 50) * 50} metros`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} quilômetros`;
}

/** Posição do destino em relação a quem chega: "à sua direita". */
export function ladoDoDestino(delta) {
  const a = Math.abs(delta);
  if (a < 35) return "bem à sua frente";
  if (a > 145) return "atrás de você";
  return delta < 0 ? "à sua esquerda" : "à sua direita";
}

// ============================================================
// Travessias
// ============================================================
// Detectamos travessia pelo texto da instrução porque nem o Google nem o OSRM
// marcam travessia como manobra própria em todo lugar. Falso positivo aqui é
// barato (o app manda parar quando não precisava); falso negativo é caro.

const PISTAS_TRAVESSIA = [
  "atravess", "travessia", "faixa de pedestre", "cross the", "crosswalk", "crossing",
];

export function ehTravessia(texto = "") {
  const t = texto.toLowerCase();
  return PISTAS_TRAVESSIA.some((p) => t.includes(p));
}

// ============================================================
// O navegador
// ============================================================

export const FaseDoPasso = {
  SEGUINDO: "seguindo",     // andando no trecho
  PREPARAR: "preparar",     // manobra chegando
  EXECUTAR: "executar",     // manobra agora
};

export const RAIO_FORA_DE_ROTA_M = 25;   // ~ uma via larga: abaixo disso é erro de GPS
export const FIXES_FORA_PARA_RECALCULAR = 3;
export const RAIO_CHEGADA_M = 15;
export const DIST_PREPARAR_M = 25;
export const DIST_EXECUTAR_M = 8;
export const PRECISAO_RUIM_M = 30;       // acima disso o GPS não sustenta manobra

/**
 * Consome posições e devolve eventos de fala. Não fala, não acessa GPS, não
 * conhece Google nem OSRM: recebe uma rota já normalizada e pontos crus.
 *
 * rota: {
 *   destino: { nome, lat, lng },
 *   distanciaM, duracaoS,
 *   passos: [{ instrucao, manobra, distanciaM, inicio, fim, via?, polilinha: [{lat,lng}] }]
 * }
 */
export class Navegador {
  constructor({
    raioForaDeRota = RAIO_FORA_DE_ROTA_M,
    fixesParaRecalcular = FIXES_FORA_PARA_RECALCULAR,
    raioChegada = RAIO_CHEGADA_M,
    distPreparar = DIST_PREPARAR_M,
    distExecutar = DIST_EXECUTAR_M,
    precisaoRuim = PRECISAO_RUIM_M,
  } = {}) {
    Object.assign(this, {
      raioForaDeRota, fixesParaRecalcular, raioChegada,
      distPreparar, distExecutar, precisaoRuim,
    });
    this.rota = null;
    this.passo = 0;
    this.fase = FaseDoPasso.SEGUINDO;
    this.foraSeguidos = 0;
    this.chegou = false;
    this.ultimaPosicao = null;
    this.avisouPrecisao = false;
    this.recalculos = 0;
    this.ultimoForaMs = null;
  }

  iniciar(rota) {
    this.rota = rota;
    this.passo = 0;
    this.fase = FaseDoPasso.SEGUINDO;
    this.foraSeguidos = 0;
    this.chegou = false;
    this.avisouPrecisao = false;
    this.recalculos = 0;
    this.ultimoForaMs = null;
    const p = rota?.passos?.[0];
    const resumo = `Rota traçada até ${rota.destino.nome}: ${distanciaFalada(rota.distanciaM)}`
      + (rota.duracaoS ? `, cerca de ${Math.max(1, Math.round(rota.duracaoS / 60))} minutos a pé` : "")
      + ".";
    const primeiro = p ? ` ${this.#frasePasso(p, p.distanciaM, null)}` : "";
    return { tipo: "inicio", texto: resumo + primeiro, urgente: false, chave: "nav:inicio" };
  }

  parar() {
    this.rota = null;
    this.chegou = false;
  }

  get ativo() { return this.rota !== null && !this.chegou; }

  get passoAtual() { return this.rota?.passos?.[this.passo] ?? null; }

  /**
   * posicao: { lat, lng, precisaoM?, rumoGraus?, velocidadeMs? }
   * rumoDispositivo: graus da bússola, ou null se não houver.
   * Devolve [] ou uma lista de eventos { tipo, texto, urgente, chave, recalcular? }.
   */
  atualizar(posicao, rumoDispositivo, agoraMs) {
    if (!this.ativo || !posicao) return [];
    const eventos = [];
    const passo = this.passoAtual;
    if (!passo) return [];

    // O rumo do GPS (curso) só vale quando a pessoa está andando. Parado, ele
    // é ruído puro e faria o app mandar virar para qualquer lado.
    const andando = (posicao.velocidadeMs ?? 0) > 0.6;
    const rumoAtual = rumoDispositivo != null ? rumoDispositivo
      : (andando && posicao.rumoGraus != null ? posicao.rumoGraus : null);

    // GPS ruim: avisamos uma vez e seguimos dando distância, sem mandar virar.
    if (posicao.precisaoM != null && posicao.precisaoM > this.precisaoRuim && !this.avisouPrecisao) {
      this.avisouPrecisao = true;
      eventos.push({
        tipo: "precisao",
        texto: "Sinal de GPS fraco. Vou avisar as distâncias, mas confira as esquinas pela bengala.",
        urgente: false, chave: "nav:precisao",
      });
    }

    // Chegou?
    const aoDestino = distanciaM(posicao, this.rota.destino);
    if (aoDestino <= this.raioChegada) {
      this.chegou = true;
      const lado = rumoAtual != null
        ? ladoDoDestino(diferencaAngular(rumoAtual, rumo(posicao, this.rota.destino)))
        : "por perto";
      eventos.push({
        tipo: "chegada",
        texto: `Você chegou. ${this.rota.destino.nome} fica ${lado}.`,
        urgente: true, chave: "nav:chegada",
      });
      return eventos;
    }

    // Fora de rota? Exigimos vários fixes seguidos: um só é quase sempre o GPS
    // pulando entre prédios, e recalcular a cada pulo deixa o app histérico.
    const daRota = distanciaAPolilinha(posicao, passo.polilinha ?? [passo.inicio, passo.fim]);
    const margem = this.raioForaDeRota + Math.min(20, posicao.precisaoM ?? 0);
    if (daRota > margem) {
      this.foraSeguidos++;
      if (this.foraSeguidos >= this.fixesParaRecalcular && this.#podeReclamarDaRota(agoraMs)) {
        this.foraSeguidos = 0;
        this.ultimoForaMs = agoraMs;
        this.recalculos++;
        eventos.push(this.#eventoForaDeRota());
        return eventos;
      }
    } else {
      this.foraSeguidos = 0;
      // Voltou para a rota: a contagem de teimosia zera, senão a próxima vez
      // que ela se perder o app já começa calado.
      this.recalculos = 0;
    }

    // Avançou de trecho?
    const aoFim = distanciaM(posicao, passo.fim);
    if (aoFim <= this.distExecutar && this.fase === FaseDoPasso.EXECUTAR) {
      const proximo = this.rota.passos[this.passo + 1];
      this.passo++;
      this.fase = FaseDoPasso.SEGUINDO;
      if (proximo) {
        eventos.push({
          tipo: "novo-passo",
          texto: this.#frasePasso(proximo, proximo.distanciaM, rumoAtual),
          urgente: false, chave: `nav:passo:${this.passo}`,
        });
      }
      return eventos;
    }

    // Preparar e executar a manobra do fim deste trecho.
    const ehUltimo = this.passo >= this.rota.passos.length - 1;
    if (!ehUltimo) {
      if (aoFim <= this.distExecutar && this.fase !== FaseDoPasso.EXECUTAR) {
        this.fase = FaseDoPasso.EXECUTAR;
        eventos.push(this.#eventoManobra(passo, rumoAtual, true));
      } else if (aoFim <= this.distPreparar && this.fase === FaseDoPasso.SEGUINDO) {
        this.fase = FaseDoPasso.PREPARAR;
        eventos.push(this.#eventoManobra(passo, rumoAtual, false, aoFim));
      }
    }

    this.ultimaPosicao = posicao;
    return eventos.filter(Boolean);
  }

  /** Quanto falta no total, em metros — para a interface mostrar. */
  restanteM(posicao) {
    if (!this.rota || !posicao) return null;
    let total = distanciaM(posicao, this.passoAtual?.fim ?? this.rota.destino);
    for (let i = this.passo + 1; i < this.rota.passos.length; i++) {
      total += this.rota.passos[i].distanciaM ?? 0;
    }
    return total;
  }

  // ---------- fora de rota ----------
  // Quando o recálculo não resolve — sem rede, GPS pulando, ou a pessoa
  // andando mesmo para outro lugar — a versão ingênua repetia "você saiu do
  // caminho" a cada seis segundos, para sempre. Isso não ajuda ninguém a se
  // achar: só confirma, sem parar, que a pessoa está perdida.

  #podeReclamarDaRota(agoraMs) {
    if (this.ultimoForaMs === null) return true;
    // Espaçamento crescente: 15 s, 30 s, 60 s, e para por aí.
    const espera = Math.min(60000, 15000 * 2 ** Math.max(0, this.recalculos - 1));
    return agoraMs - this.ultimoForaMs >= espera;
  }

  #eventoForaDeRota() {
    if (this.recalculos === 1) {
      return {
        tipo: "fora", recalcular: true,
        texto: "Você saiu do caminho. Recalculando a rota.",
        urgente: true, chave: `nav:fora:${this.recalculos}`,
      };
    }
    if (this.recalculos === 2) {
      return {
        tipo: "fora", recalcular: true,
        texto: "Ainda fora da rota. Pare um instante, deixe o GPS estabilizar e tento de novo.",
        urgente: false, chave: `nav:fora:${this.recalculos}`,
      };
    }
    // Daqui em diante o app continua tentando recalcular em silêncio e diz
    // isto uma vez só: insistir na voz, nesse ponto, é ruído sobre angústia.
    return {
      tipo: "fora", recalcular: true,
      texto: this.recalculos === 3
        ? "Não estou conseguindo te colocar na rota. Se puder, peça uma referência a alguém, "
          + "ou toque em parar rota e comece de novo."
        : null,
      urgente: false, chave: `nav:fora:${this.recalculos}`,
    };
  }

  // ---------- frases ----------

  #frasePasso(passo, metros, rumoAtual) {
    const via = passo.via ? ` pela ${passo.via}` : "";
    const d = distanciaFalada(metros);
    // Sem rumo confiável, damos o cardeal: é a única informação que não mente.
    if (rumoAtual == null && passo.inicio && passo.fim) {
      const c = cardeal(rumo(passo.inicio, passo.fim));
      return `Siga ${d}${via}, sentido ${c}.`;
    }
    return `Siga ${d}${via}.`;
  }

  #eventoManobra(passo, rumoAtual, agora, aoFim = null) {
    const proximo = this.rota.passos[this.passo + 1];
    // A travessia é a do trecho que VEM, não a do trecho que está acabando.
    // Checar o trecho atual fazia o app mandar "pare" de novo na calçada
    // oposta, com a pessoa já no meio da rua — o pior momento possível.
    const travessia = ehTravessia(proximo?.instrucao ?? "");

    // Travessia cala todo o resto. Nunca autorizamos: mandamos parar.
    if (travessia) {
      return agora
        ? {
            tipo: "travessia",
            texto: "Travessia bem à frente. Pare. Confirme o meio-fio com a bengala, "
              + "escute o trânsito e atravesse quando você julgar seguro.",
            urgente: true, chave: `nav:travessia:exec:${this.passo}`,
          }
        : {
            tipo: "travessia-preparar",
            texto: `Travessia em ${distanciaFalada(aoFim)}.`,
            urgente: false, chave: `nav:travessia:prep:${this.passo}`,
          };
    }

    const giro = this.#giroDaManobra(passo, proximo, rumoAtual);
    const via = proximo?.via ? ` na ${proximo.via}` : "";

    // Manobra que não é manobra: o traçado mudou de trecho mas o corpo segue
    // reto. Anunciá-la rende "Siga em frente na Rua X." seguido, três segundos
    // depois, de "Siga 120 metros pela Rua X" — duas frases para dizer "nada
    // mudou". O trecho novo já se anuncia sozinho.
    if (giro === "siga em frente") return null;

    if (agora) {
      return {
        tipo: "manobra",
        texto: `Agora, ${giro}${via}.`,
        urgente: true, chave: `nav:manobra:${this.passo}`,
      };
    }
    return {
      tipo: "manobra-preparar",
      texto: `Em ${distanciaFalada(aoFim)}, ${giro}${via}.`,
      urgente: false, chave: `nav:prep:${this.passo}`,
    };
  }

  /**
   * O giro só é relativo quando sabemos para onde a pessoa aponta. Sem isso,
   * devolvemos o cardeal — menos confortável, mas nunca manda para o lado errado.
   */
  #giroDaManobra(passo, proximo, rumoAtual) {
    if (!proximo?.inicio || !proximo?.fim) return "siga em frente";
    const rumoNovo = rumo(proximo.inicio, proximo.fim);
    if (rumoAtual == null) return `siga para o ${cardeal(rumoNovo)}`;
    return giroFalado(diferencaAngular(rumoAtual, rumoNovo));
  }
}

// ============================================================
// Pontos de referência pela câmera
// ============================================================
// A rota dá a geometria; a câmera dá o mundo. Quando o app está prestes a
// mandar virar e a câmera vê um semáforo ou um poste naquela direção, dizer
// "vire à direita, logo depois do poste" transforma uma coordenada numa
// referência que a pessoa consegue confirmar com a bengala ou com o tato.

const REFERENCIAS_UTEIS = new Set([
  "traffic light", "stop sign", "fire hydrant", "bench", "parking meter", "bus", "car",
]);

/**
 * objetos: saída do analyzeSpatial. lado: "à esquerda" | "à direita" | "à frente".
 * Devolve o nome falável de uma referência naquele lado, ou null.
 */
export function referenciaNoLado(objetos, lado, nomes) {
  if (!objetos || !lado) return null;
  const cand = objetos
    .filter((o) => o.direction === lado && REFERENCIAS_UTEIS.has(o.detection.label))
    .sort((a, b) => (a.distanceM ?? 99) - (b.distanceM ?? 99))[0];
  if (!cand) return null;
  return nomes?.[cand.detection.label]?.singular ?? null;
}
