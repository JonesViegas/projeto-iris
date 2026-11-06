// Reconhecimento de vocabulário aberto.
//
// O detector principal do Íris (EfficientDet sobre COCO) conhece 80 classes
// fixas, escolhidas em 2014 para pesquisa acadêmica. Nessa lista há girafa,
// torradeira e prancha de surfe — e não há buraco, bueiro aberto, tapume de
// obra, piso tátil nem degrau. Ou seja: ele é ótimo em tudo que não derruba
// um cego na rua brasileira.
//
// Este módulo usa um modelo de vocabulário aberto (OWL-ViT): em vez de uma
// lista fechada, ele recebe FRASES e procura por elas na imagem. Isso dá ao
// app a capacidade de reconhecer qualquer coisa que se consiga nomear, sem
// treinar nada — inclusive os riscos de calçada que nenhum conjunto pronto
// cobre.
//
// O preço é o tempo: uma passada leva de 1 a 4 segundos num celular, contra
// 40 ms do detector fechado. Por isso ele NÃO roda no laço de quadros. Ele
// roda sob demanda (botão "O que tem aqui?") e em varreduras espaçadas do
// piso à frente, enquanto o detector rápido continua cuidando do que se move.
//
// A consulta vai em inglês porque o modelo foi treinado assim; o que o usuário
// ouve é sempre o nome em português da tabela.

const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
const MODELO = "Xenova/owlvit-base-patch32";

// ============================================================
// O vocabulário
// ============================================================
// Agrupado porque cada consulta custa tempo: o modelo compara a imagem com
// cada frase. Dezesseis frases por passada é o limite prático num celular, e
// os grupos se revezam entre as passadas — o piso, que é o que machuca, entra
// em todas.

export const Grupo = {
  PISO: "piso",            // o que faz cair: vai em toda varredura
  OBSTACULO: "obstaculo",  // o que faz tropeçar e bater
  TRAVESSIA: "travessia",  // o que ajuda a atravessar
  ACESSO: "acesso",        // portas, rampas, escadas, o que faz entrar
};

const r = (pt, plural, feminino, grupo, risco, consultas, limiar = 0.14) =>
  ({ pt, plural, feminino, grupo, risco, consultas, limiar });

/**
 * risco: "alto" vira alerta falado na hora; "medio" entra na descrição com
 * destaque; "info" só aparece quando o usuário pede a descrição.
 */
export const VOCABULARIO = [
  // ---------- o chão, que é onde se cai ----------
  r("buraco", "buracos", false, Grupo.PISO, "alto",
    ["a pothole in the pavement", "a hole in the ground"], 0.12),
  r("bueiro aberto", "bueiros abertos", false, Grupo.PISO, "alto",
    ["an open manhole", "a missing manhole cover", "an open storm drain"], 0.11),
  r("vala", "valas", true, Grupo.PISO, "alto",
    ["an open trench in the street", "a ditch in the ground"], 0.12),
  r("degrau", "degraus", false, Grupo.PISO, "alto",
    ["a single step on the ground", "a curb edge"]),
  r("calçada quebrada", "trechos de calçada quebrada", true, Grupo.PISO, "alto",
    ["broken cracked sidewalk pavement", "uneven broken paving stones"], 0.15),
  r("poça d'água", "poças d'água", true, Grupo.PISO, "medio",
    ["a puddle of water on the ground"]),
  r("vidro quebrado", "cacos de vidro", false, Grupo.PISO, "medio",
    ["broken glass on the ground"], 0.16),
  r("piso tátil", "faixas de piso tátil", false, Grupo.PISO, "info",
    ["yellow tactile paving strip for blind people", "tactile ground surface indicator"], 0.13),

  // ---------- o que está no caminho ----------
  r("tapume de obra", "tapumes de obra", false, Grupo.OBSTACULO, "alto",
    ["a construction barrier fence on the sidewalk", "construction site hoarding"]),
  r("cone de obra", "cones de obra", false, Grupo.OBSTACULO, "medio",
    ["an orange traffic cone"]),
  r("poste", "postes", false, Grupo.OBSTACULO, "medio",
    ["a utility pole on the sidewalk", "a lamp post"]),
  r("lixeira", "lixeiras", true, Grupo.OBSTACULO, "medio",
    ["a public trash bin on the street"]),
  r("mesa na calçada", "mesas na calçada", true, Grupo.OBSTACULO, "medio",
    ["a bar table on the sidewalk", "outdoor restaurant table and chairs"]),
  r("galho baixo", "galhos baixos", false, Grupo.OBSTACULO, "alto",
    ["a low hanging tree branch at head height"], 0.16),
  r("fio caído", "fios caídos", false, Grupo.OBSTACULO, "alto",
    ["a fallen power cable on the ground"], 0.17),
  r("carrinho de ambulante", "carrinhos de ambulante", false, Grupo.OBSTACULO, "medio",
    ["a street vendor food cart"]),
  r("moto na calçada", "motos na calçada", true, Grupo.OBSTACULO, "medio",
    ["a motorcycle parked on the sidewalk"]),
  r("patinete", "patinetes", false, Grupo.OBSTACULO, "medio",
    ["an electric scooter on the sidewalk"]),

  // ---------- atravessar ----------
  r("faixa de pedestre", "faixas de pedestre", true, Grupo.TRAVESSIA, "info",
    ["a zebra crosswalk painted on the road", "pedestrian crossing stripes"], 0.13),
  r("semáforo de pedestre", "semáforos de pedestre", false, Grupo.TRAVESSIA, "info",
    ["a pedestrian traffic light with a walking figure"]),
  r("botoeira", "botoeiras", true, Grupo.TRAVESSIA, "info",
    ["a pedestrian crossing push button pole"], 0.16),
  r("meio-fio", "meios-fios", false, Grupo.TRAVESSIA, "medio",
    ["a street curb edge at the sidewalk"]),
  r("lombada", "lombadas", true, Grupo.TRAVESSIA, "info",
    ["a speed bump on the road"]),

  // ---------- entrar e sair ----------
  r("porta", "portas", true, Grupo.ACESSO, "info",
    ["a building entrance door", "a glass door"]),
  r("escada", "escadas", true, Grupo.ACESSO, "alto",
    ["a staircase with several steps", "stairs going down"]),
  r("escada rolante", "escadas rolantes", true, Grupo.ACESSO, "alto",
    ["an escalator"]),
  r("rampa", "rampas", true, Grupo.ACESSO, "info",
    ["a wheelchair accessibility ramp"]),
  r("elevador", "elevadores", false, Grupo.ACESSO, "info",
    ["an elevator door in a building"]),
  r("catraca", "catracas", true, Grupo.ACESSO, "medio",
    ["a turnstile gate"]),
  r("corrimão", "corrimãos", false, Grupo.ACESSO, "info",
    ["a handrail along stairs"]),
  r("portão", "portões", false, Grupo.ACESSO, "medio",
    ["an open metal gate", "a garage entrance"]),
];

