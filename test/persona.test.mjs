// Personas: o app medido pelo que CADA pessoa precisa, e não pela média.
//
// POR QUE ISTO EXISTE. Os outros testes verificam regras ("a faixa não oscila",
// "a família se habitua"). Este verifica PESSOAS: monta a caminhada de alguém
// com um jeito específico de andar e de ouvir, e cobra do app um orçamento que
// aquela pessoa aguenta. Uma política de fala pode estar certa em todas as
// regras e ainda ser insuportável para quem anda devagar, ou surda demais para
// quem anda rápido.
//
// AS PERSONAS NÃO SÃO INVENÇÃO DE ESCRITÓRIO. Cada uma corresponde a um perfil
// de usuário de orientação e mobilidade, e as diferenças entre elas são as que
// mudam o que o app tem de fazer:
//
//   - a VELOCIDADE muda o tempo disponível. A 0,9 m/s sobram 4,4 s para
//     reagir a um obstáculo a 4 m; a 1,5 m/s sobram 2,7 s.
//   - a BENGALA já encontra o chão: o app que repete o que a bengala acabou
//     de dizer é ruído puro.
//   - o CÃO-GUIA já desvia de obstáculo fixo: o que o cão não resolve é
//     orientação — em que rua estou, quanto falta.
//   - a BAIXA VISÃO enxerga vulto e contraste: o que falta é o detalhe, não a
//     existência do objeto.
//   - a PERDA AUDITIVA parcial corta o orçamento de fala pela metade: cada
//     frase a mais é uma frase que compete com o trânsito pelo pouco que ela
//     escuta.
//
// Os números de aceite estão em ORCAMENTO, com a justificativa de cada um. Eles
// são o contrato: quem mudar a política de fala e quebrar um deles tem de
// defender o novo número, não ajustar o teste até passar.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeSpatial, AlertEngine, MotionTracker, Narrador, Verbosidade, Priority,
  associarCortantes, ALTURA_REAL_M, FOV_VERTICAL_RAD,
} from "../core.js";
import { Canal, FilaDeFala, NarracaoDeAmbiente } from "../fala.js";
import { EstabilizadorEspacial, confirmados } from "../estavel.js";

// ============================================================
// Mundo
// ============================================================

const FPS = 12;
const PASSO_MS = 1000 / FPS;
const FOV_H_RAD = 2 * Math.atan(Math.tan(FOV_VERTICAL_RAD / 2) * (4 / 3));

function caixa(label, alcance, cx, larguraRel = 0.45) {
  const H = ALTURA_REAL_M[label] ?? 1.0;
  let h = Math.min(0.96, H / (2 * alcance * Math.tan(FOV_VERTICAL_RAD / 2)));
  const w = h * larguraRel;
  const top = Math.max(0.02, 0.55 - h / 2);
  return {
    left: Math.max(0, cx - w / 2), right: Math.min(1, cx + w / 2),
    top, bottom: Math.min(0.98, top + h),
  };
}

/** Objeto parado no mundo, visto por quem anda. dLong à frente, bLat ao lado. */
function noMundo(label, dLong, bLat, larguraRel) {
  const alcance = Math.max(0.6, Math.hypot(dLong, bLat));
  const cx = 0.5 + Math.atan2(bLat, dLong) / FOV_H_RAD;
  return { label, score: 0.9, box: caixa(label, alcance, cx, larguraRel), _cx: cx, _d: dLong };
}

const visivel = (d) => d._cx > -0.05 && d._cx < 1.05 && (d.box.bottom - d.box.top) > 0.015;

/** Ruído de caixa: o detector real treme entre quadros. */
function tremer(d, aleatorio, amp = 0.04) {
  const h = d.box.bottom - d.box.top;
  const j = () => (aleatorio() - 0.5) * 2 * amp * h;
  const dy = j();
  return { ...d, box: {
    left: Math.max(0, d.box.left + j()), right: Math.min(1, d.box.right + j()),
    top: Math.max(0, d.box.top + dy), bottom: Math.min(1, d.box.bottom + dy),
  } };
}

