// Simulador do Projeto Íris — `node test/simular.mjs [cenario]`
//
// Sem câmera não dá para validar a política de fala. Aqui alimentamos o
// pipeline real (analyzeSpatial -> MotionTracker -> associarCortantes ->
// AlertEngine -> Narrador) com cenas sintéticas a 12 qps e imprimimos
// exatamente o que o usuário OUVIRIA, com o instante de cada fala.
//
// Isto testa a POLÍTICA DE FALA, não a qualidade do detector: as detecções
// aqui são perfeitas. Na rua o EfficientDet erra, e isso o simulador não mede.

import {
  analyzeSpatial, MotionTracker, AlertEngine, Narrador, Verbosidade,
  associarCortantes, Priority, ALTURA_REAL_M, FOV_VERTICAL_RAD,
} from "../core.js";

const FPS = 12;
const PASSO_MS = 1000 / FPS;

/** Caixa que um objeto de altura real H ocupa a D metros, centrado em cx. */
function caixaA(label, metros, cx = 0.5, larguraRel = 0.45) {
  const H = ALTURA_REAL_M[label] ?? 1.0;
  let h = H / (2 * metros * Math.tan(FOV_VERTICAL_RAD / 2));
  h = Math.min(0.96, h);
  const w = h * larguraRel;
  const top = Math.max(0.02, 0.55 - h / 2);
  return {
    left: Math.max(0, cx - w / 2), right: Math.min(1, cx + w / 2),
    top, bottom: Math.min(0.98, top + h),
  };
}

const det = (label, metros, cx, larguraRel) =>
  ({ label, score: 0.9, box: caixaA(label, metros, cx, larguraRel) });

/** Ruído de ±4% na caixa: o detector real treme entre quadros. */
function tremer(d, amp = 0.04) {
  const j = () => (Math.random() - 0.5) * 2 * amp;
  const h = d.box.bottom - d.box.top;
  const dy = j() * h;
  return { ...d, box: {
    left: Math.max(0, d.box.left + j() * h), right: Math.min(1, d.box.right + j() * h),
    top: Math.max(0, d.box.top + dy), bottom: Math.min(1, d.box.bottom + dy),
  } };
}

// ---------------- Cenários ----------------
const CENARIOS = {
  "calcada": {
    titulo: "Caminhando na calçada: carro parado à direita, pessoa vindo de frente",
    duracaoS: 12,
    quadro: (t) => [
      det("car", 6, 0.86, 0.9),                       // estacionado: não deve gritar
      det("person", Math.max(1.2, 9 - t * 0.9), 0.5), // vindo na nossa direção
      det("bench", 7, 0.2, 1.2),
    ],
  },

  "faca": {
    titulo: "Pessoa se aproximando com objeto pontiagudo na mão",
    duracaoS: 10,
    quadro: (t) => {
      const d = Math.max(1.3, 8 - t * 0.8);
      const pessoa = det("person", d, 0.5);
      // a faca fica na altura da mão, dentro da silhueta: caixa pequena de propósito
      const pb = pessoa.box;
      const mao = {
        left: pb.left + (pb.right - pb.left) * 0.62,
        right: pb.left + (pb.right - pb.left) * 0.80,
        top: pb.top + (pb.bottom - pb.top) * 0.52,
        bottom: pb.top + (pb.bottom - pb.top) * 0.66,
      };
      return [pessoa, { label: "knife", score: 0.72, box: mao }];
    },
  },

  "faca-solta": {
    titulo: "Objeto pontiagudo sozinho, sem pessoa (faca sobre a mesa)",
    duracaoS: 8,
    quadro: () => [det("knife", 1.4, 0.45, 2.2), det("dining table", 1.6, 0.5, 2.5)],
  },

  "pequenos": {
    titulo: "Objetos pequenos sobre uma mesa, a pouca distância",
    duracaoS: 10,
    quadro: () => [
      det("cup", 0.9, 0.35), det("cell phone", 0.8, 0.55),
      det("bottle", 1.1, 0.72), det("book", 1.0, 0.2),
    ],
  },

  "travessia": {
    titulo: "Esquina: semáforo vermelho e ônibus cruzando",
    duracaoS: 12,
    quadro: (t) => {
      const l = [{ ...det("traffic light", 7, 0.55, 0.35), cor: t < 6 ? "vermelho" : "verde" }];
      if (t > 2 && t < 8) l.push(det("bus", Math.max(4, 22 - t * 2.2), 0.3, 2.4));
      return l;
    },
  },
};

// ---------------- Execução ----------------
function rodar(nome, verbosidade = Verbosidade.NORMAL) {
  const c = CENARIOS[nome];
  const motion = new MotionTracker();
  const alerts = new AlertEngine();
  const narrador = new Narrador();
  const falas = [];

  const quadros = Math.round(c.duracaoS * FPS);
  for (let i = 0; i < quadros; i++) {
    const ts = i * PASSO_MS;
    const t = ts / 1000;

    const dets = c.quadro(t).map((d) => tremer(d));
    let objs = analyzeSpatial(dets);
    objs = motion.update(objs, ts);
    objs = associarCortantes(objs);
    for (const o of objs) {
      const orig = dets.find((d) => d.label === o.detection.label);
      if (orig?.cor) o.cor = orig.cor;
    }

    const a = alerts.process(objs, ts);
    if (a) { falas.push({ t, text: a.text, tipo: "ALERTA", prio: a.priority }); continue; }
    const ev = narrador.evento(objs, ts, verbosidade);
    if (ev) falas.push({ t, text: ev.text, tipo: "narra", prio: Priority.BAIXA });
  }

  const PRIO = ["ALTA ", "MEDIA", "baixa"];
  console.log(`\n${"=".repeat(74)}\n${c.titulo}\n  ${c.duracaoS}s a ${FPS} qps  ·  ${falas.length} falas  ·  ` +
    `1 fala a cada ${(c.duracaoS / Math.max(1, falas.length)).toFixed(1)}s\n${"=".repeat(74)}`);
  if (falas.length === 0) console.log("  (SILÊNCIO TOTAL)");
  for (const f of falas) {
    console.log(`  ${f.t.toFixed(1).padStart(5)}s  ${PRIO[f.prio]}  ${f.tipo === "ALERTA" ? "!" : " "} ${f.text}`);
  }
  return falas;
}

const alvo = process.argv[2];
const nomes = alvo && CENARIOS[alvo] ? [alvo] : Object.keys(CENARIOS);
if (alvo && !CENARIOS[alvo]) {
  console.error(`Cenário "${alvo}" não existe. Opções: ${Object.keys(CENARIOS).join(", ")}`);
  process.exit(1);
}
for (const n of nomes) rodar(n);
console.log("");
