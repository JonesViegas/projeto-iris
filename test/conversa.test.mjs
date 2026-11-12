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

// ---------------------------------------------------------------
// Encerrar a conversa pela voz (0.13)
// ---------------------------------------------------------------
// O modo conversa deixa o microfone reabrindo sozinho. Sem uma saída falada,
// a única forma de sair seria achar o botão — que é exatamente o que quem não
// enxerga tem mais dificuldade de fazer, e foi o que travou no teste de campo.

test("despedidas e pedidos de parar encerram a conversa", () => {
  for (const t of [
    "pode parar", "chega", "já deu", "tchau", "até logo", "obrigado",
    "obrigada", "valeu", "encerrar", "encerra a conversa", "sair da conversa",
    "é só isso", "nada mais", "fica quieto",
  ]) {
    assert.equal(acao(t), Acao.ENCERRAR, `"${t}" deveria encerrar`);
  }
});

test("encerrar não rouba frases que são pergunta de verdade", () => {
  // "obrigado" no meio de uma frase é educação, não despedida.
  assert.equal(acao("obrigado, e o que tem à direita?"), Acao.PERGUNTA);
  assert.equal(acao("chega de carro perto de mim?"), Acao.PERGUNTA);
  // "parar rota" continua sendo parar a rota, não encerrar a conversa.
  assert.equal(acao("parar rota"), Acao.PARAR_ROTA);
  assert.equal(acao("cancela a navegação"), Acao.PARAR_ROTA);
  // Socorro vence tudo, inclusive uma despedida mal reconhecida.
  assert.equal(acao("socorro"), Acao.SOCORRO);
});

test("encerrar não atropela o pedido de ir a algum lugar", () => {
  const c = interpretarComando("me leva até a padaria");
  assert.equal(c.acao, Acao.IR);
  assert.equal(c.destino, "padaria");
});

// ------------------------------------------------------------
// Barreira de calçada pela voz
// ------------------------------------------------------------
// Uma pessoa cega parada numa calçada quebrada não vai procurar um botão na
// tela para relatar o que acabou de acontecer com ela. Ou o relato cabe numa
// frase dita de pé, no meio da rua, ou ele não existe — e sem relato de
// dificuldade a detecção não vira denúncia.

test("a frase natural carrega a dificuldade, sem a pessoa ter de escolher opção", () => {
  const casos = {
    "eu caí": "cai",
    "tropecei na calçada": "tropecei",
    "tive que descer para a rua": "fui_para_rua",
    "não consegui passar": "nao_passei",
    "pedi ajuda": "pedi_ajuda",
    "tive que desviar": "desviei",
  };
  for (const [frase, esperada] of Object.entries(casos)) {
    const c = interpretarComando(frase);
    assert.equal(c.acao, Acao.ANOTAR_BARREIRA, `"${frase}" não virou registro de barreira`);
    assert.equal(c.dificuldade, esperada, `"${frase}" com dificuldade errada`);
  }
});

test("dá para registrar sem dizer o que aconteceu", () => {
  for (const f of ["anota essa barreira", "registra essa calçada", "a calçada está horrível"]) {
    const c = interpretarComando(f);
    assert.equal(c.acao, Acao.ANOTAR_BARREIRA, `"${f}"`);
    assert.equal(c.dificuldade, null, "sem relato, a dificuldade fica em aberto");
  }
});

test("SOCORRO continua vencendo o registro de barreira", () => {
  // A ordem das regras é uma decisão de segurança: "me ajuda" é emergência,
  // não relato de calçada. Trocar a ordem aqui mata gente.
  assert.equal(acao("socorro"), Acao.SOCORRO);
  assert.equal(acao("me ajuda"), Acao.SOCORRO);
  assert.equal(acao("preciso de ajuda"), Acao.SOCORRO);
});

test("registrar barreira não engole os comandos de sempre", () => {
  assert.equal(acao("onde estou"), Acao.ONDE_ESTOU);
  assert.equal(acao("o que tem aqui"), Acao.DESCREVER);
  assert.equal(acao("leia isso"), Acao.LER);
  assert.equal(acao("pode parar"), Acao.ENCERRAR);
});