/** Gerador determinístico: um teste que falha de vez em quando não é teste. */
function aleatorioFixo(semente = 7) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ============================================================
// A caminhada
// ============================================================

/**
 * Uma quadra de calçada comum: mobiliário urbano parado dos dois lados, mais
 * os obstáculos que a persona vai de fato encontrar.
 */
function quadra({ velocidadeMs, duracaoS, obstaculos = [] }) {
  return (t) => {
    const andou = t * velocidadeMs;
    const itens = [];
    for (let i = 0; i < 24; i++) itens.push(noMundo("car", 5 + i * 6 - andou, 1.8, 0.9));
    for (let i = 0; i < 10; i++) itens.push(noMundo("parking meter", 9 + i * 15 - andou, -1.0, 0.5));
    for (let i = 0; i < 6; i++) itens.push(noMundo("bench", 14 + i * 22 - andou, -2.2, 1.2));
    for (const o of obstaculos) {
      if (t < o.de || t > o.ate) continue;
      const d = o.distanciaEm(t, andou);
      if (d > 0.5) itens.push(noMundo(o.classe, d, o.lateral ?? 0.05, o.largura));
    }
    return itens.filter(visivel);
  };
}

/** Roda a caminhada e devolve tudo o que a pessoa ouviu, com o instante. */
function caminhar({ cena, duracaoS, verbosidade = Verbosidade.NORMAL, semente = 7 }) {
  const rnd = aleatorioFixo(semente);
  const estabilizador = new EstabilizadorEspacial();
  const motion = new MotionTracker();
  const alerts = new AlertEngine();
  const ambiente = new NarracaoDeAmbiente(new Narrador());
  const fila = new FilaDeFala();
  const falas = [];

  // A voz do aparelho não é instantânea: enquanto fala, a fila segura o resto.
  let falandoAte = 0;
  const duracaoDaFala = (t) => 350 + (t.length / 16) * 1000;

  for (let i = 0; i < Math.round(duracaoS * FPS); i++) {
    const ts = i * PASSO_MS;
    const t = ts / 1000;

    const dets = cena(t).map((d) => tremer(d, rnd));
    let objs = analyzeSpatial(dets);
    objs = estabilizador.update(objs, ts);
    objs = motion.update(objs, ts);
    objs = associarCortantes(objs);

    const estaveis = confirmados(objs);
    const mudanca = ambiente.observar(estaveis, ts);
    const a = alerts.process(objs, ts);
    if (a) {
      fila.calarAbaixoDe(Canal.ALERTA);
      fila.oferecer({
        texto: a.text, canal: Canal.ALERTA, chave: a.key,
        urgente: a.priority === Priority.ALTA, prio: a.priority,
        familia: a.familia, plural: a.plural, direcao: a.direcao,
        semHabituacao: a.semHabituacao,
      }, ts);
    } else {
      const f = ambiente.proxima(estaveis, ts, verbosidade, mudanca);
      if (f) {
        const entrou = fila.oferecer({
          texto: f.texto, canal: Canal.NARRACAO,
          chave: f.eventos.map((e) => e.chave).join("+"),
          familia: f.familia, plural: f.plural, direcao: f.direcao,
        }, ts);
        if (entrou) ambiente.confirmar(f.eventos, ts);
      }
    }

    const saida = fila.proxima(ts, ts < falandoAte);
    if (saida) {
      falandoAte = ts + duracaoDaFala(saida.texto);
      falas.push({ t, texto: saida.texto, canal: saida.canal, prio: saida.item.prio ?? Priority.BAIXA });
    }
  }
  return falas;
}

// ============================================================
// As personas e o orçamento de cada uma
// ============================================================

