import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distanciaM, rumo, diferencaAngular, distanciaAPolilinha, cardeal, giroFalado,
  distanciaFalada, ladoDoDestino, ehTravessia, Navegador, referenciaNoLado,
} from "../navegacao.js";
import { NOMES, Direction } from "../core.js";

// Cuiabá, para os números saírem de um lugar real.
const P = (lat, lng) => ({ lat, lng });
const BASE = P(-15.601, -56.097);

/** Desloca um ponto em metros: dn para o norte, de para o leste. */
const mover = (p, dn, de) => P(
  p.lat + dn / 111320,
  p.lng + de / (111320 * Math.cos(p.lat * Math.PI / 180)),
);

// ---------------- Geodésia ----------------

test("distância bate com o deslocamento conhecido", () => {
  const d = distanciaM(BASE, mover(BASE, 100, 0));
  assert.ok(Math.abs(d - 100) < 1, `esperava ~100 m, veio ${d}`);
});

test("rumo: norte é 0, leste é 90", () => {
  assert.ok(Math.abs(rumo(BASE, mover(BASE, 100, 0))) < 1);
  assert.ok(Math.abs(rumo(BASE, mover(BASE, 0, 100)) - 90) < 1);
});

test("diferença angular tem sinal e não passa de 180", () => {
  assert.equal(diferencaAngular(0, 90), 90);
  assert.equal(diferencaAngular(0, 270), -90);
  assert.equal(diferencaAngular(350, 10), 20, "deve cruzar o zero sem explodir");
});

test("distância à polilinha mede o desvio real do caminho", () => {
  const linha = [BASE, mover(BASE, 0, 100)];           // 100 m para o leste
  const fora = mover(BASE, 30, 50);                     // 30 m ao norte do meio
  assert.ok(Math.abs(distanciaAPolilinha(fora, linha) - 30) < 2);
  assert.ok(distanciaAPolilinha(mover(BASE, 0, 50), linha) < 2, "em cima da linha");
});

// ---------------- Linguagem ----------------

test("cardeal arredonda para os oito rumos", () => {
  assert.equal(cardeal(0), "norte");
  assert.equal(cardeal(44), "nordeste");
  assert.equal(cardeal(91), "leste");
  assert.equal(cardeal(359), "norte");
});

test("giro pequeno não vira instrução: é tremor de bússola", () => {
  assert.equal(giroFalado(5), "siga em frente");
  assert.equal(giroFalado(-15), "siga em frente");
  assert.equal(giroFalado(90), "vire à direita");
  assert.equal(giroFalado(-90), "vire à esquerda");
  assert.equal(giroFalado(30), "vire levemente à direita");
  assert.equal(giroFalado(175), "dê meia-volta");
});

test("distância curta vem também em passos", () => {
  assert.equal(distanciaFalada(2), "bem à sua frente");
  assert.match(distanciaFalada(15), /15 metros, uns \d+ passos/);
  assert.equal(distanciaFalada(64), "60 metros");
  assert.equal(distanciaFalada(1500), "1,5 quilômetros");
});

test("lado do destino", () => {
  assert.equal(ladoDoDestino(10), "bem à sua frente");
  assert.equal(ladoDoDestino(80), "à sua direita");
  assert.equal(ladoDoDestino(-80), "à sua esquerda");
  assert.equal(ladoDoDestino(170), "atrás de você");
});

test("travessia é reconhecida pelo texto, em português e inglês", () => {
  assert.ok(ehTravessia("Atravesse a Avenida Historiador Rubens de Mendonça"));
  assert.ok(ehTravessia("Cross the street"));
  assert.ok(!ehTravessia("Vire à direita na Rua Barão de Melgaço"));
});

// ---------------- Navegador ----------------

