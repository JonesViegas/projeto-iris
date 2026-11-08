// Núcleo do MPI em JavaScript puro: mesma lógica da versão Android
// (SpatialAnalyzer, AlertEngine, SceneDescriber). Sem dependência do navegador,
// testável com `node --test`.

// ---------- Nomes ----------
const f = (s, p) => ({ singular: s, plural: p, feminino: true });
const m = (s, p) => ({ singular: s, plural: p, feminino: false });

/** As 80 classes COCO do EfficientDet-Lite0, com plural e gênero. */
export const NOMES = {
  "person": f("pessoa", "pessoas"), "bicycle": f("bicicleta", "bicicletas"),
  "car": m("carro", "carros"), "motorcycle": f("moto", "motos"),
  "airplane": m("avião", "aviões"), "bus": m("ônibus", "ônibus"),
  "train": m("trem", "trens"), "truck": m("caminhão", "caminhões"),
  "boat": m("barco", "barcos"), "traffic light": m("semáforo", "semáforos"),
  "fire hydrant": m("hidrante", "hidrantes"), "stop sign": f("placa de pare", "placas de pare"),
  "parking meter": m("parquímetro", "parquímetros"), "bench": m("banco", "bancos"),
  "bird": m("pássaro", "pássaros"), "cat": m("gato", "gatos"),
  "dog": m("cachorro", "cachorros"), "horse": m("cavalo", "cavalos"),
  "sheep": f("ovelha", "ovelhas"), "cow": f("vaca", "vacas"),
  "elephant": m("elefante", "elefantes"), "bear": m("urso", "ursos"),
  "zebra": f("zebra", "zebras"), "giraffe": f("girafa", "girafas"),
  "backpack": f("mochila", "mochilas"), "umbrella": m("guarda-chuva", "guarda-chuvas"),
  "handbag": f("bolsa", "bolsas"), "tie": f("gravata", "gravatas"),
  "suitcase": f("mala", "malas"), "frisbee": m("frisbee", "frisbees"),
  "skis": m("esqui", "esquis"), "snowboard": f("prancha de neve", "pranchas de neve"),
  "sports ball": f("bola", "bolas"), "kite": f("pipa", "pipas"),
  "baseball bat": m("taco", "tacos"), "baseball glove": f("luva de beisebol", "luvas de beisebol"),
  "skateboard": m("skate", "skates"), "surfboard": f("prancha de surfe", "pranchas de surfe"),
  "tennis racket": f("raquete", "raquetes"), "bottle": f("garrafa", "garrafas"),
  "wine glass": f("taça", "taças"), "cup": m("copo", "copos"),
  "fork": m("garfo", "garfos"), "knife": f("faca", "facas"),
  "spoon": f("colher", "colheres"), "bowl": f("tigela", "tigelas"),
  "banana": f("banana", "bananas"), "apple": f("maçã", "maçãs"),
  "sandwich": m("sanduíche", "sanduíches"), "orange": f("laranja", "laranjas"),
  "broccoli": m("brócolis", "brócolis"), "carrot": f("cenoura", "cenouras"),
  "hot dog": m("cachorro-quente", "cachorros-quentes"), "pizza": f("pizza", "pizzas"),
  "donut": f("rosquinha", "rosquinhas"), "cake": m("bolo", "bolos"),
  "chair": f("cadeira", "cadeiras"), "couch": m("sofá", "sofás"),
  "potted plant": m("vaso de planta", "vasos de planta"), "bed": f("cama", "camas"),
  "dining table": f("mesa", "mesas"), "toilet": m("vaso sanitário", "vasos sanitários"),
  "tv": f("televisão", "televisões"), "laptop": m("notebook", "notebooks"),
  "mouse": m("mouse", "mouses"), "remote": m("controle remoto", "controles remotos"),
  "keyboard": m("teclado", "teclados"), "cell phone": m("celular", "celulares"),
  "microwave": m("micro-ondas", "micro-ondas"), "oven": m("forno", "fornos"),
  "toaster": f("torradeira", "torradeiras"), "sink": f("pia", "pias"),
  "refrigerator": f("geladeira", "geladeiras"), "book": m("livro", "livros"),
  "clock": m("relógio", "relógios"), "vase": m("vaso", "vasos"),
  "scissors": f("tesoura", "tesouras"), "teddy bear": m("bicho de pelúcia", "bichos de pelúcia"),
  "hair drier": m("secador de cabelo", "secadores de cabelo"),
  "toothbrush": f("escova de dentes", "escovas de dentes"),
};

/** Classes que geram alertas automáticos (relevantes para locomoção). */
export const ALERT_LABELS = new Set([
  "person", "bicycle", "car", "motorcycle", "bus", "truck", "train", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "dog", "cat", "horse", "cow",
  "chair", "couch", "potted plant", "dining table", "bed", "toilet", "tv",
  "refrigerator", "sink", "suitcase", "umbrella", "backpack",
  "knife", "scissors", "baseball bat",
]);
export const VEHICLES = new Set(["car", "motorcycle", "bus", "truck", "bicycle", "train"]);