const PERSONAS = {
  bengala: {
    quem: "Cegueira total de nascença, usa bengala longa, anda em ritmo firme.",
    velocidadeMs: 1.2,
    // A bengala já encontra o chão à frente. O que o app acrescenta é o que
    // está acima da linha da bengala e o que vem de longe.
    falasPorMinuto: 10,
    verbosidade: Verbosidade.NORMAL,
  },
  caoGuia: {
    quem: "Cegueira adquirida, usa cão-guia, anda rápido.",
    velocidadeMs: 1.5,
    // O cão já desvia de obstáculo fixo. Falar de cada poste é falar por cima
    // do trabalho do cão — e a pessoa aprende a ignorar o app.
    falasPorMinuto: 8,
    verbosidade: Verbosidade.NORMAL,
  },
  baixaVisao: {
    quem: "Baixa visão: enxerga vulto e contraste, perde o detalhe e o degrau.",
    velocidadeMs: 1.0,
    falasPorMinuto: 12,
    verbosidade: Verbosidade.NORMAL,
  },
  idosa: {
    quem: "Cegueira adquirida aos 60, perda auditiva parcial, anda devagar.",
    velocidadeMs: 0.8,
    // Perda auditiva corta o orçamento: cada frase a mais compete com o
    // trânsito pelo pouco que ela escuta. E andando devagar ela tem mais tempo
    // para reagir, então o app pode falar menos e mais cedo.
    falasPorMinuto: 6,
    verbosidade: Verbosidade.PERIGOS,
  },
};

// ============================================================
// Os testes
// ============================================================

test("nenhuma persona ouve mais do que aguenta numa quadra comum", () => {
  const duracaoS = 120;
  for (const [nome, p] of Object.entries(PERSONAS)) {
    const falas = caminhar({
      cena: quadra({ velocidadeMs: p.velocidadeMs, duracaoS }),
      duracaoS, verbosidade: p.verbosidade,
    });
    const porMinuto = (falas.length / duracaoS) * 60;
    assert.ok(porMinuto <= p.falasPorMinuto,
      `${nome} (${p.quem}) ouviu ${porMinuto.toFixed(1)} falas/min, `
      + `e o orçamento é ${p.falasPorMinuto}. Falas: ${falas.length} em ${duracaoS}s.`);
  }
});

test("nenhuma frase é repetida mais de três vezes em dois minutos", () => {
  // O limite da descrição cumulativa. Três é generoso: a primeira informa, a
  // segunda confirma, a terceira já é a pessoa percebendo que o app está
  // recitando o cenário.
  const duracaoS = 120;
  for (const [nome, p] of Object.entries(PERSONAS)) {
    const falas = caminhar({
      cena: quadra({ velocidadeMs: p.velocidadeMs, duracaoS }),
      duracaoS, verbosidade: p.verbosidade,
    });
    const contagem = new Map();
    for (const f of falas) contagem.set(f.texto, (contagem.get(f.texto) ?? 0) + 1);
    const demais = [...contagem].filter(([, n]) => n > 3);
    assert.deepEqual(demais, [],
      `${nome} ouviu a mesma frase vezes demais: ${demais.map(([t, n]) => `"${t}" ${n}x`).join("; ")}`);
  }
});

test("o obstáculo no caminho é avisado com tempo de reagir — para TODAS", () => {
  // O teste que o app não pode falhar. Um poste plantado no meio da calçada,
  // em cada ritmo de caminhada. A exigência é em METROS, não em segundos,
  // porque o que define se dá para parar é a distância que sobra: quatro
  // metros são três passos, e é o mínimo com que uma bengala longa ainda
  // encontra o obstáculo antes do corpo.
  const MIN_M = 4.0;
  for (const [nome, p] of Object.entries(PERSONAS)) {
    const duracaoS = 60;
    const aparece = 20;
    const distanciaInicial = 25;
    const cena = quadra({
      velocidadeMs: p.velocidadeMs, duracaoS,
      obstaculos: [{
        classe: "parking meter", de: aparece, ate: duracaoS, lateral: 0.05, largura: 0.5,
        distanciaEm: (t) => distanciaInicial - (t - aparece) * p.velocidadeMs,
      }],
    });
    const falas = caminhar({ cena, duracaoS, verbosidade: p.verbosidade });

    const sobre = falas.filter((f) => /parquímetro/i.test(f.texto) && f.t >= aparece);
    assert.ok(sobre.length > 0, `${nome}: o poste no caminho NUNCA foi anunciado`);

    const primeira = sobre[0];
    const distanciaNoAviso = distanciaInicial - (primeira.t - aparece) * p.velocidadeMs;
    assert.ok(distanciaNoAviso >= MIN_M,
      `${nome} (${p.velocidadeMs} m/s) só foi avisada a ${distanciaNoAviso.toFixed(1)} m `
      + `do poste; o mínimo é ${MIN_M} m. Aviso aos ${primeira.t.toFixed(1)}s: "${primeira.texto}"`);
  }
});

