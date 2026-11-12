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
import { Canal, FilaDeFala, NarracaoDeAmbiente } from "../fala.js";
import { EstabilizadorEspacial } from "../estavel.js";

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

// Campo horizontal da câmera, deduzido do vertical de 48° num sensor 4:3.
const FOV_H_RAD = 2 * Math.atan(Math.tan(FOV_VERTICAL_RAD / 2) * (4 / 3));

/**
 * Objeto fixo no mundo, visto por quem anda — com a MARCAÇÃO CERTA.
 *
 * `det()` recebe a posição na imagem já pronta, e quem escreve o cenário
 * acaba deixando um carro estacionado em `cx = 0.88` o tempo todo. Isso é
 * fisicamente impossível: andando ao lado dele, a marcação abre para a borda
 * até ele sair do quadro. Um cenário com a marcação congelada esconde
 * justamente o sinal que distingue "vou passar por isto" de "vou bater
 * nisto", e foi assim que o simulador deixou passar onze "Atenção, carro à
 * direita" por quadra.
 *
 * @param dLong metros à frente (pode ficar negativo: já passou)
 * @param bLat  metros para o lado (positivo = direita)
 */
function detNoMundo(label, dLong, bLat, larguraRel) {
  const alcance = Math.hypot(dLong, bLat);
  const theta = Math.atan2(bLat, dLong);          // 0 = bem à frente
  const cx = 0.5 + theta / FOV_H_RAD;
  return { label, score: 0.9, box: caixaA(label, Math.max(0.6, alcance), cx, larguraRel), _cx: cx };
}

/** Está dentro do campo de visão da câmera? */
const visivel = (d) => d._cx > -0.05 && d._cx < 1.05 && d.box.right > 0 && d.box.left < 1;

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
  // O cenário que mede a queixa do usuário cego: "o app descreve a mesma
  // coisa várias vezes e os avisos ficam indo e vindo". Noventa segundos de
  // calçada comum, andando a 1,2 m/s por mobiliário urbano PARADO — carros
  // estacionados, postes, bancos, hidrantes — mais dois acontecimentos de
  // verdade no meio: uma pessoa que vem de frente e um poste no caminho.
  //
  // Tudo aqui é cenário, não é notícia. A régua é simples: o que a pessoa
  // ouve nesses 90 segundos deveria ser quase só os dois acontecimentos.
  "quadra": {
    titulo: "Noventa segundos de quadra: mobiliário parado e dois acontecimentos",
    duracaoS: 90,
    quadro: (t) => {
      const passo = 1.2;                       // m/s de quem anda
      const andou = t * passo;
      const itens = [];

      // Fila de carros estacionados na sarjeta, 1,8 m à direita de quem anda,
      // um a cada 6 m. Nenhum é notícia: eles "se aproximam" porque é a pessoa
      // que anda, e a marcação de cada um abre para a borda quando ela passa.
      for (let i = 0; i < 20; i++) itens.push(detNoMundo("car", 5 + i * 6 - andou, 1.8, 0.9));
      // Postes a 1,0 m à esquerda, a cada 15 m — perto o bastante para a caixa
      // invadir o corredor central.
      for (let i = 0; i < 8; i++) itens.push(detNoMundo("parking meter", 9 + i * 15 - andou, -1.0, 0.5));
      // Bancos encostados no muro, 2,2 m à esquerda, a cada 22 m.
      for (let i = 0; i < 5; i++) itens.push(detNoMundo("bench", 14 + i * 22 - andou, -2.2, 1.2));

      // Acontecimento 1: pessoa vindo de frente, entre 30 s e 42 s. Marcação
      // CONSTANTE e distância diminuindo: é isto que tem de falar.
      if (t > 30 && t < 42) itens.push(detNoMundo("person", Math.max(1.3, 14 - (t - 30) * 2.3), 0.1));
      // Acontecimento 2: poste plantado no meio da calçada, a partir de 60 s.
      if (t > 60) itens.push(detNoMundo("parking meter", Math.max(0.8, 20 - (t - 60) * passo), 0.05));

      return itens.filter((d) => d.box.bottom - d.box.top > 0.015 && visivel(d));
    },
  },

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
// Dois modos, de propósito. `--antigo` reproduz a política da versão 0.7, em
// que alerta e narração chamavam a voz direto; o modo normal roda a política
// atual, com fila de prioridade e narração agregada. Rodar os dois lado a
// lado é a forma de ver se uma mudança de política calou o que importava ou
// só calou o barulho.

