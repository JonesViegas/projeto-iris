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
 * O que não anda sozinho. Serve de régua: se um poste está "se aproximando",
 * quem está andando sou eu. É com estas classes que o app mede o próprio passo
 * quando o GPS não responde — ver MotionTracker.
 *
 * Carro NÃO entra aqui de propósito: estacionado ele é tão imóvel quanto um
 * poste, mas a câmera não sabe disso, e um carro em movimento usado como régua
 * faria o app subtrair a velocidade dele e emudecer bem na hora do perigo.
 */
export const IMOVEIS = new Set([
  "fire hydrant", "stop sign", "parking meter", "bench", "traffic light",
  "potted plant", "chair", "couch", "dining table", "bed", "toilet",
  "tv", "refrigerator", "sink",
]);

/**
 * Objetos pontiagudos ou contundentes que o COCO reconhece.
 * ATENÇÃO: o COCO **não tem classe de arma de fogo**. Possível arma de fogo é
 * assunto de ameacas.js (rótulo interno "firearm", vindo do vocabulário aberto
 * ou de um detector treinado), que exige confirmação e fala sempre "possível".
 * Ela NUNCA ganha nome aqui em NOMES: assim não entra na narração, na
 * descrição nem no alerta comum, que falariam sem cautela.
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
  // quanto da largura da imagem o objeto precisa tomar do corredor
  pathMinimo: 0.10,
  boxNear: 0.55, boxMedium: 0.25,
};

/**
 * detections: [{ label, score, box: {left, top, right, bottom} }] normalizados 0..1.
 * Nesta versão web a proximidade vem da altura da caixa (sem modelo de profundidade).
 */
/**
 * Caixa sã, custe o que custar.
 *
 * Um detector pode devolver caixa invertida (left > right), de área zero ou
 * com valor fora de [0,1] — acontece em quantização de modelo e em quadro
 * perdido. Sem este conserto, a largura ou a altura saem negativas, a
 * estimativa de distância pela altura devolve ZERO, e zero metro vira
 * "a menos de um metro": o alerta de colisão mais assustador que o app tem,
 * disparado por aritmética. É um dos suspeitos dos sustos do teste de rua.
 *
 * Devolve null quando a caixa não dá para aproveitar.
 */
export function caixaSa(b) {
  if (!b) return null;
  const n = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
  const l = n(b.left), r = n(b.right), t = n(b.top), bo = n(b.bottom);
  if (l === null || r === null || t === null || bo === null) return null;
  const caixa = {
    left: Math.min(l, r), right: Math.max(l, r),
    top: Math.min(t, bo), bottom: Math.max(t, bo),
  };
  // Área desprezível não carrega informação de distância nenhuma.
  if (caixa.right - caixa.left < 1e-4 || caixa.bottom - caixa.top < 1e-4) return null;
  return caixa;
}