/**
 * Objetos pontiagudos ou contundentes que o COCO reconhece.
 * ATENÇÃO: o COCO **não tem classe de arma de fogo**. Detectar pistola exige
 * modelo treinado à parte — não existe neste app e não deve ser prometido.
 * O que há aqui é faca, tesoura e taco, e mesmo esses a gente anuncia de forma
 * hedgeada ("objeto pontiagudo"), porque falso positivo aqui causa pânico.
 */
export const OBJETOS_CORTANTES = new Set(["knife", "scissors", "baseball bat"]);

// ---------- Espacial ----------
export const Direction = { FRENTE: "à frente", ESQUERDA: "à esquerda", DIREITA: "à direita" };
export const Proximity = { PERTO: 0, MEDIO: 1, LONGE: 2 };
const PROX_FALA = ["perto", "a média distância", "longe"];
const DIR_ORDEM = { [Direction.FRENTE]: 0, [Direction.ESQUERDA]: 1, [Direction.DIREITA]: 2 };

export const SPATIAL_DEFAULTS = {
  leftLimit: 0.35, rightLimit: 0.65, pathLeft: 0.30, pathRight: 0.70,
  boxNear: 0.55, boxMedium: 0.25,
};

/**
 * detections: [{ label, score, box: {left, top, right, bottom} }] normalizados 0..1.
 * Nesta versão web a proximidade vem da altura da caixa (sem modelo de profundidade).
 */
export function analyzeSpatial(detections, cfg = SPATIAL_DEFAULTS) {
  return detections.map((d) => {
    const b = d.box;
    const cx = (b.left + b.right) / 2;
    const h = b.bottom - b.top;
    const direction = cx < cfg.leftLimit ? Direction.ESQUERDA
      : cx > cfg.rightLimit ? Direction.DIREITA : Direction.FRENTE;

    // Distância em metros quando conhecemos o tamanho real da classe;
    // senão, o método antigo pela altura da caixa.
    const distanceM = distanciaMetros(d.label, b);
    const proximity = distanceM != null
      ? (distanceM <= DIST_PERTO_M ? Proximity.PERTO
        : distanceM <= DIST_MEDIO_M ? Proximity.MEDIO : Proximity.LONGE)
      : (h >= cfg.boxNear ? Proximity.PERTO
        : h >= cfg.boxMedium ? Proximity.MEDIO : Proximity.LONGE);

    const inPath = b.right > cfg.pathLeft && b.left < cfg.pathRight;
    return { detection: d, direction, proximity, inPath, distanceM };
  });
}

// ---------- Alertas ----------
export const Priority = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * O alerta vai falar deste objeto? (prioridade média ou alta). A narração
 * usa isto para não anunciar, um quadro antes, o mesmo objeto que o alerta
 * vai anunciar logo em seguida — "Semáforo à frente." e meio segundo depois
 * "Semáforo vermelho à frente." é a mesma coisa dita duas vezes.
 */
export function alertaVaiCobrir(o) {
  const label = o?.detection?.label;
  if (!ALERT_LABELS.has(label)) return false;
  if (label === "traffic light" && o.cor) return true;
  const perto = o.proximity === Proximity.PERTO;
  const medio = o.proximity === Proximity.MEDIO;
  const vindo = o.approaching === true;
  if (perto) return true;
  if (VEHICLES.has(label) && vindo && medio) return true;
  return medio && (o.inPath || vindo);
}

/** A frase sem o "Atenção,"/"Cuidado,": o que ela informa de fato. */
const nucleoDaFrase = (t) => String(t).replace(/^(Atenção|Cuidado), /, "").toLowerCase();

/** Mesmas regras do AlertEngine Android. */
export class AlertEngine {
  // Intervalos apertados de propósito: quem varre o ambiente com o celular
  // precisa de retorno quase imediato. Valores folgados faziam o app parecer
  // mudo enquanto a tela já mostrava os objetos.
  constructor({ requiredStreak = 2, repeatCooldownMs = 3000, minIntervalMs = 900, repeatParadoMs = 12000 } = {}) {
    // repeatParadoMs: o mesmo objeto, parado, à mesma distância. Repetir a
    // cada 3 s "Atenção, mesa à frente" com nada mudando é alarme que
    // ensina a ignorar alarme. Aproximou ou mudou de faixa: fala na hora.
    Object.assign(this, { requiredStreak, repeatCooldownMs, minIntervalMs, repeatParadoMs });
    this.streaks = new Map();
    this.lastSpoken = new Map();
    this.ultimoPorObjeto = new Map();   // streakKey -> { ts, dist }
    this.lastAnyMs = null;
  }

