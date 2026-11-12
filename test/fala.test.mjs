import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Canal, FilaDeFala, Fraseador, agregar, lista, EstadoDaCena,
  Habituacao, frasePaisagem,
} from "../fala.js";
import { numero, Direction, Proximity } from "../core.js";

const obj = (label, direction = Direction.FRENTE, proximity = Proximity.PERTO, approaching = false) => ({
  detection: { label, score: 0.9, box: { left: .4, top: .2, right: .6, bottom: .9 } },
  direction, proximity, approaching, inPath: true,
});

// ---------------- Fila de fala ----------------

test("alerta atropela narração em curso; narração espera", () => {
  const f = new FilaDeFala();
  f.oferecer({ texto: "Banco à esquerda.", canal: Canal.NARRACAO }, 0);
  f.oferecer({ texto: "Atenção, carro à frente.", canal: Canal.ALERTA }, 0);

  const saida = f.proxima(0, true);   // voz ocupada
  assert.equal(saida.canal, Canal.ALERTA);
  assert.equal(saida.interromper, true, "alerta corta a fala em curso");

  // a narração continua pendente, mas não sai enquanto a voz estiver ocupada
  assert.equal(f.proxima(10, true), null);
});

test("navegação vence narração e perde para alerta", () => {
  const f = new FilaDeFala();
  f.oferecer({ texto: "Poste à direita.", canal: Canal.NARRACAO }, 0);
  f.oferecer({ texto: "Em 25 metros, vire à direita.", canal: Canal.NAVEGACAO }, 0);
  assert.equal(f.proxima(0, false).canal, Canal.NAVEGACAO);
});

test("fala vencida é engolida, não dita com atraso", () => {
  const f = new FilaDeFala();
  f.oferecer({ texto: "Agora, vire à direita.", canal: Canal.NAVEGACAO }, 0);
  // três segundos depois a manobra já passou: dizer agora manda a pessoa errado
  assert.equal(f.proxima(3000, false), null);
});

test("mesma frase não sai duas vezes seguidas", () => {
  const f = new FilaDeFala();
  f.oferecer({ texto: "Pessoa à frente.", canal: Canal.NARRACAO }, 0);
  assert.ok(f.proxima(0, false));
  assert.equal(f.oferecer({ texto: "Pessoa à frente.", canal: Canal.NARRACAO }, 1000), false);
});

test("um canal guarda só a fala mais nova", () => {
  const f = new FilaDeFala();
  f.oferecer({ texto: "Em 25 metros, vire à direita.", canal: Canal.NAVEGACAO }, 0);
  f.oferecer({ texto: "Em 10 metros, vire à direita.", canal: Canal.NAVEGACAO }, 500);
  assert.equal(f.proxima(500, false).texto, "Em 10 metros, vire à direita.");
});

test("intervalo mínimo por canal evita metralhadora", () => {
  const f = new FilaDeFala();
  f.oferecer({ texto: "Pessoa à frente.", canal: Canal.NARRACAO }, 0);
  assert.ok(f.proxima(0, false));
  f.oferecer({ texto: "Carro à direita.", canal: Canal.NARRACAO }, 300);
  assert.equal(f.proxima(300, false), null, "300 ms é cedo demais para a narração");
  f.oferecer({ texto: "Carro à direita.", canal: Canal.NARRACAO }, 2500);
  assert.ok(f.proxima(2500, false));
});

// ---------------- Fraseador ----------------

test("primeira menção é canônica; a repetição muda de forma", () => {
  const fr = new Fraseador();
  const a = fr.objeto("person|frente", "pessoa", "à frente", "a três metros");
  assert.equal(a, "Pessoa à frente, a três metros.", "a primeira vez é sempre igual");

  const b = fr.objeto("person|frente", "pessoa", "à frente", "a dois metros");
  assert.notEqual(a, b);
  assert.ok(/ainda|segue|Continua/.test(b), `repetição deve soar diferente: ${b}`);
});

test("variante nunca repete duas vezes seguidas", () => {
  const fr = new Fraseador();
  const vistas = new Set();
  for (let i = 0; i < 4; i++) vistas.add(fr.escolher("m", ["a", "b", "c"]));
  assert.ok(vistas.size >= 3, "o rodízio deve percorrer as variantes");
});

test("objeto esquecido volta a ser novidade", () => {
  const fr = new Fraseador();
  fr.objeto("dog|dir", "cachorro", "à direita", null);
  fr.esquecer("dog|dir");
  assert.equal(fr.objeto("dog|dir", "cachorro", "à direita", null), "Cachorro à direita.");
});

// ---------------- Agregação ----------------

test("agrega vários objetos numa frase só, em ordem de risco", () => {
  const frase = agregar([
    { nome: "banco", plural: "bancos", quantidade: 1, direcao: "à esquerda", feminino: false },
    { nome: "pessoa", plural: "pessoas", quantidade: 2, direcao: "à frente", feminino: true },
    { nome: "carro", plural: "carros", quantidade: 1, direcao: "à frente", feminino: false },
  ], { numero });
  assert.equal(frase, "À frente, duas pessoas e um carro; à esquerda, um banco.");
});

test("lista com e antes do último", () => {
  assert.equal(lista(["um"]), "um");
  assert.equal(lista(["um", "dois"]), "um e dois");
  assert.equal(lista(["um", "dois", "três"]), "um, dois e três");
});

// ---------------- Estabilidade ----------------

