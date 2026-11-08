// Conversa por voz: o que é comando (resolve no aparelho) e o que é pergunta (IA).
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarComando, Acao, Conversa, normalizarFala } from "../conversa.js";

const acao = (t) => interpretarComando(t)?.acao;

test("comandos do dia a dia são reconhecidos sem internet", () => {
  assert.equal(acao("Onde eu estou?"), Acao.ONDE_ESTOU);
  assert.equal(acao("onde é que eu tô"), Acao.ONDE_ESTOU);
  assert.equal(acao("Em que rua eu estou?"), Acao.ONDE_ESTOU);
  assert.equal(acao("O que tem na minha frente?"), Acao.DESCREVER);
  assert.equal(acao("descreve"), Acao.DESCREVER);
  assert.equal(acao("Lê isso pra mim"), Acao.LER);
  assert.equal(acao("o que está escrito aqui"), Acao.LER);
  assert.equal(acao("parar rota"), Acao.PARAR_ROTA);
  assert.equal(acao("Repete"), Acao.REPETIR);
  assert.equal(acao("quais são os comandos"), Acao.AJUDA);
});

test("socorro vence qualquer outra leitura", () => {
  assert.equal(acao("Socorro!"), Acao.SOCORRO);
  assert.equal(acao("me ajuda"), Acao.SOCORRO);
  assert.equal(acao("preciso de ajuda"), Acao.SOCORRO);
});

test("ir para: o destino volta com acento, como foi falado", () => {
  assert.deepEqual(
    { a: acao("Me leva até a farmácia"), d: interpretarComando("Me leva até a farmácia").destino },
    { a: Acao.IR, d: "farmácia" });
  assert.equal(interpretarComando("quero ir para a Rodoviária de Cuiabá").destino, "Rodoviária de Cuiabá");
  assert.equal(interpretarComando("como chego na Praça Alencastro?").destino, "Praça Alencastro");
  assert.equal(interpretarComando("me leva pra casa").destino, "casa");
});

test("o resto é pergunta livre para a IA de visão", () => {
  for (const p of ["Essa nota é de quanto?", "Tem alguma cadeira livre?", "De que cor é essa camisa?",
    "qual o prazo de validade desse remédio", "a porta está aberta?"]) {
    assert.equal(acao(p), Acao.PERGUNTA, p);
  }
});

test("fala vazia não vira nada", () => {
  assert.equal(interpretarComando("  "), null);
  assert.equal(normalizarFala("Ônibus, já!"), "onibus ja");
});

test("histórico: guarda poucos turnos, só texto, e expira", () => {
  const c = new Conversa({ maxTurnos: 2, validadeMs: 1000 });
  c.registrar("p1", "r1", 0);
  c.registrar("p2", "r2", 100);
  c.registrar("p3", "r3", 200);
  assert.deepEqual(c.historico(300).map((t) => t.pergunta), ["p2", "p3"]);
  assert.equal(c.ultimaFala, "r3");
  assert.deepEqual(c.historico(5000), [], "conversa parada há muito tempo recomeça");
});