  process(objects, nowMs) {
    // A chave do contador NAO pode conter a distancia: ela oscila de quadro a
    // quadro e zeraria o contador toda hora, fazendo o app nunca falar.
    // Contamos por classe e direcao; a distancia entra so na fala.
    const byKey = new Map();
    for (const o of objects) {
      const c = this.#candidate(o);
      if (c && !byKey.has(c.streakKey)) byKey.set(c.streakKey, c);
    }
    // "pessoa à frente" e "pessoa com objeto pontiagudo à frente" descrevem a
    // mesma cena. O segundo contém o primeiro: falar os dois é ruído na hora
    // em que o usuário mais precisa de uma frase só.
    for (const c of [...byKey.values()]) {
      if (c.comPessoa) byKey.delete(`person|${c.direcao}`);
    }

    for (const k of [...this.streaks.keys()]) if (!byKey.has(k)) this.streaks.delete(k);
    for (const k of byKey.keys()) this.streaks.set(k, (this.streaks.get(k) ?? 0) + 1);

    let best = null;
    for (const c of byKey.values()) {
      if (c.priority === Priority.BAIXA) continue;
      if ((this.streaks.get(c.streakKey) ?? 0) < this.requiredStreak) continue;
      const last = this.lastSpoken.get(c.key);
      if (last !== undefined && nowMs - last < this.repeatCooldownMs) continue;
      // Mesmo objeto, mesma distância, dito há pouco: subir de "Pessoa à
      // frente, a dois metros e meio" para "Atenção, pessoa à frente, a dois
      // metros e meio" no mesmo segundo repete a frase sem informação nova.
      const ult = this.ultimoPorObjeto.get(c.streakKey);
      if (ult && ult.nucleo === nucleoDaFrase(c.text)
          && nowMs - ult.ts < (c.vindo ? this.repeatCooldownMs
            : c.priority === Priority.ALTA ? this.repeatParadoMs / 2 : this.repeatParadoMs)) continue;
      if (!best || c.priority < best.priority) best = c;
    }
    if (!best) return null;
    if (best.priority !== Priority.ALTA && this.lastAnyMs !== null
        && nowMs - this.lastAnyMs < this.minIntervalMs) return null;

    this.lastSpoken.set(best.key, nowMs);
    this.ultimoPorObjeto.set(best.streakKey, { ts: nowMs, nucleo: nucleoDaFrase(best.text) });
    this.lastAnyMs = nowMs;
    return best;
  }

  reset() { this.streaks.clear(); this.lastSpoken.clear(); this.ultimoPorObjeto.clear(); this.lastAnyMs = null; }

  #candidate(o) {
    const label = o.detection.label;
    if (!ALERT_LABELS.has(label)) return null;
    const nome = NOMES[label].singular;
    const vehicle = VEHICLES.has(label);
    const perto = o.proximity === Proximity.PERTO;
    const medio = o.proximity === Proximity.MEDIO;
    const vindo = o.approaching === true;

    // Um carro estacionado à direita não é emergência; um carro vindo é.
    // A versão anterior tratava os dois como alta prioridade e o alerta
    // virava ruído constante — e ruído constante faz desligar o app.
    let priority = Priority.BAIXA;
    if (perto && (o.inPath || vindo)) priority = Priority.ALTA;
    else if (vehicle && vindo && (perto || medio)) priority = Priority.ALTA;
    else if (perto) priority = Priority.MEDIA;
    else if (medio && (o.inPath || vindo)) priority = Priority.MEDIA;

    // Objeto cortante: anunciamos de forma hedgeada, porque falso positivo
    // aqui causa pânico — e acusa alguém injustamente. Nunca dizemos "arma".
    if (OBJETOS_CORTANTES.has(label)) {
      const rot = o.comPessoa ? "pessoa com objeto pontiagudo" : "objeto pontiagudo";
      const urgente = o.proximity === Proximity.PERTO || (o.comPessoa && o.approaching);
      const p = urgente ? Priority.ALTA : o.proximity === Proximity.MEDIO ? Priority.MEDIA : Priority.BAIXA;
      const d = metrosFalado(o.distanceM) ?? PROX_FALA[o.proximity];
      const f = `${rot} ${o.direction}, ${d}.`;
      return {
        text: p === Priority.ALTA ? `Atenção, ${f}` : cap(f),
        priority: p,
        streakKey: `${label}|${o.direction}`,
        key: `${label}|${o.direction}|${o.proximity}|${o.comPessoa ? "p" : ""}`,
        comPessoa: o.comPessoa === true,
        direcao: o.direction,
        dist: d,
        vindo: o.approaching === true,
      };
    }

    // Semáforo: a cor é a informação inteira para quem não enxerga.
    // Dizemos a cor e paramos aí — nunca "pode atravessar": a câmera não
    // sabe se o foco é o semáforo de pedestre ou o dos carros.
    let rotulo = nome;
    if (label === "traffic light" && o.cor) {
      rotulo = `semáforo ${o.cor}`;
      if (priority === Priority.BAIXA) priority = Priority.MEDIA;
    }