test("perigo não se habitua: a pessoa que vem de frente é anunciada toda vez", () => {
  // A prova de que a habituação não cegou o app. Três pessoas diferentes vêm
  // de frente ao longo de dois minutos, com intervalo entre elas. Todas têm de
  // ser anunciadas — a terceira é tão perigosa quanto a primeira.
  const duracaoS = 150;
  const p = PERSONAS.bengala;
  const encontros = [25, 70, 115];
  const cena = quadra({
    velocidadeMs: p.velocidadeMs, duracaoS,
    obstaculos: encontros.map((quando) => ({
      classe: "person", de: quando, ate: quando + 10, lateral: 0.1, largura: 0.45,
      distanciaEm: (t) => 14 - (t - quando) * 2.4,   // fechamento de quem vem andando
    })),
  });
  const falas = caminhar({ cena, duracaoS });

  for (const quando of encontros) {
    const avisou = falas.some((f) => /pessoa/i.test(f.texto) && f.t >= quando && f.t <= quando + 11);
    assert.ok(avisou, `a pessoa que apareceu aos ${quando}s não foi anunciada — `
      + "a habituação não pode alcançar o que vem na sua direção");
  }
});

test("cena parada é silêncio: parada num ponto, a pessoa não ouve nada novo", () => {
  // Esperando o ônibus, o mundo não muda. O app que continua narrando um poste
  // imóvel é o app que a pessoa desliga — e desligado ele não avisa de nada.
  const duracaoS = 60;
  const cena = () => [
    noMundo("parking meter", 3.0, -1.0, 0.5),
    noMundo("bench", 4.0, -2.2, 1.2),
    noMundo("car", 6.0, 1.8, 0.9),
  ].filter(visivel);

  const falas = caminhar({ cena, duracaoS });
  const depoisDosDez = falas.filter((f) => f.t > 10);
  assert.ok(depoisDosDez.length <= 1,
    `parada no mesmo ponto, ouviu ${depoisDosDez.length} falas depois dos 10 s: `
    + depoisDosDez.map((f) => `${f.t.toFixed(0)}s "${f.texto}"`).join(" | "));
});

test("o modo 'só perigos' não cala o perigo", () => {
  // Quem reduz a verbosidade está pedindo menos conversa, não menos segurança.
  // Se "só perigos" calasse o obstáculo, o ajuste viraria uma armadilha.
  const duracaoS = 40;
  const cena = quadra({
    velocidadeMs: 1.2, duracaoS,
    obstaculos: [{
      classe: "parking meter", de: 10, ate: duracaoS, lateral: 0.05, largura: 0.5,
      distanciaEm: (t) => 20 - (t - 10) * 1.2,
    }],
  });
  const falas = caminhar({ cena, duracaoS, verbosidade: Verbosidade.PERIGOS });
  assert.ok(falas.some((f) => /parquímetro/i.test(f.texto)),
    "o obstáculo no caminho sumiu no modo 'só perigos'");
});

test("a quadra sem acontecimento nenhum é quase silenciosa", () => {
  // O caso que define se o app é companhia ou tormento: dois minutos de
  // calçada em que nada acontece. Mobiliário urbano parado dos dois lados e
  // nada no caminho. Se isto não for quase silêncio, o app está narrando a
  // paisagem — e a pessoa vai desligar o som antes do dia em que precisar.
  const duracaoS = 120;
  const falas = caminhar({ cena: quadra({ velocidadeMs: 1.2, duracaoS }), duracaoS });
  const alarmes = falas.filter((f) => /^(Atenção|Cuidado|Pare)/.test(f.texto));
  assert.ok(alarmes.length === 0,
    `nada no caminho e mesmo assim ${alarmes.length} alarme(s): `
    + alarmes.map((f) => `${f.t.toFixed(0)}s "${f.texto}"`).join(" | "));
});
