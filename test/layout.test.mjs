// Guarda do layout da página.
//
// Existe por causa de um defeito real: a barra "Ir para…" entrou como quinto
// filho do grid do `body`, que só declarava quatro linhas. A câmera foi parar
// numa linha implícita de altura automática e colapsou para zero. O app subiu
// ao ar funcionando — detectando, falando, tudo — e com a tela preta.
//
// Nada disso aparece em teste de lógica, e a tela preta não aparece em
// `node --check`. O que pega é contar: quantos filhos em fluxo o `body` tem, e
// quantas faixas o `grid-template-rows` declara.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

const VAZIAS = new Set([
  "meta", "link", "img", "br", "hr", "input", "source", "area", "base", "col",
  "embed", "param", "track", "wbr", "path", "circle", "rect", "use", "line",
  "polyline", "polygon", "ellipse", "stop",
]);

/** Filhos diretos do body que ocupam uma linha do grid. */
function filhosEmFluxo() {
  const tags = [...html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)];
  const filhos = [];
  let noBody = false;
  let profundidade = 0;

  for (const [, barra, bruto, resto] of tags) {
    const tag = bruto.toLowerCase();
    if (tag === "body") { noBody = !barra; profundidade = 0; continue; }
    if (!noBody) continue;
    const autofecha = VAZIAS.has(tag) || /\/\s*$/.test(resto);

    if (barra) { profundidade = Math.max(0, profundidade - 1); continue; }
    if (profundidade === 0) {
      // `script` não desenha; `dialog` fechado é display:none; o parágrafo do
      // leitor de tela é .sr-only, position:absolute. Nenhum ocupa linha.
      const foraDoFluxo = tag === "script" || tag === "dialog"
        || /class="[^"]*\bsr-only\b/.test(resto);
      if (!foraDoFluxo) filhos.push(tag);
    }
    if (!autofecha) profundidade++;
  }
  return filhos;
}

/** Quantas faixas o grid-template-rows do body declara. */
function faixasDoGrid() {
  const corpo = html.match(/\n\s*body\s*\{([\s\S]*?)\}/);
  assert.ok(corpo, "não achei a regra CSS do body");
  const linha = corpo[1].match(/grid-template-rows:\s*([^;]+);/);
  assert.ok(linha, "o body precisa declarar grid-template-rows");
  // minmax(0, 1fr) é uma faixa só: neutraliza a vírgula de dentro antes de contar
  return linha[1].replace(/\([^)]*\)/g, "X").trim().split(/\s+/).length;
}

test("o grid do body tem uma faixa para cada filho em fluxo", () => {
  const filhos = filhosEmFluxo();
  const faixas = faixasDoGrid();
  assert.equal(faixas, filhos.length,
    `${filhos.length} filhos (${filhos.join(", ")}) para ${faixas} faixas. `
    + "Sobrando filho, ele cai numa linha implícita de altura automática — "
    + "foi assim que a câmera ficou com altura zero e a tela, preta.");
});

test("a câmera fica na faixa elástica, e só ela", () => {
  const filhos = filhosEmFluxo();
  const i = filhos.indexOf("main");
  assert.ok(i >= 0, "o <main> da câmera sumiu do body");

  const corpo = html.match(/\n\s*body\s*\{([\s\S]*?)\}/)[1];
  // Junta o miolo dos parênteses para que "minmax(0, 1fr)" conte como uma
  // faixa só ao separar por espaço.
  const faixas = corpo.match(/grid-template-rows:\s*([^;]+);/)[1]
    .replace(/\([^)]*\)/g, (m) => m.replace(/[,\s]+/g, "·"))
    .trim().split(/\s+/);

  assert.match(faixas[i], /fr/,
    `a faixa do <main> é "${faixas[i]}": a câmera precisa da faixa elástica, `
    + "senão ela encolhe para o tamanho do conteúdo, que é zero");
  const elasticas = faixas.filter((f) => f.includes("fr")).length;
  assert.equal(elasticas, 1,
    "só a câmera pode ser elástica; duas faixas em fr dividem a tela entre elas");
});

test("a faixa da câmera pode encolher de verdade", () => {
  const corpo = html.match(/\n\s*body\s*\{([\s\S]*?)\}/)[1];
  const regra = corpo.match(/grid-template-rows:\s*([^;]+);/)[1];
  // Um `1fr` cru tem mínimo automático: em tela baixa ele empurra os botões
  // de ação para fora da viewport em vez de ceder espaço.
  assert.match(regra, /minmax\(\s*0\s*,\s*1fr\s*\)/,
    "use minmax(0, 1fr) na faixa da câmera, não 1fr cru");
});

test("os controles que o app.js procura existem no HTML", () => {
  // O app quebra inteiro num `null.addEventListener`, e o testador só vê um
  // app que não reage a nada.
  const obrigatorios = [
    "camera", "overlay", "toggle", "descrever", "lerTexto", "status", "fala",
    "navBarra", "ir", "pararRota", "destino", "campoDestino", "formDestino",
    "ditar", "cancelarDestino", "navDestino", "navRestante",
    "chkAberto", "chkNuvem", "campoChaveGoogle", "campoEndpointNuvem",
    "contaVocabulario", "chkPiso", "chkValidando", "selVerbosidade", "selModelo",
  ];
  const faltando = obrigatorios.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(faltando, [], `ids ausentes no index.html: ${faltando.join(", ")}`);
});