    const dist = metrosFalado(o.distanceM) ?? PROX_FALA[o.proximity];
    const frase = `${rotulo} ${o.direction}, ${dist}.`;
    const prefixo = priority === Priority.ALTA ? (vindo && vehicle ? "Cuidado, " : "Atenção, ") : "";
    const text = prefixo ? prefixo + frase : cap(frase);
    return {
      text, priority, dist, vindo,
      streakKey: `${label}|${o.direction}`,                                  // estavel entre quadros
      key: `${label}|${o.direction}|${o.proximity}|${o.cor ?? ""}`,          // governa o repetir
    };
  }
}

// ---------- Descrição "o que tem aqui?" ----------
export function numero(n, feminino) {
  const w = [null, feminino ? "uma" : "um", feminino ? "duas" : "dois", "três", "quatro",
    "cinco", "seis", "sete", "oito", "nove", "dez"];
  return w[n] ?? String(n);
}

/** frames: lista de listas de objetos espaciais (alguns quadros seguidos). */
export function describeScene(frames, maxGroups = 6) {
  const groups = new Map();
  for (const objects of frames) {
    const perFrame = new Map();
    for (const o of objects) {
      if (!NOMES[o.detection.label]) continue;
      const key = `${o.detection.label}|${o.direction}`;
      const g = perFrame.get(key) ?? { label: o.detection.label, direction: o.direction, count: 0, proximity: 9 };
      g.count++;
      g.proximity = Math.min(g.proximity, o.proximity);
      perFrame.set(key, g);
    }
    for (const [key, g] of perFrame) {
      const prev = groups.get(key);
      groups.set(key, prev
        ? { ...prev, count: Math.max(prev.count, g.count), proximity: Math.min(prev.proximity, g.proximity) }
        : g);
    }
  }
  if (groups.size === 0) return "Não reconheci nenhum objeto conhecido à frente.";

  const ordered = [...groups.values()].sort((a, b) =>
    a.proximity - b.proximity || DIR_ORDEM[a.direction] - DIR_ORDEM[b.direction] || b.count - a.count);
  const spoken = ordered.slice(0, maxGroups).map((g) => {
    const n = NOMES[g.label];
    return `${cap(numero(g.count, n.feminino))} ${g.count === 1 ? n.singular : n.plural} ${g.direction}, ${PROX_FALA[g.proximity]}.`;
  });
  const extra = ordered.length - spoken.length;
  const tail = extra > 0 ? ` E mais ${extra} ${extra === 1 ? "tipo" : "tipos"} de objeto.` : "";
  return spoken.join(" ") + tail;
}

// ============================================================
// Distância em metros (prior de tamanho real por classe)
// ============================================================
// A altura da caixa sozinha confunde um carro longe com uma pessoa perto.
// Com a altura real típica de cada classe e o campo de visão da câmera,
// a mesma caixa vira uma distância em metros, que é o que o usuário entende.

/** Altura real típica, em metros. Medianas aproximadas, não precisam ser exatas. */
export const ALTURA_REAL_M = {
  "person": 1.70, "bicycle": 1.10, "car": 1.50, "motorcycle": 1.40,
  "bus": 3.10, "truck": 3.20, "train": 3.80, "boat": 1.50,
  "traffic light": 0.90, "fire hydrant": 0.75, "stop sign": 0.75,
  "parking meter": 1.20, "bench": 0.90, "bird": 0.20, "cat": 0.30,
  "dog": 0.55, "horse": 1.60, "sheep": 0.90, "cow": 1.50,
  "backpack": 0.50, "umbrella": 1.00, "handbag": 0.35, "suitcase": 0.70,
  "chair": 0.90, "couch": 0.80, "potted plant": 0.60, "bed": 0.60,
  "dining table": 0.75, "toilet": 0.75, "tv": 0.60, "laptop": 0.25,
  "refrigerator": 1.70, "sink": 0.90, "oven": 0.90, "microwave": 0.30,
  "bottle": 0.25, "cup": 0.12, "book": 0.24, "clock": 0.30,
  "knife": 0.25, "scissors": 0.18, "baseball bat": 0.80,
  "vase": 0.30, "cell phone": 0.15, "skateboard": 0.10, "sports ball": 0.22,
};

/** Campo de visão vertical típico da câmera traseira de celular. */
export const FOV_VERTICAL_RAD = (48 * Math.PI) / 180;

/** Faixas de distância, em metros. 2,5 m ≈ três passos. */
export const DIST_PERTO_M = 2.5;
export const DIST_MEDIO_M = 8.0;

/**
 * Distância pela projeção pinhole: d = H / (2 · h · tan(fov/2)).
 * Retorna null para classes sem altura conhecida (cai no método antigo).
 * `truncada` avisa que a caixa encosta na borda: a altura visível é menor que
 * a real, então a distância sai superestimada — e errar para longe é o erro perigoso.
 */