function rodar(nome, {
  verbosidade = Verbosidade.NORMAL, antigo = false, estabilizar = true, silencioso = false,
} = {}) {
  const c = CENARIOS[nome];
  const estabilizador = new EstabilizadorEspacial();
  const motion = new MotionTracker();
  const alerts = new AlertEngine();
  const narrador = new Narrador();
  const ambiente = new NarracaoDeAmbiente(narrador);
  const fila = new FilaDeFala();
  const falas = [];

  // A voz do aparelho não é instantânea: enquanto ela fala, a fila segura o
  // resto. Sem modelar isso, o simulador aprovaria políticas que na prática
  // atropelam a própria voz. ~16 caracteres por segundo é a taxa da voz
  // pt-BR do sistema a 1,1 de velocidade.
  let falandoAte = 0;
  const duracaoDaFala = (t) => 350 + (t.length / 16) * 1000;

  const quadros = Math.round(c.duracaoS * FPS);
  for (let i = 0; i < quadros; i++) {
    const ts = i * PASSO_MS;
    const t = ts / 1000;

    const dets = c.quadro(t).map((d) => tremer(d));
    let objs = analyzeSpatial(dets);
    // Mesma ordem do app: estabilizar antes de qualquer decisão. `tremer()`
    // acima aplica ±4% de ruído na caixa, que é justamente o que faz direção e
    // faixa de distância oscilarem nos limites secos.
    if (estabilizar) objs = estabilizador.update(objs, ts);
    objs = motion.update(objs, ts);
    objs = associarCortantes(objs);
    for (const o of objs) {
      const orig = dets.find((d) => d.label === o.detection.label);
      if (orig?.cor) o.cor = orig.cor;
    }

    if (antigo) {
      const a = alerts.process(objs, ts);
      if (a) { falas.push({ t, text: a.text, tipo: "ALERTA", prio: a.priority }); continue; }
      const ev = narrador.evento(objs, ts, verbosidade);
      if (ev) falas.push({ t, text: ev.text, tipo: "narra", prio: Priority.BAIXA });
      continue;
    }

    const mudanca = ambiente.observar(objs, ts);
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
      const fala = ambiente.proxima(objs, ts, verbosidade, mudanca);
      if (fala) {
        const entrou = fila.oferecer({
          texto: fala.texto, canal: Canal.NARRACAO,
          chave: fala.eventos.map((e) => e.chave).join("+"),
          familia: fala.familia, plural: fala.plural, direcao: fala.direcao,
        }, ts);
        if (entrou) ambiente.confirmar(fala.eventos, ts);
      }
    }

    const saida = fila.proxima(ts, ts < falandoAte);
    if (saida) {
      falandoAte = ts + duracaoDaFala(saida.texto);
      falas.push({
        t, text: saida.texto,
        tipo: saida.canal === Canal.ALERTA ? "ALERTA" : "narra",
        prio: saida.item.prio ?? Priority.BAIXA,
      });
    }
  }

  if (silencioso) return falas;

  const PRIO = ["ALTA ", "MEDIA", "baixa"];
  const marca = antigo ? "  [política 0.7]" : "";
  console.log(`
${"=".repeat(74)}
${c.titulo}${marca}
  ${c.duracaoS}s a ${FPS} qps  ·  ${falas.length} falas  ·  ` +
    `1 fala a cada ${(c.duracaoS / Math.max(1, falas.length)).toFixed(1)}s
${"=".repeat(74)}`);
  if (falas.length === 0) console.log("  (SILÊNCIO TOTAL)");
  for (const f of falas) {
    console.log(`  ${f.t.toFixed(1).padStart(5)}s  ${PRIO[f.prio]}  ${f.tipo === "ALERTA" ? "!" : " "} ${f.text}`);
  }
  return falas;
}

const args = process.argv.slice(2);
const antigo = args.includes("--antigo");
const comparar = args.includes("--comparar");
const compararEstavel = args.includes("--comparar-estavel");
const semEstabilizador = args.includes("--sem-estabilizador");
const alvo = args.find((a) => !a.startsWith("--"));
const nomes = alvo && CENARIOS[alvo] ? [alvo] : Object.keys(CENARIOS);
if (alvo && !CENARIOS[alvo]) {
  console.error(`Cenário "${alvo}" não existe. Opções: ${Object.keys(CENARIOS).join(", ")}`);
  process.exit(1);
}

if (comparar) {
  console.log(`
Comparando a política de fala da 0.7 com a atual.
`);
  const linhas = [];
  for (const n of nomes) {
    const velho = rodar(n, { antigo: true });
    const novo = rodar(n);
    linhas.push({ n, velho: velho.length, novo: novo.length });
  }
  console.log(`
${"=".repeat(74)}
Falas por cenário
${"=".repeat(74)}`);
  for (const l of linhas) {
    const d = l.velho === 0 ? 0 : Math.round((1 - l.novo / l.velho) * 100);
    console.log(`  ${l.n.padEnd(14)} 0.7: ${String(l.velho).padStart(3)}   atual: ${String(l.novo).padStart(3)}   ${d >= 0 ? "-" : "+"}${Math.abs(d)}%`);
  }
} else if (compararEstavel) {
  console.log(`
Efeito do estabilizador espacial (histerese de direção, faixa e caminho).
A coluna "repetidas" conta falas cujo texto já tinha sido dito antes no mesmo
cenário: é a medida direta do que o usuário chama de "descrição cumulativa".
`);
  const linhas = [];
  for (const n of nomes) {
    const sem = rodar(n, { estabilizar: false, silencioso: true });
    const com = rodar(n, { estabilizar: true, silencioso: true });
    const repetidas = (f) => f.length - new Set(f.map((x) => x.text)).size;
    const alarmes = (f) => f.filter((x) => /^(Atenção|Cuidado|Pare)/.test(x.text)).length;
    linhas.push({
      n,
      semF: sem.length, comF: com.length,
      semR: repetidas(sem), comR: repetidas(com),
      semA: alarmes(sem), comA: alarmes(com),
    });
  }
  console.log(`${"=".repeat(78)}
${"cenário".padEnd(16)}${"falas".padStart(14)}${"repetidas".padStart(18)}${"com alarme".padStart(18)}
${"=".repeat(78)}`);
  for (const l of linhas) {
    console.log(`  ${l.n.padEnd(14)}`
      + `${String(l.semF).padStart(5)} -> ${String(l.comF).padEnd(5)}`
      + `${String(l.semR).padStart(10)} -> ${String(l.comR).padEnd(7)}`
      + `${String(l.semA).padStart(10)} -> ${String(l.comA).padEnd(6)}`);
  }
  console.log(`\n  (antes -> depois do estabilizador)`);
} else {
  for (const n of nomes) rodar(n, { antigo, estabilizar: !semEstabilizador });
}
console.log("");