export function analyzeSpatial(detections, cfg = SPATIAL_DEFAULTS) {
  return detections.map((d) => {
    const b = caixaSa(d.box);
    if (!b) {
      return {
        detection: d, direction: Direction.FRENTE,
        proximity: Proximity.LONGE, inPath: false, distanceM: null,
      };
    }
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

    // "No meu caminho" era só encostar no corredor: `right > 0.30 && left <
    // 0.70`. Qualquer objeto largo perto da borda passava — um carro
    // estacionado à sua direita, cuja caixa invade cinco centésimos do
    // corredor, era classificado como obstáculo no caminho, virava prioridade
    // ALTA e ganhava direito a insistir a cada seis segundos. Numa rua com
    // carros dos dois lados, isso é o app inteiro falando de estacionamento.
    //
    // Passa a exigir que o objeto REALMENTE atravanque: ou o centro dele está
    // no corredor, ou ele cobre o meio da imagem, ou morde um pedaço do
    // corredor que dê para esbarrar.
    const corte = Math.min(b.right, cfg.pathRight) - Math.max(b.left, cfg.pathLeft);
    const inPath = (cx > cfg.pathLeft && cx < cfg.pathRight)
      || (b.left < 0.5 && b.right > 0.5)
      || corte >= cfg.pathMinimo;
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
    this.ultimoPorObjeto = new Map();   // streakKey -> { ts, nucleo }
    this.silencio = new Map();          // classe -> até quando (ameaça já falou dela)
    this.lastAnyMs = null;
  }

  process(objects, nowMs) {
    // A chave do contador NAO pode conter a distancia: ela oscila de quadro a
    // quadro e zeraria o contador toda hora, fazendo o app nunca falar.
    // Contamos por classe e direcao; a distancia entra so na fala.
    //
    // QUAL CANDIDATO FICA COM A CHAVE: o MAIS GRAVE, não o primeiro da lista.
    //
    // Isto era um defeito de segurança, e o simulador só o revelou quando o
    // cenário "quadra" passou a posicionar os objetos pela geometria real.
    // Numa calçada com parquímetros ao longo do meio-fio, os de longe são
    // lidos como "à frente" — a 20 m, um metro de desvio lateral dá menos de
    // três graus. Eles chegavam primeiro na lista de detecções e tomavam a
    // chave `parking meter|à frente`, que é inofensiva: longe, fora do
    // caminho, prioridade BAIXA.
    //
    // Quando um poste PLANTADO NO MEIO DA CALÇADA aparecia, ele gerava a mesma
    // chave — e era descartado aqui, antes de qualquer decisão. Medido: o
    // poste no caminho era anunciado normalmente quando estava sozinho na
    // cena, e NUNCA era anunciado com os outros parquímetros em volta. Um
    // obstáculo real, no caminho, emudecido por mobiliário urbano da mesma
    // classe.
    //
    // Empate de prioridade fica com o mais próximo, pelo mesmo motivo.
    const byKey = new Map();
    for (const o of objects) {
      const c = this.#candidate(o);
      if (!c) continue;
      const atual = byKey.get(c.streakKey);
      if (!atual) { byKey.set(c.streakKey, c); continue; }
      const maisGrave = c.priority < atual.priority;
      const empateMaisPerto = c.priority === atual.priority
        && c.prox != null && atual.prox != null && c.prox < atual.prox;
      if (maisGrave || empateMaisPerto) byKey.set(c.streakKey, c);
    }
    // "pessoa à frente" e "pessoa com objeto pontiagudo à frente" descrevem a
    // mesma cena. O segundo contém o primeiro: falar os dois é ruído na hora
    // em que o usuário mais precisa de uma frase só.
    //
    // A comparação é por `chaveClasse` (classe|direção) e não pela chave do
    // contador, porque esta passou a ser a trilha do estabilizador quando ela
    // existe — identidade do objeto, não descrição dele.
    for (const c of [...byKey.values()]) {
      if (!c.comPessoa) continue;
      for (const [k, outro] of byKey) {
        if (outro !== c && outro.chaveClasse === `person|${c.direcao}`) byKey.delete(k);
      }
    }

    for (const k of [...this.streaks.keys()]) if (!byKey.has(k)) this.streaks.delete(k);
    for (const k of byKey.keys()) this.streaks.set(k, (this.streaks.get(k) ?? 0) + 1);

    let best = null;
    for (const c of byKey.values()) {
      if (c.priority === Priority.BAIXA) continue;
      // A classe sai de `chaveClasse`: `streakKey` pode ser uma trilha ("t12"),
      // que não carrega o nome da classe.
      if ((this.silencio.get((c.chaveClasse ?? c.streakKey).split("|")[0]) ?? -Infinity) > nowMs) continue;
      if ((this.streaks.get(c.streakKey) ?? 0) < this.requiredStreak) continue;
      const last = this.lastSpoken.get(c.key);
      if (last !== undefined && nowMs - last < this.repeatCooldownMs) continue;
      // Mesmo objeto, mesma distância, dito há pouco: subir de "Pessoa à
      // frente, a dois metros e meio" para "Atenção, pessoa à frente, a dois
      // metros e meio" no mesmo segundo repete a frase sem informação nova.
      const ult = this.ultimoPorObjeto.get(c.streakKey);
      if (ult) {
        // Antes este freio comparava a FRASE INTEIRA, com a distância dentro.
        // Andando por um carro parado, cada meio metro gerava uma frase nova
        // ("a oito metros", "a quatro metros e meio", "a dois metros e meio")
        // e o freio nunca pegava: o mesmo carro era anunciado três vezes por
        // quadra. Distância em metros não é novidade; MUDAR DE FAIXA é.
        // Gravidade e cadência são coisas diferentes, e misturá-las era o que
        // fazia o app repetir. A prioridade decide com que URGÊNCIA a primeira
        // menção sai; ela não deve decidir de quanto em quanto se insiste. Um
        // poste parado a dois metros é grave e merece "Atenção" — uma vez. Se
        // ele continuar parado, insistir a cada seis segundos não acrescenta
        // nada. Quem volta a falar é a mudança de faixa, logo acima, e essa só
        // vale para o que está no caminho ou vindo.
        // A cadência segue o que o objeto é para QUEM ANDA, não só o quanto
        // ele é grave. Vindo na sua direção: insiste. Parado no seu caminho:
        // insiste mais devagar, mas insiste — você vai esbarrar nele. Parado
        // ao seu lado: é cenário, fala uma vez e cala.
        const janela = c.vindo ? this.repeatCooldownMs
          : (c.noCaminho === true && c.priority === Priority.ALTA) ? this.repeatParadoMs / 2
            : this.repeatParadoMs;

        // Mudar de faixa só é notícia para o que ameaça. Um carro estacionado
        // à direita muda de faixa porque VOCÊ está andando — e a fila inteira
        // da quadra faria isso, um carro atrás do outro.
        const ameaca = c.noCaminho === true || c.vindo === true;
        const aproximou = ameaca && c.prox != null && ult.prox != null && c.prox < ult.prox;

        // Mudou de sentido, não de distância: o semáforo ficou verde, a pessoa
        // agora está com um objeto pontiagudo na mão. Isso fura qualquer
        // janela — é informação nova, não repetição.
        const mudouSentido = ult.sig != null && ult.sig !== c.sig;

        if (!aproximou && !mudouSentido && nowMs - ult.ts < janela) continue;
      }
      if (!best || c.priority < best.priority) best = c;
    }
    if (!best) return null;
    if (best.priority !== Priority.ALTA && this.lastAnyMs !== null
        && nowMs - this.lastAnyMs < this.minIntervalMs) return null;

    this.lastSpoken.set(best.key, nowMs);
    this.ultimoPorObjeto.set(best.streakKey, {
      ts: nowMs, prox: best.prox ?? null, sig: best.sig ?? null,
    });
    this.lastAnyMs = nowMs;
    return best;
  }

  reset() {
    this.streaks.clear(); this.lastSpoken.clear(); this.ultimoPorObjeto.clear();
    this.silencio.clear(); this.lastAnyMs = null;
  }

  /**
   * O avaliador de ameaças acabou de falar desta classe ("Pare. Moto vindo
   * pela direita"). Por alguns segundos o alerta comum não repete o mesmo
   * objeto com outras palavras.
   */
  silenciar(classe, ateMs) { this.silencio.set(classe, ateMs); }

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
    // Está de lado E escorregando para a borda: você está passando por ele.
    // A caixa de um carro estacionado a dois metros e meio toma meio quadro e
    // invade o corredor, então a geometria sozinha o chamava de obstáculo no
    // caminho — prioridade ALTA, com direito a insistir a cada seis segundos.
    // Era o "Atenção, carro à direita" de dez em dez passos, a quadra inteira.
    // MARCAÇÃO CONSTANTE, e não "já começou a se afastar".
    //
    // A versão anterior só reconhecia que a pessoa estava passando por um
    // objeto depois que a distância dele voltava a AUMENTAR — o que, num carro
    // estacionado, acontece quando ele já ficou para trás. Até lá ele era
    // "obstáculo perto, no seu caminho", prioridade ALTA, com "Atenção". No
    // cenário "quadra" do simulador isso rendia onze "Atenção, carro à
    // direita" e oito "Atenção, parquímetro à esquerda" em noventa segundos de
    // calçada em que não havia nada a desviar. É a queixa número um de quem
    // testou o app na rua: o alarme que ensina a ignorar alarme.
    //
    // `aoLado` vem de estavel.js e mede a deriva da marcação: o objeto está
    // escorregando para a borda do quadro, logo você vai passar por ele. Isso
    // fica evidente segundos antes de a distância aumentar.
    const passando = o.direction !== Direction.FRENTE
      && !vindo
      && (o.aoLado === true || o.afastando === true);
    const noCaminho = o.inPath === true && !passando;

    let priority = Priority.BAIXA;
    if (perto && (noCaminho || vindo)) priority = Priority.ALTA;
    else if (vehicle && vindo && (perto || medio)) priority = Priority.ALTA;
    else if (perto) priority = Priority.MEDIA;
    else if (medio && (noCaminho || vindo)) priority = Priority.MEDIA;

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
        chaveClasse: `${label}|${o.direction}`,
        key: `${label}|${o.direction}|${o.proximity}|${o.comPessoa ? "p" : ""}`,
        comPessoa: o.comPessoa === true,
        direcao: o.direction,
        dist: d,
        vindo: o.approaching === true,
        prox: o.proximity,
        noCaminho,
        sig: `${label}|${o.direction}|${o.comPessoa ? "p" : ""}`,
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
      prox: o.proximity,
      noCaminho,
      // ENTRAR NO SEU CAMINHO É INFORMAÇÃO NOVA, e `sig` é o campo que carrega
      // "mudou o sentido disto". Sem `noCaminho` aqui, um objeto anunciado
      // enquanto ainda estava de lado ficava preso à primeira menção, de
      // prioridade média, mesmo depois de passar a atravancar o corredor: o
      // freio de repetição não via novidade nenhuma e segurava o "Atenção".
      sig: `${label}|${o.direction}|${o.cor ?? ""}|${noCaminho ? "C" : ""}`,
      // A CHAVE DO ALERTA CONTINUA SENDO A DESCRIÇÃO, E NÃO A IDENTIDADE.
      //
      // Houve uma tentativa de trocá-la pela trilha do estabilizador, pensando
      // em dar ao freio de repetição uma identidade estável. O simulador
      // derrubou a ideia na hora: no cenário "quadra" as falas subiram de 37
      // para 60 em noventa segundos. O motivo é óbvio depois de medido — com
      // identidade própria, cada um dos vinte carros estacionados da quadra
      // vira um objeto inédito e ganha o direito a um aviso só dele. É
      // exatamente a descrição cumulativa que o usuário cego pede para não
      // ouvir: ele não quer saber de vinte carros, quer saber que há carros
      // estacionados à direita.
      //
      // A descrição é o que agrega. E o defeito que a trilha ia resolver — o
      // mesmo poste anunciado duas vezes, uma "à frente" e outra "à direita" —
      // já foi resolvido na raiz, pela histerese de `estavel.js`: a direção
      // não oscila mais, então a chave não troca mais.
      streakKey: `${label}|${o.direction}`,                                  // estavel entre quadros
      chaveClasse: `${label}|${o.direction}`,
      key: `${label}|${o.direction}|${o.proximity}|${o.cor ?? ""}`,          // governa o repetir
      // A FAMÍLIA é o que a habituação observa: não este poste, mas "poste à
      // esquerda, perto" como tipo de notícia. Trinta postes diferentes ao
      // longo de uma quadra produzem trinta chaves distintas e uma família só.
      // A FAMÍLIA NÃO CARREGA A FAIXA DE DISTÂNCIA, e isso foi medido.
      // Com a faixa dentro, "parquímetro à frente" em MÉDIO e em LONGE eram
      // duas famílias, cada uma com direito às suas três menções — e a mesma
      // frase ("a oito metros", que cobre de 7,5 a 8,4 m) passava por duas
      // portas diferentes. O canal de narração fragmentava ainda mais.
      // Para quem ouve, é tudo a mesma notícia: há um parquímetro à frente.
      familia: `${label}|${o.direction}`,
      plural: nome ? NOMES[label].plural : null,
      direcao: o.direction,
      // O QUE ESTÁ NO SEU CAMINHO NUNCA É PAISAGEM.
      //
      // A habituação protegia só a prioridade ALTA. O teste de persona achou o
      // buraco nessa proteção: um poste plantado no meio da calçada entra em
      // cena como prioridade MÉDIA (está longe ainda), e a família
      // `parquímetro à frente, médio` já tinha sido emudecida pelos
      // parquímetros do meio-fio da mesma quadra. Resultado medido: o aviso do
      // poste no caminho saiu a 3,5 m em vez de 8 m — a pessoa perdeu quatro
      // metros, que a 1,2 m/s são três segundos e meio.
      //
      // `noCaminho` já desconta o que está apenas de passagem (ver `passando`,
      // acima), então isto não reabre a torneira do mobiliário urbano: abre
      // só para o que atravanca de verdade.
      semHabituacao: noCaminho === true || priority === Priority.ALTA,
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

/** Teto para a velocidade do próprio usuário: acima disto é erro de medida. */
export const EGO_MAX_MS = 3;

export class MotionTracker {
  /**
   * @param velocidadeAproxMs m/s de fechamento RELATIVO a partir do qual algo
   *   conta como "se aproximando".
   * @param minReferencias quantos objetos imóveis bastam para medir o passo.
   */
  constructor({
    janelaMs = 1500,
    // O PISO DE RUÍDO. A distância sai da altura da caixa, então um erro de
    // 6% na caixa a sete metros já vale meio metro — e meio metro entre duas
    // amostras vira mais de 1 m/s de "velocidade" com tudo parado. Medido no
    // simulador: carros estacionados fechando a 1,8–6,0 m/s. Com o limiar em
    // 0,45 m/s, o ruído sozinho bastava para declarar aproximação, e era isso
    // que mantinha o "Cuidado, carro à direita" mesmo depois de descontado o
    // passo. 0,9 m/s fica acima do ruído e muito abaixo do que importa: uma
    // pessoa vindo de frente enquanto você anda fecha a ~2,4 m/s, e uma moto
    // ou um carro, a mais de 4.
    velocidadeAproxMs = 0.9,
    minReferencias = 1, janelaEgoMs = 3000,
    // Dois segundos de mediana, não um: metade do ruído, e uma aproximação
    // de verdade dura muito mais que isso.
    janelaRelMs = 2000,
    varreduraMinPorS = 0.12,
  } = {}) {
    Object.assign(this, {
      janelaMs, velocidadeAproxMs, minReferencias,
      janelaEgoMs, janelaRelMs, varreduraMinPorS,
    });
    this.hist = new Map();   // chave -> { d, ts }
    this.relHist = new Map(); // chave -> [{ v, ts }] fechamento relativo recente
    this.amostrasEgo = [];   // [{ v, ts }] — estimativas cruas do próprio passo
    this.egoMs = 0;          // velocidade de quem carrega o celular, suavizada
  }

  /**
   * Marca cada objeto com `approaching`, `closingMs` (fechamento bruto) e
   * `relativoMs` (fechamento descontado o próprio passo).
   *
   * O PORQUÊ DO DESCONTO. Andando a 1,2 m/s por uma fila de carros
   * estacionados, todos eles "se aproximam" a 1,2 m/s — e a versão anterior
   * marcava cada um como `approaching`, o que no AlertEngine vira prioridade
   * ALTA e prefixo "Cuidado". Numa quadra de bairro isso rendia vinte e um
   * "Cuidado, carro à direita" em um minuto: o alarme que ensina a ignorar
   * alarme. Descontando o passo, carro parado fica em zero e só fala quem
   * vem mesmo na direção da pessoa.
   *
   * @param egoMs velocidade do usuário em m/s, quando o GPS souber dizer.
   */
  update(objects, nowMs, { egoMs = null } = {}) {
    const vistos = new Set();

    // A chave do histórico é `classe|direção`, e numa rua isso COLIDE: seis
    // carros estacionados à direita dividem a mesma chave. Cada quadro, a
    // gravação era a do último carro da lista e a comparação, a de outro —
    // fechamento de dezenas de m/s com todo mundo parado, "se aproximando"
    // verdadeiro e "Cuidado, carro à direita" a quadra inteira.
    //
    // Quem interessa para desviar é sempre o MAIS PRÓXIMO de cada chave. Ele
    // fica com o histórico; os de trás não geram movimento. O AlertEngine já
    // se comporta assim (guarda um candidato por streakKey), então isto só
    // alinha o rastreio ao que o resto do app sempre fez.
    // Com o estabilizador ligado cada objeto tem trilha própria, e esta
    // disputa deixa de existir: cada chave tem um dono só. Sem ele, continua
    // valendo a regra do mais próximo.
    const chaveDe = (o) => o.trilha ?? `${o.detection.label}|${o.direction}`;
    const maisProximo = new Map();
    for (const o of objects) {
      if (o.distanceM == null) continue;
      const k = chaveDe(o);
      const atual = maisProximo.get(k);
      if (!atual || o.distanceM < atual.distanceM) maisProximo.set(k, o);
    }

    // 1ª passada: o fechamento bruto de cada objeto.
    const medidas = objects.map((o) => {
      const d = o.distanceM;
      const key = chaveDe(o);
      vistos.add(key);
      if (d == null) return { o, key, closingMs: null };
      // Está atrás de outro igual, na mesma direção: não é ele que você vai
      // encontrar primeiro, e medir o movimento dele só estraga a medida.
      if (maisProximo.get(key) !== o) return { o, key, closingMs: null, atras: true };

      const ant = this.hist.get(key);
      let closingMs = null;
      if (ant && nowMs > ant.ts && nowMs - ant.ts <= this.janelaMs) {
        closingMs = (ant.d - d) / ((nowMs - ant.ts) / 1000);
      }
      // só regrava quando passou tempo suficiente para a medida ter sentido
      if (!ant || nowMs - ant.ts >= 300) this.hist.set(key, { d, ts: nowMs });
      return { o, key, closingMs };
    });

    this.egoMs = this.#ego(medidas, egoMs, nowMs);

    // 2ª passada: o que sobra depois de descontar o próprio passo.
    //
    // E aqui o mesmo cuidado da régua, por um motivo diferente. A distância
    // sai da altura da caixa, e essa relação é inversa: a dois metros, um
    // pixel de tremor na caixa vale meio metro. Num quadro isolado isso
    // produz "fechamento" de vários m/s com o objeto parado — e era o que
    // ressuscitava o "Cuidado, carro à direita" bem na hora de passar por
    // ele. Uma aproximação de verdade dura; o tremor não. Vale a mediana de
    // cerca de um segundo.
    const saida = medidas.map(({ o, key, closingMs, atras }) => {
      if (closingMs == null) {
        // Um objeto atrás de outro igual divide a chave com ele: apagar aqui
        // destruiria o histórico de quem está na frente, justamente o que
        // interessa. Só quem fala pela chave pode esquecê-la.
        if (!atras) this.relHist.delete(key);
        return {
          ...o, approaching: false, afastando: false,
          closingMs: 0, relativoMs: 0, varreduraPorS: 0, egoMs: this.egoMs,
        };
      }
      const bruto = closingMs - this.egoMs;
      // Sem caixa não há marcação: a varredura fica em zero e o objeto nunca
      // é tomado por "estou passando por ele". Na dúvida, o app fala.
      const b = o.detection?.box;
      const excentricidade = b ? Math.abs((b.left + b.right) / 2 - 0.5) : 0.5;
      const serie = this.relHist.get(key) ?? [];
      serie.push({ v: bruto, e: excentricidade, ts: nowMs });
      while (serie.length && nowMs - serie[0].ts > this.janelaRelMs) serie.shift();
      this.relHist.set(key, serie);

      const v = serie.map((a) => a.v).sort((a, b2) => a - b2);
      const meio = Math.floor(v.length / 2);
      const relativoMs = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;

      // Marcação constante. É o teste que marinheiro e piloto usam para saber
      // se vão colidir, e vale igual aqui: o que vai te acertar permanece na
      // MESMA direção enquanto cresce; aquilo por que você passa escorrega
      // para a borda do quadro. Um carro estacionado por que você anda ao
      // lado tem a caixa enorme — a geometria sozinha não consegue separá-lo
      // de um obstáculo —, mas ele se afasta do centro depressa, e nada que
      // esteja prestes a te atingir faz isso.
      const primeiro = serie[0];
      const dt = (nowMs - primeiro.ts) / 1000;
      const varreduraPorS = dt >= 0.3 ? (excentricidade - primeiro.e) / dt : 0;

      return {
        ...o,
        approaching: relativoMs >= this.velocidadeAproxMs,
        afastando: varreduraPorS >= this.varreduraMinPorS,
        closingMs, relativoMs, varreduraPorS, egoMs: this.egoMs,
      };
    });

    for (const k of [...this.hist.keys()]) {
      if (!vistos.has(k) && nowMs - this.hist.get(k).ts > this.janelaMs) {
        this.hist.delete(k);
        this.relHist.delete(k);
      }
    }
    return saida;
  }

  /**
   * A velocidade de quem carrega o celular, por duas vias.
   *
   * O GPS é a boa: mede o deslocamento real e não se confunde com nada na
   * cena. Quando ele responde, manda. Sem GPS — dentro de prédio, sinal
   * ruim, GPS desligado — sobra a imagem: poste, banco e hidrante não andam,
   * então a mediana do fechamento DELES é o meu passo. Mediana, e não média,
   * porque uma caixa que tremeu não pode mover a estimativa.
   *
   * Sem referência nenhuma devolve 0, que é exatamente o comportamento
   * anterior: na dúvida o app fala demais, nunca de menos.
   */
  #ego(medidas, egoMs, nowMs) {
    if (egoMs != null && Number.isFinite(egoMs) && egoMs > 0) {
      this.amostrasEgo.length = 0;          // o GPS falou: a imagem não opina
      return Math.min(egoMs, EGO_MAX_MS);
    }

    // Numa calçada real quase nunca há dois postes na tela ao mesmo tempo —
    // exigir dois por quadro deixava a régua sem leitura e o desconto em zero,
    // que foi o que a primeira tentativa desta correção mediu. A robustez vem
    // do TEMPO: cada quadro contribui com o que tiver, e o que vale é a
    // mediana de uma janela de ~1 s. Uma caixa que tremeu num quadro não move
    // a estimativa; andar de verdade move.
    const refs = medidas
      .filter((m) => m.closingMs != null && IMOVEIS.has(m.o.detection.label))
      .map((m) => m.closingMs)
      .sort((a, b) => a - b);

    if (refs.length >= this.minReferencias) {
      const meio = Math.floor(refs.length / 2);
      const bruta = refs.length % 2 ? refs[meio] : (refs[meio - 1] + refs[meio]) / 2;
      this.amostrasEgo.push({ v: bruta, ts: nowMs });
    }
    while (this.amostrasEgo.length && nowMs - this.amostrasEgo[0].ts > this.janelaEgoMs) {
      this.amostrasEgo.shift();
    }
    if (this.amostrasEgo.length === 0) return 0;

    const v = this.amostrasEgo.map((a) => a.v).sort((a, b) => a - b);
    const meio = Math.floor(v.length / 2);
    const mediana = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
    // Mediana negativa é recuo: ninguém "se afasta" por eu estar andando de ré
    // a ponto de valer desconto. Zero.
    return mediana > 0 ? Math.min(mediana, EGO_MAX_MS) : 0;
  }

  reset() { this.hist.clear(); this.relHist.clear(); this.amostrasEgo.length = 0; this.egoMs = 0; }
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
          familia: `${label}|${o.direction}`,
          plural: nome.plural, direcao: o.direction,
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
          familia: `${label}|${o.direction}`,
          plural: nome.plural, direcao: o.direction,
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
          familia: `${label}|${o.direction}`,
          plural: nome.plural, direcao: o.direction,
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