export function distanciaMetros(label, box, fovRad = FOV_VERTICAL_RAD) {
  const H = ALTURA_REAL_M[label];
  if (!H) return null;
  const h = box.bottom - box.top;
  if (h <= 0.001) return null;

  let d = H / (2 * h * Math.tan(fovRad / 2));

  const encostaTopo = box.top <= 0.02;
  const encostaBase = box.bottom >= 0.98;
  if (encostaTopo && encostaBase) return Math.min(d, DIST_PERTO_M * 0.6); // objeto cortado dos dois lados: está em cima de nós
  if (encostaTopo || encostaBase) d *= 0.72;                              // cortado de um lado: puxa para perto, a favor da segurança

  return Math.round(d * 10) / 10;
}

/** "a dois metros e meio" — fala natural, sem número quebrado difícil de ouvir. */
export function metrosFalado(d) {
  if (d == null) return null;
  if (d < 1.2) return "a menos de um metro";
  if (d >= 20) return "a mais de vinte metros";
  const inteiro = Math.floor(d);
  const meio = d - inteiro >= 0.35 && d - inteiro < 0.8;
  const resto = d - inteiro >= 0.8 ? 1 : 0;
  const n = inteiro + resto;
  const nome = numero(n, false);
  if (meio) return n === 1 ? "a um metro e meio" : `a ${nome} metros e meio`;
  return n === 1 ? "a um metro" : `a ${nome} metros`;
}

// ============================================================
// Aproximação: o que vem na nossa direção
// ============================================================
// Carro estacionado e carro vindo geram a mesma caixa. A diferença está
// na variação da distância entre quadros. Sem isso, todo veículo da rua
// vira alerta de alta prioridade e o usuário desliga o app.

export class MotionTracker {
  /** @param velocidadeAproxMs metros por segundo a partir do qual consideramos "se aproximando". */
  constructor({ janelaMs = 1500, velocidadeAproxMs = 0.45 } = {}) {
    Object.assign(this, { janelaMs, velocidadeAproxMs });
    this.hist = new Map(); // chave -> { d, ts }
  }

  /** Marca cada objeto com `approaching` e `closingMs` (m/s de fechamento). */
  update(objects, nowMs) {
    const vistos = new Set();
    const saida = objects.map((o) => {
      const d = o.distanceM;
      const key = `${o.detection.label}|${o.direction}`;
      vistos.add(key);
      if (d == null) return { ...o, approaching: false, closingMs: 0 };

      const ant = this.hist.get(key);
      let closingMs = 0;
      if (ant && nowMs > ant.ts && nowMs - ant.ts <= this.janelaMs) {
        closingMs = (ant.d - d) / ((nowMs - ant.ts) / 1000);
      }
      // só regrava quando passou tempo suficiente para a medida ter sentido
      if (!ant || nowMs - ant.ts >= 300) this.hist.set(key, { d, ts: nowMs });
      return { ...o, approaching: closingMs >= this.velocidadeAproxMs, closingMs };
    });

    for (const k of [...this.hist.keys()]) {
      if (!vistos.has(k) && nowMs - this.hist.get(k).ts > this.janelaMs) this.hist.delete(k);
    }
    return saida;
  }

  reset() { this.hist.clear(); }
}

// ============================================================
// Cor do semáforo
// ============================================================
// O COCO detecta "traffic light" mas não a cor — e para quem não enxerga
// a cor é a informação inteira. A classificação usa dois sinais:
// o matiz dos pixels acesos e a posição vertical deles dentro da caixa
// (vermelho em cima, verde embaixo, na esmagadora maioria dos semáforos).

export const CorSemaforo = { VERMELHO: "vermelho", AMARELO: "amarelo", VERDE: "verde" };

/**
 * amostras: [{ r, g, b, yRel }] dos pixels mais claros da caixa, yRel 0 = topo, 1 = base.
 * Retorna { cor, confianca } ou null se não houver sinal suficiente.
 */
