// "Onde estou?": direção relativa, endereço falado, referências e a frase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  direcaoRelativa, posicaoRelativa, enderecoFalado, classificarPonto,
  selecionarReferencias, fraseOndeEstou, consultaOverpass, ondeEstou,
} from "../localizar.js";

const AQUI = { lat: -15.6010, lng: -56.0974, precisaoM: 8 };
// ~11 m por 0.0001 grau de latitude
const norte = (m) => ({ lat: AQUI.lat + m / 111320, lng: AQUI.lng });
const leste = (m) => ({ lat: AQUI.lat, lng: AQUI.lng + m / (111320 * Math.cos(AQUI.lat * Math.PI / 180)) });

test("direção relativa: frente, lados e atrás", () => {
  assert.equal(direcaoRelativa(0), "à sua frente");
  assert.equal(direcaoRelativa(20), "à sua frente");
  assert.equal(direcaoRelativa(45), "à frente, à direita");
  assert.equal(direcaoRelativa(-90), "à sua esquerda");
  assert.equal(direcaoRelativa(130), "atrás, à direita");
  assert.equal(direcaoRelativa(-179), "atrás de você");
});

test("com bússola: ponto a leste, pessoa virada para o norte, fica à direita", () => {
  const r = posicaoRelativa(AQUI, leste(30), 0);
  assert.equal(r.relativa, true);
  assert.equal(r.direcao, "à sua direita");
  assert.ok(Math.abs(r.distanciaM - 30) < 1);
});

test("sem bússola: nunca fala esquerda nem direita", () => {
  const r = posicaoRelativa(AQUI, leste(30), null);
  assert.equal(r.relativa, false);
  assert.equal(r.direcao, "ao leste");
  assert.doesNotMatch(r.direcao, /esquerda|direita/);
});

test("endereço falado arredonda o número e cita o bairro", () => {
  assert.equal(
    enderecoFalado({ road: "Rua Barão de Melgaço", house_number: "2154", suburb: "Centro Norte" }),
    "Rua Barão de Melgaço, perto do número 2150, bairro Centro Norte");
  assert.equal(enderecoFalado({ road: "Avenida Getúlio Vargas" }), "Avenida Getúlio Vargas");
  assert.equal(enderecoFalado({}), null);
});

test("classifica referências úteis e ignora o resto", () => {
  assert.equal(classificarPonto({ highway: "bus_stop" }).tipo, "ponto de ônibus");
  assert.equal(classificarPonto({ highway: "crossing", tactile_paving: "yes" }).pisoTatil, true);
  assert.equal(classificarPonto({ amenity: "pharmacy", name: "Pague Menos" }).nome, "Pague Menos");
  assert.equal(classificarPonto({ natural: "tree" }), null);
});

test("seleção: mobilidade antes de comércio, sem duplicar, dentro do raio", () => {
  const els = [
    { lat: norte(10).lat, lon: AQUI.lng, tags: { shop: "bakery" } },
    { lat: norte(40).lat, lon: AQUI.lng, tags: { highway: "bus_stop" } },
    { lat: norte(20).lat, lon: AQUI.lng, tags: { highway: "crossing" } },
    { lat: norte(25).lat, lon: AQUI.lng, tags: { highway: "crossing" } },
    { lat: norte(500).lat, lon: AQUI.lng, tags: { amenity: "hospital" } },
  ];
  const r = selecionarReferencias(els, AQUI, 0, { raioM: 80 });
  assert.deepEqual(r.map((x) => x.tipo), ["faixa de pedestre", "ponto de ônibus", "padaria"]);
  assert.equal(r[0].direcao, "à sua frente");
});

test("frase: GPS fraco é dito; sem rumo avisa", () => {
  const t = fraseOndeEstou({ endereco: "Rua A", precisaoM: 70, rumoPessoa: null, referencias: [] });
  assert.match(t, /Você está na Rua A\./);
  assert.match(t, /GPS está fraco/);
  assert.match(t, /Não sei para que lado/);
});

