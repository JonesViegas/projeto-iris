// Ameaças: tempo até o impacto, queda, pessoa, possível arma — e não repetir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AvaliadorDeAmeacas, Nivel, Tipo, ROTULO_ARMA, mensagemDeSocorro, linkSms } from "../ameacas.js";

const caixa = (cx = 0.5, h = 0.5) => ({ left: cx - 0.1, right: cx + 0.1, top: 0.5 - h / 2, bottom: 0.5 + h / 2 });
const o = (label, distanceM, { direction = "à frente", closingMs = 0, inPath = true, box = caixa(), varredura } = {}) =>
  ({ detection: { label, box, ...(varredura != null ? { varredura } : {}) }, distanceM, direction, closingMs, inPath });

/** Roda quadros a 10 qps com o objeto se aproximando a `v` m/s; devolve o que foi dito. */
function aproximar(a, label, d0, v, { direction = "à frente", ctx = { velocidadeMs: 0 }, ate = 0.5, extra = [], t0 = 0, durMs = 3000 } = {}) {
  const ditas = [];
  for (let t = 0; t <= durMs; t += 100) {
    const d = Math.max(ate, d0 - (v * t) / 1000);
    ditas.push(...a.avaliar([o(label, d, { direction }), ...extra], ctx, t0 + t).filter((x) => x.texto));
  }
  return ditas;
}

test("moto vindo rápido pela direita: tempo curto até o impacto manda parar", () => {
  const a = new AvaliadorDeAmeacas();
  const ditas = aproximar(a, "motorcycle", 22, 7, { direction: "à direita" });
  assert.equal(ditas[0].tipo, Tipo.COLISAO);
  const pare = ditas.find((x) => x.nivel === Nivel.CRITICA);
  assert.ok(pare, "a moto chega a menos de 2,5 s: tem de mandar parar");
  assert.equal(pare.texto, "Pare. Moto pela direita.");
  assert.notEqual(ditas[0].chave, pare.chave, "a chave muda ao piorar, para a fila não engolir o Pare");
});

test("carro parado à frente, pessoa andando até ele: não é colisão com veículo", () => {
  const a = new AvaliadorDeAmeacas();
  const r = aproximar(a, "car", 6, 1.2, { ctx: { velocidadeMs: 1.2 }, ate: 2 });
  assert.equal(r.filter((x) => x.tipo === Tipo.COLISAO).length, 0, "o carro só parece vir porque a pessoa anda");
});

test("ônibus a média distância vindo: cuidado, com saída para o lado oposto", () => {
  const a = new AvaliadorDeAmeacas();
  const [m] = aproximar(a, "bus", 24, 4, { direction: "à esquerda", durMs: 1500 });
  assert.equal(m.nivel, Nivel.ALTA);
  assert.match(m.texto, /Afaste-se para a direita/);
});

test("degrau perto e a pessoa andando: pare; parada: atenção", () => {
  const a = new AvaliadorDeAmeacas();
  assert.match(a.avaliar([o("aberto:degrau", 1.2)], { velocidadeMs: 1.1 }, 0)[0].texto, /^Pare\. Degrau logo à frente/);
  const b = new AvaliadorDeAmeacas();
  const [x] = b.avaliar([o("aberto:buraco", 3)], { velocidadeMs: 0 }, 0);
  assert.equal(x.nivel, Nivel.ALTA);
  assert.match(x.texto, /bengala/);
});

test("pessoa vindo correndo é ameaça; duas pessoas andando uma para a outra, não", () => {
  const a = new AvaliadorDeAmeacas();
  const [p] = aproximar(a, "person", 9, 4.5, { durMs: 1500 });
  assert.equal(p.tipo, Tipo.PESSOA);
  assert.match(p.texto, /alguém vindo depressa de frente/);
  assert.doesNotMatch(p.texto, /assalt|ladr|suspeit/i, "descreve comportamento, nunca intenção");

  const b = new AvaliadorDeAmeacas();
  assert.equal(aproximar(b, "person", 9, 2.6, { ctx: { velocidadeMs: 1.2 }, ate: 3 }).length, 0);
  // sem GPS: desconta uma caminhada, para não alarmar à toa
  const c = new AvaliadorDeAmeacas();
  assert.equal(aproximar(c, "person", 9, 2.6, { ctx: {}, ate: 3 }).length, 0);
});

test("pessoa parada com a caixa tremendo não vira 'vindo depressa'", () => {
  const a = new AvaliadorDeAmeacas();
  const ditas = [];
  for (let t = 0; t <= 6000; t += 83) {
    const d = 1.6 + (t % 166 === 0 ? 0.5 : 0);   // pula entre 1,6 e 2,1 m a cada quadro
    ditas.push(...a.avaliar([o("person", d)], { velocidadeMs: 0 }, t).filter((x) => x.tipo === Tipo.PESSOA && /depressa/.test(x.texto ?? "")));
  }
  assert.equal(ditas.length, 0);
});

