// Lugares familiares: aprender com poucos exemplos, reconhecer com cautela.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoriaDeLugares, cosseno, normalizar, chaveDoNome, vetorParaTexto, textoParaVetor,
} from "../lugares.js";

// Vetores sintéticos: cada lugar é uma direção base mais ruído pequeno,
// imitando o que um embedding faz com quadros do mesmo lugar.
function semente(s) { let x = s; return () => (x = (x * 16807) % 2147483647) / 2147483647 - 0.5; }
function base(dim, s) { const r = semente(s); return Float32Array.from({ length: dim }, r); }
function vista(b, ruido, s) { const r = semente(s); return b.map((v) => v + r() * ruido); }

const DIM = 64;
const COZINHA = base(DIM, 11);
const SALA = base(DIM, 97);

test("cosseno de vetor consigo mesmo é 1", () => {
  const v = normalizar(COZINHA);
  assert.ok(Math.abs(cosseno(v, v) - 1) < 1e-6);
});

test("nome normalizado ignora artigo, possessivo e acento", () => {
  assert.equal(chaveDoNome("A minha Cozinha"), "cozinha");
  assert.equal(chaveDoNome("Portão  de casa"), "portao de casa");
});

test("vetor sobrevive à ida e volta em texto", () => {
  const v = Float32Array.from([0.5, -1.25, 3]);
  assert.deepEqual([...textoParaVetor(vetorParaTexto(v))], [0.5, -1.25, 3]);
});

test("aprende com poucas vistas e reconhece uma vista nova", async () => {
  const m = new MemoriaDeLugares();
  await m.ensinar("cozinha", [1, 2, 3].map((i) => vista(COZINHA, 0.3, i)));
  await m.ensinar("sala", [4, 5, 6].map((i) => vista(SALA, 0.3, i)));
  const r = m.reconhecer(vista(COZINHA, 0.3, 42));
  assert.equal(r?.nome, "cozinha");
  assert.equal(m.reconhecer(vista(SALA, 0.3, 43))?.nome, "sala");
});

test("lugar desconhecido não recebe nome", async () => {
  const m = new MemoriaDeLugares();
  await m.ensinar("cozinha", [1, 2, 3].map((i) => vista(COZINHA, 0.3, i)));
  assert.equal(m.reconhecer(base(DIM, 555)), null);
});

test("empate apertado entre dois lugares: prefere calar", async () => {
  const m = new MemoriaDeLugares({ limiar: 0.5, margem: 0.05 });
  await m.ensinar("a", [vista(COZINHA, 0.05, 1)]);
  await m.ensinar("b", [vista(COZINHA, 0.05, 2)]);
  assert.equal(m.reconhecer(vista(COZINHA, 0.05, 3)), null);
});

test("GPS descarta lugar memorizado longe dali", async () => {
  const m = new MemoriaDeLugares();
  await m.ensinar("cozinha", [vista(COZINHA, 0.2, 1)], { lat: -15.60, lng: -56.10, precisaoM: 10 });
  const longe = { lat: -15.70, lng: -56.10, precisaoM: 10 };   // ~11 km
  assert.equal(m.reconhecer(vista(COZINHA, 0.2, 2), longe), null);
  assert.equal(m.reconhecer(vista(COZINHA, 0.2, 2), { lat: -15.6001, lng: -56.10 })?.nome, "cozinha");
});

test("votação entre quadros", async () => {
  const m = new MemoriaDeLugares();
  await m.ensinar("sala", [1, 2, 3].map((i) => vista(SALA, 0.3, i)));
  await m.ensinar("cozinha", [1, 2, 3].map((i) => vista(COZINHA, 0.3, i + 10)));
  const r = m.reconhecerVarios([vista(SALA, 0.3, 7), vista(SALA, 0.3, 8), base(DIM, 999)]);
  assert.equal(r?.nome, "sala");
  assert.equal(r.votos, 2);
});

test("persiste e recarrega pelo armazém", async () => {
  let guardado = null;
  const armazem = { carregar: async () => guardado, salvar: async (o) => { guardado = structuredClone(o); } };
  const a = new MemoriaDeLugares({ armazem });
  await a.ensinar("Portão de casa", [vista(COZINHA, 0.2, 1)], { lat: -15.6, lng: -56.1, precisaoM: 5 });
  const b = new MemoriaDeLugares({ armazem });
  assert.equal(await b.carregar(), 1);
  assert.equal(b.reconhecer(vista(COZINHA, 0.2, 2))?.nome, "Portão de casa");
});

test("vira destino de navegação quando tem GPS", async () => {
  const m = new MemoriaDeLugares();
  await m.ensinar("casa", [vista(SALA, 0.2, 1)], { lat: -15.6, lng: -56.1, precisaoM: 12 });
  const [d] = await m.comoProvedor().buscar("minha casa");
  assert.deepEqual(d, { nome: "casa", lat: -15.6, lng: -56.1 });
  assert.deepEqual(await m.comoProvedor().buscar("trabalho"), []);
});

test("GPS ruim (dentro de casa) não é guardado", async () => {
  const m = new MemoriaDeLugares();
  await m.ensinar("quarto", [vista(SALA, 0.2, 1)], { lat: -15.6, lng: -56.1, precisaoM: 90 });
  assert.deepEqual(await m.comoProvedor().buscar("quarto"), []);
});