test("frase: lugar familiar vem primeiro", () => {
  const t = fraseOndeEstou({ endereco: "Rua A", precisaoM: 5, rumoPessoa: 90, familiar: "portão de casa" });
  assert.ok(t.startsWith("Este lugar parece ser portão de casa."));
  assert.match(t, /virado para o leste/);
});

test("consulta Overpass leva o raio e a posição", () => {
  const q = consultaOverpass(AQUI, 60);
  assert.match(q, /around:60,-15\.601000,-56\.097400/);
  assert.match(q, /bus_stop/);
});

test("ondeEstou: uma fonte falhando não derruba a outra", async () => {
  const fetchFalso = async (url) => {
    if (String(url).includes("nominatim")) {
      return { ok: true, json: async () => ({ address: { road: "Rua Treze de Junho", suburb: "Centro" } }) };
    }
    return { ok: false, json: async () => ({}) };   // Overpass fora do ar
  };
  const r = await ondeEstou(AQUI, { rumoPessoa: 0, fetch: fetchFalso });
  assert.equal(r.endereco, "Rua Treze de Junho, bairro Centro");
  assert.equal(r.referencias.length, 0);
  assert.equal(r.falhas, 1);
  assert.match(r.texto, /Não achei pontos de referência/);
});

test("perguntou de novo parado: resposta curta, sem repetir o parágrafo", async () => {
  const resp = (url) => String(url).includes("nominatim")
    ? { ok: true, json: async () => ({ address: { road: "Rua A", house_number: "100", suburb: "Centro" } }) }
    : { ok: true, json: async () => ({ elements: [
        { lat: norte(20).lat, lon: AQUI.lng, tags: { highway: "crossing" } },
        { lat: AQUI.lat, lon: leste(15).lng, tags: { amenity: "pharmacy" } },
      ] }) };
  const f = async (u) => resp(u);
  const um = await ondeEstou(AQUI, { rumoPessoa: 0, fetch: f, agoraMs: 0 });
  const dois = await ondeEstou(AQUI, { rumoPessoa: 5, fetch: f, agoraMs: 30000, anterior: um.estado });
  assert.match(dois.texto, /continua no mesmo ponto/);
  assert.ok(dois.texto.length < um.texto.length / 1.5, `segunda resposta longa demais: ${dois.texto}`);
  assert.doesNotMatch(dois.texto, /bairro/);
});

test("perguntou de novo depois de girar: diz o novo rumo e onde as referências ficaram", async () => {
  const f = async (u) => String(u).includes("nominatim")
    ? { ok: true, json: async () => ({ address: { road: "Rua A" } }) }
    : { ok: true, json: async () => ({ elements: [{ lat: norte(20).lat, lon: AQUI.lng, tags: { highway: "crossing" } }] }) };
  const um = await ondeEstou(AQUI, { rumoPessoa: 0, fetch: f, agoraMs: 0 });
  const dois = await ondeEstou(AQUI, { rumoPessoa: 90, fetch: f, agoraMs: 20000, anterior: um.estado });
  assert.match(dois.texto, /Agora virado para o leste/);
  assert.match(dois.texto, /faixa de pedestre, à sua esquerda/);
});

test("depois de muito tempo, volta a dar a resposta completa", async () => {
  const f = async (u) => String(u).includes("nominatim")
    ? { ok: true, json: async () => ({ address: { road: "Rua A" } }) }
    : { ok: true, json: async () => ({ elements: [] }) };
  const um = await ondeEstou(AQUI, { rumoPessoa: 0, fetch: f, agoraMs: 0 });
  const dois = await ondeEstou(AQUI, { rumoPessoa: 0, fetch: f, agoraMs: 10 * 60 * 1000, anterior: um.estado });
  assert.match(dois.texto, /^Você está na Rua A/);
});