export function corDoSemaforo(amostras, minAmostras = 12) {
  if (!amostras || amostras.length < minAmostras) return null;

  const votos = { vermelho: 0, amarelo: 0, verde: 0 };
  let acesos = 0;

  for (const p of amostras) {
    const max = Math.max(p.r, p.g, p.b);
    const min = Math.min(p.r, p.g, p.b);
    if (max < 90) continue;                  // apagado
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.35) continue;                // branco/cinza: lâmpada estourada ou reflexo
    acesos++;

    let cor = null;
    if (p.r === max && p.g < p.r * 0.75) cor = CorSemaforo.VERMELHO;
    else if (p.g === max && p.r < p.g * 0.70) cor = CorSemaforo.VERDE;
    else if (p.r > p.b * 1.6 && p.g > p.b * 1.4) cor = CorSemaforo.AMARELO;
    if (!cor) continue;

    // posição confirma: a lâmpada acesa no terço de cima dificilmente é verde
    let peso = 1;
    if (cor === CorSemaforo.VERMELHO) peso += p.yRel < 0.40 ? 0.8 : -0.3;
    if (cor === CorSemaforo.VERDE) peso += p.yRel > 0.60 ? 0.8 : -0.3;
    votos[cor] += Math.max(0.2, peso);
  }

  if (acesos < minAmostras * 0.4) return null;
  const total = votos.vermelho + votos.amarelo + votos.verde;
  if (total <= 0) return null;

  const [cor, v] = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
  const confianca = v / total;
  if (confianca < 0.55) return null;         // ambíguo: melhor calar do que errar a cor
  return { cor, confianca: Math.round(confianca * 100) / 100 };
}

// ============================================================
// Piso e obstáculos pela segmentação (ADE20K)
// ============================================================
// Calçada e via não são "objetos": são regiões. Caixa delimitadora em
// calçada não quer dizer nada — por isso aqui entra segmentação, que
// classifica pixel a pixel. O modelo ADE20K também traz degrau e poste,
// que a versão anterior deste app não detectava de jeito nenhum.

/** Índices ADE20K que representam o chão onde se pisa. */
export const PISOS_ADE = {
  11: { nome: "calçada", seguro: true },
  6:  { nome: "via", seguro: false },
  52: { nome: "caminho", seguro: true },
  3:  { nome: "piso", seguro: true },
  9:  { nome: "grama", seguro: true },
  13: { nome: "terra", seguro: true },
  46: { nome: "areia", seguro: true },
  94: { nome: "terreno", seguro: true },
};

/** Índices ADE20K que são obstáculo de locomoção. */
export const OBSTACULOS_ADE = {
  53:  { nome: "escada", artigo: "uma" },
  59:  { nome: "escada", artigo: "uma" },
  121: { nome: "degrau", artigo: "um" },
  93:  { nome: "poste", artigo: "um" },
  32:  { nome: "cerca", artigo: "uma" },
  38:  { nome: "corrimão", artigo: "um" },
};

/**
 * Qual é o chão logo à frente.
 * `contagens`: Map/objeto índice->quantidade de pixels na faixa analisada.
 * Devolve null quando nenhuma superfície domina — melhor calar do que chutar.
 */
export function analisarPiso(contagens, totalPixels, minFracao = 0.30) {
  if (!totalPixels) return null;
  let melhor = null;
  for (const [idx, qtd] of Object.entries(contagens)) {
    const piso = PISOS_ADE[idx];
    if (!piso) continue;
    const fracao = qtd / totalPixels;
    if (fracao >= minFracao && (!melhor || fracao > melhor.fracao)) {
      melhor = { ...piso, fracao: Math.round(fracao * 100) / 100 };
    }
  }
  return melhor;
}

/**
 * Obstáculos de piso na faixa à frente, ordenados por área.
 * Exige fração maior que a do piso: um poste ocupa poucos pixels,
 * mas um falso positivo de degrau faz o usuário parar à toa.
 */
export function obstaculosDoPiso(contagens, totalPixels, minFracao = 0.035) {
  if (!totalPixels) return [];
  const achados = new Map();
  for (const [idx, qtd] of Object.entries(contagens)) {
    const obs = OBSTACULOS_ADE[idx];
    if (!obs) continue;
    const fracao = qtd / totalPixels;
    if (fracao < minFracao) continue;
    const ant = achados.get(obs.nome);
    if (!ant || fracao > ant.fracao) achados.set(obs.nome, { ...obs, fracao: Math.round(fracao * 100) / 100 });
  }
  return [...achados.values()].sort((a, b) => b.fracao - a.fracao);
}

/** Frase do piso. Só avisa via (perigo) e mudança de superfície; calçada em silêncio. */
export function avisoDePiso(pisoAtual, pisoAnterior) {
  if (!pisoAtual) return null;
  if (!pisoAtual.seguro) return { text: "Atenção, você está na via.", priority: Priority.ALTA };
  if (pisoAnterior && !pisoAnterior.seguro) return { text: `De volta à ${pisoAtual.nome}.`, priority: Priority.MEDIA };
  if (pisoAnterior && pisoAnterior.nome !== pisoAtual.nome) {
    return { text: `${cap(pisoAtual.nome)} à frente.`, priority: Priority.BAIXA };
  }
  return null;
}

// ============================================================
// Narrador: objetos e ações, não só perigos
// ============================================================
// O AlertEngine fala só o que ameaça a locomoção. Quem está usando também
// quer saber o que existe em volta e o que está acontecendo. O narrador
// cobre isso, sempre abaixo dos alertas em prioridade.

export const Verbosidade = {
  PERIGOS: 0,    // só o AlertEngine
  NORMAL: 1,     // + objetos relevantes que aparecem e o que se aproxima
  DETALHADO: 2,  // + qualquer objeto reconhecido
};