// Uma consulta pode pertencer a vários itens; este índice devolve o item a
// partir da frase que o modelo casou.
const POR_CONSULTA = new Map();
for (const item of VOCABULARIO) for (const c of item.consultas) POR_CONSULTA.set(c, item);

/** O piso entra em toda passada; o resto se reveza. */
// Dez e não dezesseis: cada consulta é uma passagem a mais pelo modelo, e num
// celular de 4 GB a diferença entre dez e dezesseis é a diferença entre
// devolver uma resposta e o navegador matar a aba.
export function montarConsultas(rodada = 0, maxConsultas = 10) {
  const piso = VOCABULARIO.filter((v) => v.grupo === Grupo.PISO);
  const outros = VOCABULARIO.filter((v) => v.grupo !== Grupo.PISO);
  const sel = [...piso];

  const inicio = (rodada * 4) % Math.max(1, outros.length);
  for (let i = 0; sel.length < maxConsultas && i < outros.length; i++) {
    sel.push(outros[(inicio + i) % outros.length]);
  }
  // uma frase por item mantém a passada barata; a segunda frase do item só
  // entra quando sobra orçamento
  const frases = sel.map((v) => v.consultas[0]);
  for (const v of sel) {
    if (frases.length >= maxConsultas) break;
    if (v.consultas[1]) frases.push(v.consultas[1]);
  }
  return frases.slice(0, maxConsultas);
}

// ============================================================
// O detector
// ============================================================

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

export class DetectorAberto {
  // 384 em vez de 512: o custo do OWL-ViT cresce com o quadrado do lado, então
  // essa redução corta ~44% da memória de ativação. A perda de acerto em
  // objeto grande e perto — buraco, degrau, tapume — é pequena, e é desses
  // que se trata aqui.
  constructor({ largura = 384 } = {}) {
    this.largura = largura;
    this.pipe = null;
    this.ocupado = false;
    this.rodada = 0;
    this.ultimoMs = 0;
    this.erro = null;
  }

  get pronto() { return this.pipe !== null; }

  async carregar(onProgresso) {
    if (this.pipe) return this.pipe;
    const mod = await import(TRANSFORMERS_URL);
    const { pipeline, env } = mod;
    this.RawImage = mod.RawImage ?? null;
    env.allowLocalModels = false;
    this.pipe = await pipeline("zero-shot-object-detection", MODELO, {
      dtype: "q8",
      progress_callback: onProgresso,
    });
    return this.pipe;
  }

  descarregar() {
    try { this.pipe?.dispose?.(); } catch { /* já foi */ }
    this.pipe = null;
  }

