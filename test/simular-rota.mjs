// Simulador da navegação a pé — `node test/simular-rota.mjs [cenario]`
//
// Testar guia de pedestre andando na rua com um usuário cego é caro, lento e,
// se a política estiver errada, perigoso. Aqui a pessoa anda numa rota
// sintética a 1,2 m/s, com o erro de GPS da cidade, e o programa imprime
// exatamente o que ela ouviria e em que metro.
//
// O que isto valida: a política de locução — quando prepara, quando manda
// executar, quando cala, quando recalcula, e o que acontece sem bússola.
// O que isto NÃO valida: a qualidade do traçado do Google ou do OSRM.

import { Navegador, distanciaM, rumo, distanciaFalada } from "../navegacao.js";
import { Canal, FilaDeFala } from "../fala.js";

const PASSO_MS = 1000;
const VELOCIDADE_MS = 1.2;        // caminhada tranquila de pedestre

const P = (lat, lng) => ({ lat, lng });
const BASE = P(-15.5989, -56.0949);   // Cuiabá, centro

const mover = (p, dn, de) => P(
  p.lat + dn / 111320,
  p.lng + de / (111320 * Math.cos(p.lat * Math.PI / 180)),
);

/** Interpola um ponto a `m` metros ao longo de a->b. */
function aoLongo(a, b, m) {
  const total = distanciaM(a, b);
  const t = Math.min(1, m / Math.max(0.001, total));
  return P(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
}

/** Erro de GPS urbano: 6 m de desvio típico, pior entre prédios. */
function comRuido(p, precisaoM) {
  const ang = Math.random() * Math.PI * 2;
  const r = Math.random() * precisaoM * 0.6;
  return { ...mover(p, Math.cos(ang) * r, Math.sin(ang) * r), precisaoM };
}

function trecho(a, b, instrucao, via) {
  return {
    instrucao, via, distanciaM: distanciaM(a, b),
    inicio: a, fim: b, polilinha: [a, b],
  };
}

// ---------------- Cenários ----------------

function rotaEmL() {
  const a = BASE;
  const b = mover(a, 0, 180);        // 180 m para leste
  const c = mover(b, 140, 0);        // 140 m para norte
  return {
    destino: { nome: "Farmácia Central", ...c },
    distanciaM: 320, duracaoS: 270,
    passos: [
      trecho(a, b, "Siga pela Rua Barão de Melgaço", "Rua Barão de Melgaço"),
      trecho(b, c, "Vire à esquerda na Avenida Getúlio Vargas", "Avenida Getúlio Vargas"),
    ],
  };
}

function rotaComTravessia() {
  const a = BASE;
  const b = mover(a, 0, 90);
  const c = mover(b, 0, 14);         // a travessia em si
  const d = mover(c, 0, 120);
  return {
    destino: { nome: "Ponto de ônibus da praça", ...d },
    distanciaM: 224, duracaoS: 190,
    passos: [
      trecho(a, b, "Siga pela Rua Pedro Celestino", "Rua Pedro Celestino"),
      trecho(b, c, "Atravesse a Rua Comandante Costa", "Rua Comandante Costa"),
      trecho(c, d, "Siga pela Rua Pedro Celestino", "Rua Pedro Celestino"),
    ],
  };
}

const CENARIOS = {
  "esquina": {
    titulo: "Rota em L: 180 m, vira à esquerda, mais 140 m",
    rota: rotaEmL, bussola: true, precisaoM: 6, desviar: false,
  },
  "sem-bussola": {
    // Pior caso real: iPhone sem permissão de bússola E sem curso do GPS.
    // Aqui o app não pode dizer esquerda nem direita — e não diz.
    titulo: "A mesma rota, sem bússola e sem curso do GPS",
    rota: rotaEmL, bussola: false, semCurso: true, precisaoM: 6, desviar: false,
  },
  "gps-ruim": {
    titulo: "A mesma rota com GPS ruim (entre prédios altos)",
    rota: rotaEmL, bussola: true, precisaoM: 35, desviar: false,
  },
  "travessia": {
    titulo: "Rota com travessia de rua no meio",
    rota: rotaComTravessia, bussola: true, precisaoM: 6, desviar: false,
  },
  "desvio": {
    titulo: "A pessoa erra a esquina e sai do caminho",
    rota: rotaEmL, bussola: true, precisaoM: 6, desviar: true,
  },
};

// ---------------- Execução ----------------

function rodar(nome) {
  const c = CENARIOS[nome];
  const rota = c.rota();
  const nav = new Navegador();
  const fila = new FilaDeFala();
  const falas = [];

  let falandoAte = 0;
  const duracaoDaFala = (t) => 350 + (t.length / 16) * 1000;

  const inicio = nav.iniciar(rota);
  fila.oferecer({ texto: inicio.texto, canal: Canal.NAVEGACAO, chave: inicio.chave, validadeMs: 20000 }, 0);

  // Caminho verdadeiro: os trechos da rota, emendados, com um desvio opcional.
  const pernas = rota.passos.map((p) => [p.inicio, p.fim]);
  if (c.desviar) {
    // segue reto em vez de virar: o erro clássico de quem não vê a esquina
    const esquina = rota.passos[0].fim;
    pernas[1] = [esquina, mover(esquina, 0, 70)];
  }

  let perna = 0;
  let andado = 0;
  let ts = 0;
  const limiteS = 400;

  while (perna < pernas.length && ts / 1000 < limiteS) {
    const [a, b] = pernas[perna];
    const comprimento = distanciaM(a, b);
    if (andado > comprimento) { perna++; andado = 0; continue; }

    const verdade = aoLongo(a, b, andado);
    const lido = comRuido(verdade, c.precisaoM);
    const rumoReal = rumo(a, b);

    const eventos = nav.atualizar(
      { ...lido, velocidadeMs: VELOCIDADE_MS, rumoGraus: c.semCurso ? null : rumoReal },
      c.bussola ? rumoReal : null,
      ts,
    );

    for (const ev of eventos) {
      fila.oferecer({
        texto: ev.texto, canal: Canal.NAVEGACAO, chave: ev.chave,
        urgente: ev.urgente, tipoEv: ev.tipo,
      }, ts);
      if (ev.recalcular) { falas.push({ t: ts / 1000, text: "«recalcula»", tipo: "SIST" }); }
    }

    const saida = fila.proxima(ts, ts < falandoAte);
    if (saida) {
      falandoAte = ts + duracaoDaFala(saida.texto);
      falas.push({
        t: ts / 1000, text: saida.texto,
        tipo: saida.item.urgente ? "AGORA" : "aviso",
        metros: Math.round(andado + pernas.slice(0, perna).reduce((s, [x, y]) => s + distanciaM(x, y), 0)),
      });
    }

    if (!nav.ativo) break;
    andado += VELOCIDADE_MS * (PASSO_MS / 1000);
    ts += PASSO_MS;
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(c.titulo);
  console.log(`  ${distanciaFalada(rota.distanciaM)}  ·  bússola: ${c.bussola ? "sim" : "não"}`
    + `  ·  precisão do GPS: ${c.precisaoM} m  ·  ${falas.length} falas`);
  console.log("=".repeat(74));
  for (const f of falas) {
    const m = f.metros != null ? `${String(f.metros).padStart(4)} m` : "     ";
    console.log(`  ${String(Math.round(f.t)).padStart(4)}s ${m}  ${f.tipo.padEnd(5)} ${f.text}`);
  }
  if (!nav.chegou && !c.desviar) console.log("  (não chegou dentro do tempo)");
  return falas;
}

const alvo = process.argv[2];
if (alvo && !CENARIOS[alvo]) {
  console.error(`Cenário "${alvo}" não existe. Opções: ${Object.keys(CENARIOS).join(", ")}`);
  process.exit(1);
}
for (const n of alvo ? [alvo] : Object.keys(CENARIOS)) rodar(n);
console.log("");