export class Narrador {
  constructor({ cooldownMs = 4000, intervaloMinMs = 1100 } = {}) {
    Object.assign(this, { cooldownMs, intervaloMinMs });
    this.visto = new Map();    // "classe|direcao" -> { ts, approaching }
    this.porClasse = new Map(); // "classe"          -> { ts, direction }
    this.anunciado = new Map(); // "classe|direcao"  -> ts em que FOI falado
    this.falado = new Map();    // chave do evento   -> ts da última fala
    this.ultimaFalaMs = null;
  }

  reset() {
    this.visto.clear(); this.porClasse.clear();
    this.anunciado.clear(); this.falado.clear();
    this.ultimaFalaMs = null;
  }

  /** Devolve no máximo um evento por chamada, para não atropelar a voz. */
  evento(objects, nowMs, nivel = Verbosidade.NORMAL) {
    if (nivel === Verbosidade.PERIGOS) return null;
    if (this.ultimaFalaMs !== null && nowMs - this.ultimaFalaMs < this.intervaloMinMs) {
      this.#lembrar(objects, nowMs);
      return null;
    }
    const escolhido = this.candidatos(objects, nowMs, nivel)[0];
    if (!escolhido) return null;
    this.confirmar([escolhido], nowMs);
    return { text: escolhido.text, tipo: escolhido.tipo, key: escolhido.chave, priority: Priority.BAIXA };
  }

  /**
   * Todos os eventos livres agora, sem marcar nada como falado.
   * O app usa isto para juntar vários numa frase só: dizer "Pessoa à frente",
   * "Carro à direita" e "Banco à esquerda" em três falas separadas consome
   * seis segundos e soa a robô fazendo inventário. Quem chama confirma depois,
   * com `confirmar()`, só o que virou voz de verdade.
   */
  candidatos(objects, nowMs, nivel = Verbosidade.NORMAL) {
    if (nivel === Verbosidade.PERIGOS) return [];

    const candidatos = [];
    for (const o of objects) {
      const label = o.detection.label;
      const nome = NOMES[label];
      if (!nome) continue;
      // No nível normal falamos as classes de risco em qualquer distância E
      // qualquer objeto que esteja perto. Antes o filtro era só a lista de
      // risco, então um objeto reconhecido bem à frente ficava mudo — o app
      // parecia quebrado para quem estava usando.
      if (nivel === Verbosidade.NORMAL
          && !ALERT_LABELS.has(label)
          && o.proximity !== Proximity.PERTO) continue;
      if (o.proximity === Proximity.LONGE && nivel !== Verbosidade.DETALHADO) continue;

      const chave = `${label}|${o.direction}`;
      const antes = this.visto.get(chave);
      const dist = metrosFalado(o.distanceM);
      const ondeQuando = dist ? `${o.direction}, ${dist}` : o.direction;
      // mesma linguagem hedgeada do alerta: nunca "faca" cru
      const comoChamar = OBJETOS_CORTANTES.has(label)
        ? (o.comPessoa ? "pessoa com objeto pontiagudo" : "objeto pontiagudo")
        : nome.singular;

      // 1) algo começou a vir na nossa direção
      if (o.approaching && !antes?.approaching) {
        candidatos.push({
          tipo: "aproximando", chave: `aprox:${chave}`, peso: 0,
          text: `${cap(comoChamar)} se aproximando ${o.direction}.`,
        });
        continue;
      }
      // 2) algo mudou de lado: alguém passou na nossa frente.
      // Compara pela CLASSE, nao pela chave classe|direcao: no lado novo
      // essa chave ainda nao existe e o evento viraria "apareceu".
      // Exigir deslocamento real do centro: sem isso, o tremor natural da
      // caixa cruza a fronteira esquerda/frente/direita e o app anuncia
      // "passando" sem parar, com o objeto imóvel.
      const antesClasse = this.porClasse.get(label);
      const cxAgora = (o.detection.box.left + o.detection.box.right) / 2;
      const andou = antesClasse && Math.abs(cxAgora - antesClasse.cx) >= 0.18;
      if (antesClasse && antesClasse.direction !== o.direction && andou) {
        candidatos.push({
          tipo: "passando", chave: `passa:${label}`, peso: 1,
          text: `${cap(comoChamar)} passando ${o.direction}.`,
        });
        continue;
      }
      // 3) algo novo entrou em cena.
      // O critério é "ainda não foi FALADO", não "ainda não foi visto": antes
      // marcávamos todos os objetos como vistos a cada ciclo mesmo anunciando
      // só um, e os demais nasciam calados para sempre. Com quatro objetos na
      // mesa o app dizia uma frase e emudecia.
      if (!this.anunciado.has(chave)) {
        candidatos.push({
          tipo: "apareceu", chave: `novo:${chave}`, alvo: chave, peso: 2,
          text: `${cap(comoChamar)} ${ondeQuando}.`,
        });
      }
    }

    this.#lembrar(objects, nowMs);

    return candidatos
      .filter((c) => {
        const ult = this.falado.get(c.chave);
        return ult === undefined || nowMs - ult >= this.cooldownMs;
      })
      .sort((a, b) => a.peso - b.peso);
  }