function rotaReta() {
  // 200 m para o leste, depois 100 m para o norte: uma esquina.
  const a = BASE;
  const b = mover(a, 0, 200);
  const c = mover(b, 100, 0);
  return {
    destino: { nome: "Padaria do Zé", ...c },
    distanciaM: 300, duracaoS: 240,
    passos: [
      { instrucao: "Siga pela Rua A", via: "Rua A", distanciaM: 200, inicio: a, fim: b, polilinha: [a, b] },
      { instrucao: "Vire à esquerda na Rua B", via: "Rua B", distanciaM: 100, inicio: b, fim: c, polilinha: [b, c] },
    ],
  };
}

test("o início anuncia destino, distância e o primeiro trecho", () => {
  const n = new Navegador();
  const ev = n.iniciar(rotaReta());
  assert.match(ev.texto, /Padaria do Zé/);
  assert.match(ev.texto, /300 metros/);
  assert.match(ev.texto, /Rua A/);
});

test("prepara a manobra a 25 m e manda executar a 8 m", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  const esquina = r.passos[0].fim;

  const longe = n.atualizar({ ...mover(esquina, 0, -60), precisaoM: 5, velocidadeMs: 1.2 }, 90, 0);
  assert.equal(longe.length, 0, "a 60 m ainda não se fala da manobra");

  const prep = n.atualizar({ ...mover(esquina, 0, -20), precisaoM: 5, velocidadeMs: 1.2 }, 90, 1000);
  assert.equal(prep[0].tipo, "manobra-preparar");
  assert.match(prep[0].texto, /vire à esquerda/i);
  assert.equal(prep[0].urgente, false);

  const exec = n.atualizar({ ...mover(esquina, 0, -5), precisaoM: 5, velocidadeMs: 1.2 }, 90, 2000);
  assert.equal(exec[0].tipo, "manobra");
  assert.equal(exec[0].urgente, true, "a manobra em cima da hora interrompe tudo");
  assert.match(exec[0].texto, /Agora/);
});

test("sem bússola e parado, o app não inventa esquerda nem direita", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  const esquina = r.passos[0].fim;
  // rumoDispositivo null e velocidade zero: não há como saber para onde a
  // pessoa aponta. Mandar "vire à esquerda" aqui é jogá-la na via.
  const prep = n.atualizar({ ...mover(esquina, 0, -20), precisaoM: 5, velocidadeMs: 0 }, null, 1000);
  assert.ok(!/esquerda|direita/.test(prep[0].texto), `não pode dar lado: ${prep[0].texto}`);
  assert.match(prep[0].texto, /norte|sul|leste|oeste/);
});

test("travessia manda parar e nunca autoriza", () => {
  const n = new Navegador();
  const r = rotaReta();
  r.passos[1].instrucao = "Atravesse a Rua B";
  n.iniciar(r);
  const esquina = r.passos[0].fim;
  const exec = n.atualizar({ ...mover(esquina, 0, -4), precisaoM: 5, velocidadeMs: 1.2 }, 90, 1000);
  const t = exec.find((e) => e.tipo === "travessia");
  assert.ok(t, "devia anunciar travessia");
  assert.match(t.texto, /Pare/);
  assert.ok(!/pode atravessar|siga em frente/i.test(t.texto), "o app nunca autoriza a travessia");
});

test("um pulo de GPS não recalcula a rota; três seguidos sim", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  const fora = { ...mover(r.passos[0].inicio, 60, 100), precisaoM: 5, velocidadeMs: 1.2 };

  assert.equal(n.atualizar(fora, 90, 0).length, 0, "um fix fora é o GPS pulando entre prédios");
  assert.equal(n.atualizar(fora, 90, 1000).length, 0);
  const terceiro = n.atualizar(fora, 90, 2000);
  assert.equal(terceiro[0].recalcular, true);
  assert.match(terceiro[0].texto, /saiu do caminho/i);
});

test("GPS ruim avisa uma vez e não repete", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  const p = { ...r.passos[0].inicio, precisaoM: 45, velocidadeMs: 1.2 };
  const um = n.atualizar(p, 90, 0);
  assert.ok(um.some((e) => e.tipo === "precisao"));
  const dois = n.atualizar(p, 90, 1000);
  assert.ok(!dois.some((e) => e.tipo === "precisao"), "avisar GPS fraco a cada fix é tortura");
});

