// Guarda do cache offline.
//
// POR QUE ISTO É UM TESTE. O Íris é instalado na tela de início e precisa abrir
// sem internet — é metade da razão de ele ser um PWA. Quem o abre no ponto de
// ônibus, sem dados, está contando com isso.
//
// Um módulo novo que não entre na lista do service worker não quebra nada no
// desenvolvimento, porque ali a rede está sempre disponível. Quebra no
// aparelho da pessoa, offline, e não quebra só o recurso novo: `import` que
// falha derruba o módulo que importou, que derruba o `app.js` inteiro. **O app
// não abre.** Nenhum erro visível, nenhuma fala, nenhuma pista.
//
// Acrescentar o arquivo ao `SHELL` é uma linha que qualquer um esquece. Por
// isso o teste, e não a lembrança.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = new URL("../", import.meta.url);
const ler = (nome) => readFileSync(fileURLToPath(new URL(nome, raiz)), "utf8");

const sw = ler("sw.js");
const html = ler("index.html");

/** Os caminhos listados no SHELL do service worker. */
const noShell = new Set(
  [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]),
);

/** Todo módulo local importado por algum arquivo do app. */
function importadosPor(arquivo) {
  const s = ler(arquivo);
  return [...s.matchAll(/from\s+"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
}

test("todo módulo importado está no cache offline", () => {
  // Varre a partir do app.js, transitivamente: um módulo importado por outro
  // módulo é tão necessário quanto um importado direto.
  const vistos = new Set();
  const fila = ["app.js"];
  const faltando = [];

  while (fila.length) {
    const atual = fila.pop();
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    if (!noShell.has(atual)) faltando.push(atual);
    for (const dep of importadosPor(atual)) fila.push(dep);
  }

  assert.deepEqual(faltando, [],
    `fora do SHELL do sw.js: ${faltando.join(", ")}. `
    + "Sem isso o app não ABRE offline — não é só o recurso que falta.");
});

test("tudo o que está no SHELL existe de verdade", () => {
  // O erro simétrico: um arquivo renomeado e não atualizado na lista faz o
  // `cache.addAll()` rejeitar INTEIRO, e aí nada é guardado. O app passa a
  // precisar de rede sempre, sem nunca avisar.
  const naRaiz = new Set(readdirSync(fileURLToPath(raiz), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? readdirSync(fileURLToPath(new URL(`${d.name}/`, raiz)))
      .map((f) => `${d.name}/${f}`) : [d.name])));

  const fantasmas = [...noShell].filter((p) => p !== "" && !naRaiz.has(p));
  assert.deepEqual(fantasmas, [],
    `no SHELL mas não no disco: ${fantasmas.join(", ")}. `
    + "Um caminho inválido faz o addAll() falhar inteiro e o cache não existir.");
});

test("a versão do cache acompanha a versão do app", () => {
  // Versão repetida significa cache velho servido como novo: a pessoa instala
  // a correção e continua rodando o código antigo, e ninguém entende por quê.
  const versaoApp = html.match(/name="iris-versao" content="([^"]+)"/)?.[1];
  const versaoSw = sw.match(/const VERSION = "iris-([^"]+)"/)?.[1];
  assert.ok(versaoApp, "index.html sem meta iris-versao");
  assert.ok(versaoSw, "sw.js sem VERSION");
  assert.equal(versaoSw, versaoApp,
    `index.html diz ${versaoApp} e sw.js diz ${versaoSw}`);
});