test("pessoa colada por muitos segundos: avisa uma vez, oferece socorro", () => {
  const a = new AvaliadorDeAmeacas();
  const ditas = [];
  for (let t = 0; t <= 20000; t += 500) ditas.push(...a.avaliar([o("person", 1.0)], { velocidadeMs: 0 }, t));
  assert.equal(ditas.length, 1, `avisou ${ditas.length} vezes`);
  assert.ok(ditas[0].oferecerSocorro);
  assert.match(ditas[0].texto, /muito perto de você/);
});

test("alguém acompanhando por mais de um minuto, só enquanto a pessoa anda", () => {
  const a = new AvaliadorDeAmeacas();
  let ditas = [];
  for (let t = 0; t <= 70000; t += 1000) ditas.push(...a.avaliar([o("person", 3, { direction: "à esquerda" })], { velocidadeMs: 1.2 }, t));
  assert.equal(ditas.length, 1);
  assert.match(ditas[0].texto, /andando junto com você, à esquerda/);

  const b = new AvaliadorDeAmeacas();
  ditas = [];
  for (let t = 0; t <= 70000; t += 1000) ditas.push(...b.avaliar([o("person", 3)], { velocidadeMs: 0 }, t));
  assert.equal(ditas.length, 0, "parada numa fila, gente perto não é acompanhamento");
});

test("possível arma: uma varredura só não fala, pede confirmação", () => {
  const a = new AvaliadorDeAmeacas();
  const pessoa = o("person", 4, { box: { left: 0.3, right: 0.7, top: 0.1, bottom: 0.95 } });
  const arma = o(ROTULO_ARMA, null, { box: { left: 0.55, right: 0.65, top: 0.45, bottom: 0.55 }, varredura: 1 });
  const r1 = a.avaliar([pessoa, arma], { velocidadeMs: 0 }, 0);
  assert.equal(r1.filter((x) => x.texto).length, 0, "uma observação não basta para falar de arma");
  assert.ok(r1.some((x) => x.pedirConfirmacao));
  // mesma varredura repetida em vários quadros não conta como confirmação
  assert.equal(a.avaliar([pessoa, arma], { velocidadeMs: 0 }, 500).filter((x) => x.texto).length, 0);
  // segunda varredura independente confirma
  const arma2 = { ...arma, detection: { ...arma.detection, varredura: 2 } };
  const [c] = a.avaliar([pessoa, arma2], { velocidadeMs: 0 }, 3000);
  assert.equal(c.tipo, Tipo.ARMA);
  assert.equal(c.nivel, Nivel.CRITICA);
  assert.match(c.texto, /^Atenção\. Possível arma de fogo com uma pessoa à frente, a quatro metros/);
  assert.match(c.texto, /sem correr/);
  assert.ok(c.oferecerSocorro);
});

test("possível arma: confirmação velha expira", () => {
  const a = new AvaliadorDeAmeacas();
  const arma = (v) => o(ROTULO_ARMA, 3, { varredura: v });
  a.avaliar([arma(1)], {}, 0);
  assert.equal(a.avaliar([arma(2)], {}, 60000).filter((x) => x.texto).length, 0);
});

test("não repete a mesma ameaça; repete se piorar", () => {
  const a = new AvaliadorDeAmeacas();
  const ditas = aproximar(a, "bus", 22, 3.5, { direction: "à esquerda", ate: 3, durMs: 6000 });
  const altas = ditas.filter((x) => x.nivel === Nivel.ALTA);
  assert.equal(altas.length, 1, `repetiu o mesmo aviso: ${ditas.map((x) => x.texto).join(" | ")}`);
  assert.ok(ditas.some((x) => x.nivel === Nivel.CRITICA), "piorou: fala de novo");
});

test("uma frase por vez: a mais grave primeiro", () => {
  const a = new AvaliadorDeAmeacas();
  const ditas = aproximar(a, "car", 12, 5, { direction: "à direita", extra: [o("aberto:buraco", 3)], durMs: 1500 });
  // quadros iniciais: só o buraco (o carro ainda não tem velocidade medida)
  assert.equal(ditas[0].tipo, Tipo.QUEDA);
  assert.ok(ditas.some((x) => x.tipo === Tipo.COLISAO), "o carro sai assim que a velocidade é medida");
  for (let i = 0; i < ditas.length; i++) assert.ok(ditas.filter((x) => x.chave === ditas[i].chave).length === 1);
});

test("mensagem de socorro: localização em link de mapa e hora", () => {
  const m = mensagemDeSocorro({ lat: -15.6, lng: -56.1, precisaoM: 8, endereco: "Rua A", quando: new Date(2026, 10, 8, 14, 5) });
  assert.match(m, /https:\/\/maps\.google\.com\/\?q=-15\.600000,-56\.100000/);
  assert.match(m, /14:05/);
  assert.match(m, /Rua A/);
  assert.equal(linkSms("(65) 99999-0000", "oi"), "sms:65999990000?body=oi");
  assert.equal(linkSms("+5565", "a b", { ios: true }), "sms:+5565&body=a%20b");
});
