// Carrega o app.js inteiro num navegador de mentira e vê se ele sobrevive.
//
// Por que isto existe: o `app.js` faz muita coisa no corpo do módulo — procura
// elementos, registra ouvintes, lê preferências, calcula o aviso de queda. Se
// qualquer linha dessas falhar, o módulo inteiro não carrega, NENHUM ouvinte é
// registrado, e o que o testador vê é um aplicativo que simplesmente não reage
// a nada. Sem erro visível, sem fala, sem pista.
//
// `node --check` não pega isso: a sintaxe está certa. Os testes de lógica não
// pegam: eles importam `core.js`, não `app.js`. O que pega é carregar.
//
// O falso DOM aqui é deliberadamente burro: ele não desenha, não toca som e
// não abre câmera. Ele só precisa ser real o bastante para o módulo terminar
// de carregar — é a carga que está sob teste, não o comportamento.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

/** Todos os ids que existem no HTML de verdade. */
const IDS = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

function elementoFalso(id = "") {
  const el = {
    id,
    textContent: "",
    value: "",
    checked: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    width: 0, height: 0,
    clientWidth: 320, clientHeight: 240,
    readyState: 0, videoWidth: 0, videoHeight: 0,
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, remove() {}, click() {},
    showModal() {}, close() {}, focus() {},
    querySelector() { return elementoFalso(); },
    getContext() { return contextoFalso(); },
    toDataURL() { return "data:image/jpeg;base64,xx"; },
    play() { return Promise.resolve(); },
  };
  return el;
}

function contextoFalso() {
  const nada = () => {};
  return new Proxy({ measureText: () => ({ width: 10 }), canvas: { width: 0, height: 0 } }, {
    get: (alvo, p) => (p in alvo ? alvo[p] : nada),
    set: () => true,
  });
}

/** Alguns globais do Node só têm getter; atribuir direto lança TypeError. */
function definir(nome, valor) {
  Object.defineProperty(globalThis, nome, { value: valor, configurable: true, writable: true });
}

function montarNavegadorFalso() {
  const guardado = new Map();

  definir("document", {
    getElementById: (id) => (IDS.has(id) ? elementoFalso(id) : null),
    createElement: () => elementoFalso(),
    querySelector: (sel) => (String(sel).includes("iris-versao")
      ? { content: "teste" } : elementoFalso()),
    addEventListener() {}, removeEventListener() {},
    body: elementoFalso("body"),
    documentElement: elementoFalso("html"),
    hidden: false,
  });

  definir("window", {
    addEventListener() {}, removeEventListener() {},
    speechSynthesis: {
      getVoices: () => [], addEventListener() {}, speak() {}, cancel() {}, resume() {},
      speaking: false, pending: false, paused: false,
    },
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    devicePixelRatio: 2,
    AudioContext: class {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      createOscillator() { return contextoFalso(); }
      createGain() { return contextoFalso(); }
      resume() {}
    },
    google: undefined,
  });

  definir("navigator", {
    userAgent: "node-teste", language: "pt-BR", hardwareConcurrency: 4, deviceMemory: 8,
    geolocation: { watchPosition: () => 1, clearWatch() {}, getCurrentPosition() {} },
    vibrate() {}, mediaDevices: { getUserMedia: () => Promise.reject(new Error("sem câmera")) },
    wakeLock: { request: () => Promise.reject(new Error("sem wakeLock")) },
    serviceWorker: { register: () => Promise.resolve() },
  });

  definir("screen", { width: 390, height: 844 });

  definir("localStorage", {
    getItem: (k) => guardado.get(k) ?? null,
    setItem: (k, v) => guardado.set(k, String(v)),
    removeItem: (k) => guardado.delete(k),
  });

  // O app.js mantém um setInterval permanente para escoar a fila de fala. No
  // navegador isso é certo; aqui ele seguraria o processo do teste para
  // sempre. Os temporizadores do falso ambiente nascem soltos (`unref`), para
  // que o Node possa terminar quando o teste acabar.
  const intervaloReal = globalThis.setInterval;
  const esperaReal = globalThis.setTimeout;
  definir("setInterval", (fn, ms) => { const id = intervaloReal(fn, ms); id?.unref?.(); return id; });
  definir("setTimeout", (fn, ms) => { const id = esperaReal(fn, ms); id?.unref?.(); return id; });

  definir("requestAnimationFrame", () => 0);
  definir("cancelAnimationFrame", () => {});
  definir("getComputedStyle", () => ({ getPropertyValue: () => "#000000" }));
  definir("Blob", class { constructor() {} });
  globalThis.URL.createObjectURL = () => "blob:x";
  globalThis.URL.revokeObjectURL = () => {};
  return guardado;
}

test("o app.js carrega inteiro sem explodir", async () => {
  montarNavegadorFalso();
  // cache-busting: cada execução precisa reavaliar o módulo
  const mod = await import(`../app.js?t=${Date.now()}`);
  assert.ok(mod, "o módulo não carregou");
  // `vozDiag` é exportado pelo app.js; se ele veio, o módulo chegou ao fim
  assert.ok(mod.vozDiag, "o módulo não terminou de ser avaliado");
});

test("nenhum elemento procurado pelo app volta nulo", () => {
  // O elementoFalso só é devolvido para ids que existem no index.html de
  // verdade. Se o app pedir um id inexistente, recebe null — e o próximo
  // ponto depois dele derruba o módulo na carga.
  const app = readFileSync(
    fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  const pedidos = [...new Set([...app.matchAll(/\$\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]))];
  const nulos = pedidos.filter((id) => !IDS.has(id));
  assert.deepEqual(nulos, [], `o app.js pede ids que não existem: ${nulos.join(", ")}`);
});