test("chegada diz de que lado está o destino", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  // chegando de frente, com o destino à direita de quem olha para o norte
  const perto = { ...mover(r.destino, 0, -8), precisaoM: 5, velocidadeMs: 1.0 };
  const ev = n.atualizar(perto, 0, 0);   // apontando para o norte
  assert.equal(ev[0].tipo, "chegada");
  assert.match(ev[0].texto, /Padaria do Zé/);
  assert.match(ev[0].texto, /à sua direita/);
  assert.equal(n.ativo, false);
});

test("referência da câmera só conta do lado certo", () => {
  const objs = [
    { detection: { label: "traffic light" }, direction: Direction.DIREITA, distanceM: 6 },
    { detection: { label: "bench" }, direction: Direction.ESQUERDA, distanceM: 3 },
  ];
  assert.equal(referenciaNoLado(objs, Direction.DIREITA, NOMES), "semáforo");
  assert.equal(referenciaNoLado(objs, Direction.FRENTE, NOMES), null);
});

// ---------------- Regressões achadas pelo simulador de rota ----------------

test("regressão: 180 m não pode ser falado como 200 m", () => {
  // Arredondar para a cinquentena tira 26 passos de quem conta passos.
  assert.equal(distanciaFalada(180), "180 metros");
  assert.equal(distanciaFalada(323), "320 metros");
  assert.equal(distanciaFalada(640), "650 metros");
});

test("regressão: travessia é anunciada uma vez, não de novo na calçada oposta", () => {
  const n = new Navegador();
  const a = BASE, b = mover(a, 0, 90), c = mover(b, 0, 14), d = mover(c, 0, 120);
  const seg = (x, y, instr, via) => ({
    instrucao: instr, via, distanciaM: distanciaM(x, y), inicio: x, fim: y, polilinha: [x, y],
  });
  n.iniciar({
    destino: { nome: "Ponto", ...d }, distanciaM: 224, duracaoS: 190,
    passos: [
      seg(a, b, "Siga pela Rua A", "Rua A"),
      seg(b, c, "Atravesse a Rua B", "Rua B"),
      seg(c, d, "Siga pela Rua A", "Rua A"),
    ],
  });

  const andar = (ponto, t) => n.atualizar(
    { ...ponto, precisaoM: 5, velocidadeMs: 1.2 }, 90, t);

  const todas = [];
  for (let m = 60, t = 0; m < 220; m += 6, t += 5000) {
    const p = m < 90 ? mover(a, 0, m) : m < 104 ? mover(b, 0, m - 90) : mover(c, 0, m - 104);
    todas.push(...andar(p, t));
  }
  const paradas = todas.filter((e) => e.tipo === "travessia");
  assert.equal(paradas.length, 1, `mandou parar ${paradas.length} vezes: a segunda pega a pessoa no meio da rua`);
});

test("regressão: fora de rota recua em vez de repetir para sempre", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  const fora = { ...mover(r.passos[0].inicio, 80, 120), precisaoM: 5, velocidadeMs: 1.2 };

  const falados = [];
  for (let t = 0; t <= 120000; t += 1000) {
    for (const e of n.atualizar(fora, 90, t)) if (e.texto) falados.push({ t, texto: e.texto });
  }
  assert.ok(falados.length <= 3,
    `falou ${falados.length} vezes em dois minutos fora da rota; repetir isso é confirmar que a pessoa está perdida`);
  assert.match(falados[0].texto, /saiu do caminho/i);
  assert.ok(falados.length < 2 || falados[1].t - falados[0].t >= 15000, "o segundo aviso precisa de folga");
});