test("cena parada vira silêncio; mudança reabre a fala", () => {
  const e = new EstadoDaCena({ toleranciaMs: 1500 });
  const cena = [obj("person"), obj("car", Direction.DIREITA)];

  assert.equal(e.atualizar(cena, 0).mudou, true, "primeira vez sempre muda");
  assert.equal(e.atualizar(cena, 1000).mudou, false);
  assert.equal(e.estavel(1000), false);
  assert.equal(e.estavel(2000), true, "parada há 2 s: pode calar");

  const outra = [obj("person"), obj("car", Direction.DIREITA, Proximity.PERTO, true)];
  assert.equal(e.atualizar(outra, 2100).mudou, true, "o carro passou a vir: isso é notícia");
});

test("oscilação de distância não quebra a estabilidade", () => {
  const e = new EstadoDaCena();
  // mesma classe, mesma direção, mesma faixa de proximidade: a assinatura
  // ignora o metro exato de propósito, senão nada seria estável
  const a = { ...obj("person"), distanceM: 3.1 };
  const b = { ...obj("person"), distanceM: 2.7 };
  e.atualizar([a], 0);
  assert.equal(e.atualizar([b], 500).mudou, false);
});

// ============================================================
// Habituação
// ============================================================
// O que se repete sem consequência vira paisagem. Estes testes guardam a
// fronteira entre "parar de recitar o cenário" e "deixar de avisar do perigo",
// que é onde um módulo como este fica perigoso se for longe demais.

test("habituação: a primeira vez passa, e o silêncio exigido dobra", () => {
  const h = new Habituacao({ intervaloBaseMs: 10000, mudoApos: 99 });
  assert.equal(h.avaliar("poste|esq|0", 0).permite, true);
  h.registrar("poste|esq|0", 0);

  // depois da 1a vez: 10 s
  assert.equal(h.avaliar("poste|esq|0", 9000).permite, false);
  assert.equal(h.avaliar("poste|esq|0", 10000).permite, true);
  h.registrar("poste|esq|0", 10000);

  // depois da 2a: 20 s
  assert.equal(h.avaliar("poste|esq|0", 25000).permite, false);
  assert.equal(h.avaliar("poste|esq|0", 30000).permite, true);
  h.registrar("poste|esq|0", 30000);

  // depois da 3a: 40 s
  assert.equal(h.avaliar("poste|esq|0", 60000).permite, false);
  assert.equal(h.avaliar("poste|esq|0", 70000).permite, true);
});

test("PERIGO NUNCA VIRA PAISAGEM: urgente passa sempre", () => {
  // A regra que impede este módulo de matar alguém. Um carro vindo na sua
  // direção pela quinta vez na mesma quadra é a quinta vez que você precisa
  // saber — por mais repetitiva que a frase seja.
  const h = new Habituacao({ intervaloBaseMs: 10000, mudoApos: 2 });
  for (let i = 0; i < 10; i++) {
    const r = h.avaliar("carro|frente|0", i * 500, { urgente: true });
    assert.equal(r.permite, true, `a ${i + 1}a vez foi calada`);
    h.registrar("carro|frente|0", i * 500, { urgente: true });
  }
});

test("família emudecida rende UMA frase de paisagem, e só uma", () => {
  const h = new Habituacao({ intervaloBaseMs: 1000, mudoApos: 2 });
  h.registrar("parking meter|à esquerda|1", 0);
  h.registrar("parking meter|à esquerda|1", 5000);

  const a = h.avaliar("parking meter|à esquerda|1", 60000);
  assert.equal(a.permite, false);
  assert.equal(a.paisagem, true, "a deixa para dizer o padrão");
  h.marcarPaisagem("parking meter|à esquerda|1", 60000);

  const b = h.avaliar("parking meter|à esquerda|1", 70000);
  assert.equal(b.permite, false);
  assert.equal(b.paisagem, false, "o padrão não se repete");
});

test("mudar de família zera a habituação", () => {
  // Carro à direita vira carro à FRENTE: é outra notícia, e tem de sair na
  // hora, por mais que a primeira estivesse emudecida.
  const h = new Habituacao({ intervaloBaseMs: 10000, mudoApos: 2 });
  h.registrar("car|à direita|1", 0);
  h.registrar("car|à direita|1", 1000);
  assert.equal(h.avaliar("car|à direita|1", 2000).permite, false);
  assert.equal(h.avaliar("car|à frente|1", 2000).permite, true);
});

test("sumiu por muito tempo: a família é esquecida", () => {
  const h = new Habituacao({ intervaloBaseMs: 10000, mudoApos: 2, esquecerApos: 60000 });
  h.registrar("banco|esq|1", 0);
  h.registrar("banco|esq|1", 1000);
  assert.equal(h.avaliar("banco|esq|1", 30000).permite, false);
  assert.equal(h.avaliar("banco|esq|1", 90000).permite, true, "outra quadra, outra história");
});

test("frase de paisagem diz o padrão, não o caso", () => {
  assert.equal(frasePaisagem("parquímetros", "à esquerda"), "Há parquímetros ao longo da sua esquerda.");
  assert.equal(frasePaisagem("carros", "à direita"), "Há carros ao longo da sua direita.");
  assert.equal(frasePaisagem(null, "à direita"), null);
});

test("a fila aplica a habituação e substitui pela paisagem", () => {
  const fila = new FilaDeFala({ habituacao: new Habituacao({ intervaloBaseMs: 1000, mudoApos: 2 }) });
  const oferta = (t) => {
    fila.oferecer({
      texto: `Parquímetro à esquerda, a dois metros e meio.`, canal: Canal.NARRACAO,
      familia: "parking meter|à esquerda|0", plural: "parquímetros", direcao: "à esquerda",
    }, t);
    return fila.proxima(t, false);
  };
  assert.ok(oferta(0));
  assert.ok(oferta(20000));
  const terceira = oferta(60000);
  assert.ok(terceira);
  assert.equal(terceira.texto, "Há parquímetros ao longo da sua esquerda.");
  assert.equal(oferta(120000), null, "depois do padrão, silêncio");
});