  /**
   * Uma varredura. Devolve detecções no MESMO formato do detector rápido, para
   * entrarem no analyzeSpatial sem tratamento especial — mais o campo `aberto`,
   * que marca a origem, e `pt`/`risco` vindos da tabela.
   *
   * `consultas` opcional: se não vier, usa o rodízio do vocabulário.
   */
  async varrer(video, { consultas = null, limiarGeral = null } = {}) {
    if (!this.pipe || this.ocupado) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    this.ocupado = true;
    const t0 = performance.now();
    try {
      const w = this.largura;
      const h = Math.round((vh / vw) * w);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      const frases = consultas ?? montarConsultas(this.rodada++);
      const entrada = this.RawImage ? this.RawImage.fromCanvas(canvas)
        : canvas.toDataURL("image/jpeg", 0.85);

      const saida = await this.pipe(entrada, frases, { threshold: 0.08, topk: 12 });

      const dets = [];
      for (const d of saida ?? []) {
        const item = POR_CONSULTA.get(d.label);
        const limiar = limiarGeral ?? item?.limiar ?? 0.15;
        if (d.score < limiar) continue;
        const b = d.box;
        dets.push({
          label: item ? `aberto:${item.pt}` : `aberto:${d.label}`,
          pt: item?.pt ?? d.label,
          plural: item?.plural ?? item?.pt ?? d.label,
          feminino: item?.feminino ?? false,
          risco: item?.risco ?? "info",
          grupo: item?.grupo ?? null,
          aberto: true,
          score: d.score,
          box: {
            left: Math.max(0, Math.min(1, b.xmin / w)),
            top: Math.max(0, Math.min(1, b.ymin / h)),
            right: Math.max(0, Math.min(1, b.xmax / w)),
            bottom: Math.max(0, Math.min(1, b.ymax / h)),
          },
        });
      }

      this.ultimoMs = Math.round(performance.now() - t0);
      this.erro = null;
      return { deteccoes: juntarDuplicatas(dets), ms: this.ultimoMs, frases };
    } catch (e) {
      this.erro = e;
      console.warn("Varredura aberta falhou", e);
      return null;
    } finally {
      this.ocupado = false;
    }
  }
}

/**
 * Duas frases do mesmo item ("a pothole" e "a hole in the ground") casam com o
 * mesmo buraco e virariam dois avisos. Fundimos caixas muito sobrepostas da
 * mesma classe, ficando com a de maior confiança.
 */
function juntarDuplicatas(dets, iouMin = 0.45) {
  const saida = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) {
    if (!saida.some((s) => s.label === d.label && iou(s.box, d.box) > iouMin)) saida.push(d);
  }
  return saida;
}

function iou(a, b) {
  const x0 = Math.max(a.left, b.left), y0 = Math.max(a.top, b.top);
  const x1 = Math.min(a.right, b.right), y1 = Math.min(a.bottom, b.bottom);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (inter === 0) return 0;
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  return inter / (areaA + areaB - inter);
}

// ============================================================
// Nomes para o núcleo
// ============================================================
// O core.js consulta NOMES[label] para flexionar a frase. As classes abertas
// nascem em tempo de execução, então entregamos a mesma forma de tabela para
// o app fundir com a dele.

export function nomesDoVocabulario() {
  const t = {};
  for (const v of VOCABULARIO) {
    t[`aberto:${v.pt}`] = { singular: v.pt, plural: v.plural, feminino: v.feminino };
  }
  return t;
}

/** Classes de vocabulário aberto que merecem alerta falado na hora. */
export function rotulosDeRisco() {
  return new Set(VOCABULARIO.filter((v) => v.risco === "alto").map((v) => `aberto:${v.pt}`));
}

/**
 * Altura típica, em metros, para a estimativa de distância do core.js.
 * Buraco e bueiro são medidos pela LARGURA aparente, não pela altura, então
 * aqui vai o valor que faz o cálculo por altura chegar perto — e, na dúvida,
 * erramos para perto, que é o erro seguro.
 */
export const ALTURAS_ABERTAS = {
  "aberto:buraco": 0.35, "aberto:bueiro aberto": 0.6, "aberto:vala": 0.8,
  "aberto:degrau": 0.18, "aberto:calçada quebrada": 0.4, "aberto:poça d'água": 0.3,
  "aberto:vidro quebrado": 0.15, "aberto:piso tátil": 0.4,
  "aberto:tapume de obra": 2.2, "aberto:cone de obra": 0.7, "aberto:poste": 6.0,
  "aberto:lixeira": 1.0, "aberto:mesa na calçada": 0.75, "aberto:galho baixo": 0.5,
  "aberto:fio caído": 0.2, "aberto:carrinho de ambulante": 1.4,
  "aberto:moto na calçada": 1.1, "aberto:patinete": 1.1,
  "aberto:faixa de pedestre": 2.5, "aberto:semáforo de pedestre": 0.6,
  "aberto:botoeira": 1.2, "aberto:meio-fio": 0.15, "aberto:lombada": 0.12,
  "aberto:porta": 2.1, "aberto:escada": 2.0, "aberto:escada rolante": 3.0,
  "aberto:rampa": 1.0, "aberto:elevador": 2.1, "aberto:catraca": 1.0,
  "aberto:corrimão": 0.9, "aberto:portão": 2.0,
};