  /** Marca como falado o que de fato virou voz. */
  confirmar(eventos, nowMs) {
    let algum = false;
    for (const e of eventos ?? []) {
      if (!e) continue;
      algum = true;
      this.falado.set(e.chave, nowMs);
      if (e.tipo === "apareceu" && e.alvo) this.anunciado.set(e.alvo, nowMs);
    }
    if (algum) this.ultimaFalaMs = nowMs;
  }

  #lembrar(objects, nowMs) {
    for (const o of objects) {
      const label = o.detection.label;
      this.visto.set(`${label}|${o.direction}`, { ts: nowMs, approaching: o.approaching === true });
      this.porClasse.set(label, {
        ts: nowMs, direction: o.direction,
        cx: (o.detection.box.left + o.detection.box.right) / 2,
      });
    }
    // esquece o que sumiu faz tempo, senão nada volta a ser "novo"
    const velho = this.cooldownMs * 1.5;
    for (const [k, v] of [...this.visto]) if (nowMs - v.ts > velho) this.visto.delete(k);
    for (const [k, v] of [...this.porClasse]) if (nowMs - v.ts > velho) this.porClasse.delete(k);
    // sumiu de cena faz tempo: se voltar, volta a ser novidade
    for (const [k, ts] of [...this.anunciado]) {
      if (!this.visto.has(k) && nowMs - ts > velho) this.anunciado.delete(k);
    }
  }
}

// ============================================================
// Objeto cortante junto a uma pessoa
// ============================================================
// Uma faca vista de perfil vira uma caixa fininha: a distância pela altura
// sai muito superestimada e o alerta nunca dispara. Quando o objeto está
// sobre uma pessoa, a distância DELA é bem mais confiável — e é a que importa,
// porque o que se aproxima é a pessoa, não a lâmina solta no ar.

/** Centro da caixa está dentro da pessoa, com folga (gente segura coisa fora da silhueta). */
function dentroDe(box, pessoa, folga = 0.15) {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const w = (pessoa.right - pessoa.left) * folga;
  const h = (pessoa.bottom - pessoa.top) * folga;
  return cx >= pessoa.left - w && cx <= pessoa.right + w
      && cy >= pessoa.top - h && cy <= pessoa.bottom + h;
}

/**
 * Marca objetos cortantes que estão junto a alguém e herda a distância da pessoa.
 * Devolve uma lista nova; não altera a original.
 */
export function associarCortantes(objects, cfgPerto = DIST_PERTO_M, cfgMedio = DIST_MEDIO_M) {
  const pessoas = objects.filter((o) => o.detection.label === "person");
  if (pessoas.length === 0) return objects;

  return objects.map((o) => {
    if (!OBJETOS_CORTANTES.has(o.detection.label)) return o;
    const dona = pessoas.find((p) => dentroDe(o.detection.box, p.detection.box));
    if (!dona) return o;

    const distanceM = dona.distanceM ?? o.distanceM;
    const proximity = distanceM != null
      ? (distanceM <= cfgPerto ? Proximity.PERTO : distanceM <= cfgMedio ? Proximity.MEDIO : Proximity.LONGE)
      : dona.proximity;

    return {
      ...o,
      comPessoa: true,
      distanceM,
      proximity,
      inPath: o.inPath || dona.inPath,
      approaching: o.approaching || dona.approaching,
    };
  });
}

// ============================================================
// Classes vindas de fora do COCO
// ============================================================
// O detector rápido tem 80 classes fixas. O reconhecimento de vocabulário
// aberto (aberto.js) produz classes em tempo de execução — buraco, bueiro,
// piso tátil, tapume. Para que elas atravessem o pipeline inteiro (espacial,
// distância, alerta, narração, descrição) sem tratamento especial em cada
// etapa, basta registrá-las nas mesmas tabelas que as do COCO usam.
//
// Mutação de tabela em módulo não é bonito, mas a alternativa — passar as
// tabelas como parâmetro por sete funções — espalharia o acoplamento por todo
// o núcleo para servir a um único chamador.

/**
 * @param nomes   { label: { singular, plural, feminino } }
 * @param alturas { label: metros } para a estimativa de distância
 * @param alerta  lista de labels que merecem alerta falado na hora
 */
export function registrarClasses({ nomes = {}, alturas = {}, alerta = [] } = {}) {
  Object.assign(NOMES, nomes);
  Object.assign(ALTURA_REAL_M, alturas);
  for (const l of alerta) ALERT_LABELS.add(l);
}