test("regressão: trecho novo sem virada não rende duas frases", () => {
  const n = new Navegador();
  const a = BASE, b = mover(a, 0, 100), c = mover(b, 0, 100);
  const seg = (x, y, via) => ({
    instrucao: `Siga pela ${via}`, via, distanciaM: distanciaM(x, y), inicio: x, fim: y, polilinha: [x, y],
  });
  n.iniciar({
    destino: { nome: "Fim", ...c }, distanciaM: 200, duracaoS: 170,
    passos: [seg(a, b, "Rua A"), seg(b, c, "Rua A")],
  });
  const perto = { ...mover(b, 0, -5), precisaoM: 5, velocidadeMs: 1.2 };
  const evs = n.atualizar(perto, 90, 1000);
  assert.ok(!evs.some((e) => e.tipo === "manobra"),
    "seguir reto não é manobra: o anúncio do trecho novo já diz tudo");
});

// ---------------- Orientação (0.10) ----------------

test("alinhamento: parado e virado para o lado errado, o app guia o giro e confirma", () => {
  const n = new Navegador();
  const r = rotaReta();            // primeiro trecho vai para o leste (90°)
  n.iniciar(r);
  const p = { ...r.passos[0].inicio, precisaoM: 5, velocidadeMs: 0 };
  const um = n.atualizar(p, 0, 0);           // virado para o norte
  assert.equal(um[0].tipo, "alinhar");
  assert.match(um[0].texto, /vire à direita/);
  assert.equal(n.atualizar(p, 40, 1000).length, 0, "girando: não repete a cada leitura");
  const ok = n.atualizar(p, 85, 2000);
  assert.equal(ok[0].tipo, "alinhado");
  assert.match(ok[0].texto, /^Isso/);
});

test("alinhamento: de costas pede meia-volta; lembrete muda a frase e é raro", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  const p = { ...r.passos[0].inicio, precisaoM: 5, velocidadeMs: 0 };
  assert.match(n.atualizar(p, 270, 0)[0].texto, /meia-volta/);
  const textos = [];
  for (let t = 1000; t <= 60000; t += 1000) for (const e of n.atualizar(p, 200, t)) textos.push(e.texto);
  assert.ok(textos.length <= 2, `lembrou ${textos.length} vezes`);
  assert.equal(new Set(textos).size, textos.length, "lembretes não podem ser iguais");
});

test("alinhamento: já alinhado ou andando, não fala nada", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  assert.equal(n.atualizar({ ...r.passos[0].inicio, precisaoM: 5, velocidadeMs: 0 }, 95, 0).length, 0);
});

test("confirmação de caminho: trecho longo não fica mudo, e as frases variam", () => {
  const n = new Navegador();
  const a = BASE, b = mover(a, 0, 400);
  n.iniciar({
    destino: { nome: "Praça", ...b }, distanciaM: 400, duracaoS: 330,
    passos: [{ instrucao: "Siga pela Rua A", via: "Rua A", distanciaM: 400, inicio: a, fim: b, polilinha: [a, b] }],
  });
  const falas = [];
  for (let m = 0, t = 0; m < 360; m += 1.2, t += 1000) {
    for (const e of n.atualizar({ ...mover(a, 0, m), precisaoM: 5, velocidadeMs: 1.2 }, 90, t)) falas.push(e);
  }
  const conf = falas.filter((e) => e.tipo === "confirmar");
  assert.ok(conf.length >= 2, "400 m sem nenhuma confirmação deixa a pessoa em dúvida");
  assert.ok(conf.length <= 6, `confirmou ${conf.length} vezes: virou ruído`);
  assert.equal(new Set(conf.map((c) => c.texto)).size, conf.length, "confirmações repetidas");
  for (const c of conf) assert.match(c.texto, /metros/, "toda confirmação traz o que falta");
});

test("fora de rota diz para que lado a rota fica", () => {
  const n = new Navegador();
  const r = rotaReta();
  n.iniciar(r);
  // 60 m ao norte da Rua A (que corre para o leste), pessoa virada para o leste
  const fora = { ...mover(r.passos[0].inicio, 60, 100), precisaoM: 5, velocidadeMs: 1.2 };
  n.atualizar(fora, 90, 0); n.atualizar(fora, 90, 1000);
  const ev = n.atualizar(fora, 90, 2000);
  assert.match(ev[0].texto, /A rota fica à sua direita, a uns 60 metros/);
});
