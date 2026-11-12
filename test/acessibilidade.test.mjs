// Guarda de acessibilidade do index.html.
//
// POR QUE ISTO É UM TESTE E NÃO UMA LISTA DE VERIFICAÇÃO. Acessibilidade
// quebra em silêncio. Trocar um `aria-disabled` por `disabled` para "arrumar o
// visual", ou acrescentar um botão sem rótulo, não derruba nada, não aparece
// em nenhuma tela e não dá erro no console — simplesmente apaga o botão para
// quem usa leitor de tela. Quem percebe é o usuário cego, na rua, meses
// depois.
//
// Cada regra aqui corresponde a um defeito real, encontrado numa auditoria
// deste arquivo, e a um critério das diretrizes (WCAG 2.2 AA, e a NBR 17060
// de acessibilidade em aplicativos). O comentário diz qual, porque sem isso o
// teste vira superstição e o próximo a mexer o apaga.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

/** Pega cada tag de abertura de um tipo, com seus atributos. */
const tags = (nome) => [...html.matchAll(new RegExp(`<${nome}\\b[^>]*>`, "g"))].map((m) => m[0]);

const temAtributo = (tag, attr) => new RegExp(`\\b${attr}\\s*=`).test(tag);

// ------------------------------------------------------------
// Estrutura
// ------------------------------------------------------------

test("a página declara o idioma (WCAG 3.1.1)", () => {
  // Sem `lang`, o leitor de tela lê português com fonética de inglês. É a
  // diferença entre "travessia" e algo incompreensível.
  assert.match(html, /<html[^>]*\blang="pt-BR"/);
});

test("existe exatamente um h1 (WCAG 1.3.1, 2.4.6)", () => {
  // Quem usa leitor de tela navega por cabeçalhos antes de tudo. A página não
  // tinha nenhum: o atalho de "próximo cabeçalho" não levava a lugar nenhum e
  // a pessoa precisava varrer a tela elemento por elemento.
  const h1 = html.match(/<h1\b/g) ?? [];
  assert.equal(h1.length, 1, `esperava 1 h1, achei ${h1.length}`);
});

test("o zoom não está bloqueado (WCAG 1.4.4)", () => {
  // `user-scalable=no` ou `maximum-scale=1` impedem quem tem baixa visão de
  // ampliar. Este app é feito para baixa visão: bloquear o zoom seria o
  // contrário do que ele existe para fazer.
  const vp = html.match(/<meta[^>]*name="viewport"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(vp, /user-scalable\s*=\s*no/);
  assert.doesNotMatch(vp, /maximum-scale\s*=\s*1(\D|$)/);
});

// ------------------------------------------------------------
// Regiões vivas
// ------------------------------------------------------------

test("há uma região viva educada e uma assertiva, e só uma de cada", () => {
  // O defeito original: UMA região, `assertive`, para tudo. `assertive` manda
  // o leitor de tela interromper o que está lendo — então a pessoa não
  // conseguia ouvir o rótulo de um botão até o fim, porque a barra de status
  // cortava a frase no meio a cada aviso do app.
  const polite = [...html.matchAll(/aria-live="polite"/g)].length;
  const assertivas = [...html.matchAll(/aria-live="assertive"/g)].length;
  assert.equal(polite, 1, "deve existir uma região 'polite' para o comum");
  assert.equal(assertivas, 1, "só o obstáculo iminente justifica 'assertive'");
  assert.match(html, /id="live"[^>]*aria-live="polite"/);
  assert.match(html, /id="liveUrgente"[^>]*aria-live="assertive"/);
});

// ------------------------------------------------------------
// Controles
// ------------------------------------------------------------

test("todo botão tem nome acessível (WCAG 4.1.2)", () => {
  // Botão só com ícone e sem `aria-label` é anunciado como "botão" e mais
  // nada. Para quem não enxerga, é um botão que não se sabe o que faz.
  const semNome = [];
  for (const tag of tags("button")) {
    if (temAtributo(tag, "aria-label") || temAtributo(tag, "aria-labelledby")) continue;
    // Sem rótulo no atributo, precisa ter texto próprio — o conteúdo entre as
    // tags. Pegamos o trecho que começa nesta tag.
    const i = html.indexOf(tag);
    const corpo = html.slice(i + tag.length, html.indexOf("</button>", i));
    // Texto que não esteja dentro de um elemento escondido do leitor.
    const visivel = corpo.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim();
    if (!visivel) semNome.push(tag.slice(0, 80));
  }
  assert.deepEqual(semNome, [], `botões sem nome acessível: ${semNome.join(" | ")}`);
});

test("nenhum controle da barra de ações usa `disabled` (discoverability)", () => {
  // VoiceOver e TalkBack PULAM controles desabilitados na navegação por
  // deslize. Com `disabled`, uma pessoa cega varrendo a barra inferior
  // encontrava só o botão Iniciar e nunca descobria que "Ler texto" e "O que
  // tem aqui?" existem. `aria-disabled` mantém o botão encontrável e
  // anunciado como indisponível.
  const barra = html.slice(html.indexOf('<nav class="barra"'), html.indexOf("</nav>"));
  assert.doesNotMatch(barra, /\sdisabled(\s|>)/,
    "use aria-disabled: `disabled` apaga o botão para quem usa leitor de tela");
  assert.match(barra, /id="lerTexto"[^>]*aria-disabled/);
  assert.match(barra, /id="descrever"[^>]*aria-disabled/);
});

test("todo campo de formulário tem rótulo associado (WCAG 1.3.1, 3.3.2)", () => {
  // No HTML deste app os campos moram DENTRO do <label>, que é a associação
  // implícita e vale. Este teste existe para o dia em que alguém tirar um
  // campo de dentro do label sem pôr um `for`.
  const controles = [...tags("input"), ...tags("select")];
  const semRotulo = [];
  for (const tag of controles) {
    const id = tag.match(/id="([^"]+)"/)?.[1];
    if (!id) continue;
    if (temAtributo(tag, "aria-label") || temAtributo(tag, "aria-labelledby")) continue;
    if (html.includes(`for="${id}"`)) continue;
    // associação implícita: o controle está dentro de um <label>
    const i = html.indexOf(tag);
    const antes = html.lastIndexOf("<label", i);
    const fecha = html.lastIndexOf("</label>", i);
    if (antes > fecha) continue;
    semRotulo.push(id);
  }
  assert.deepEqual(semRotulo, [], `campos sem rótulo: ${semRotulo.join(", ")}`);
});

test("existe a escolha de quem fala: Íris ou leitor de tela", () => {
  // Sem ela, cada frase saía duas vezes para quem usa leitor de tela — que é
  // todo usuário cego deste app. Ver politicaDeVoz(), em fala.js.
  assert.match(html, /id="selModoVoz"/);
  for (const v of ["iris", "leitor", "ambos"]) {
    assert.match(html, new RegExp(`value="${v}"`), `falta a opção ${v}`);
  }
});

// ------------------------------------------------------------
// Alvo de toque e foco
// ------------------------------------------------------------

test("os alvos de toque têm pelo menos 44 px (WCAG 2.5.8)", () => {
  // Mira grossa é o normal de quem não enxerga a tela: a pessoa encosta o
  // dedo onde acha que está o botão. Alvo pequeno vira toque no lugar errado.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const alturas = [...css.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(alturas.length > 0, "o CSS precisa declarar alturas mínimas");
  const pequenos = alturas.filter((h) => h < 44);
  assert.deepEqual(pequenos, [], `alvos abaixo de 44px: ${pequenos.join(", ")}`);
});

test("o foco é visível (WCAG 2.4.7, 2.4.11)", () => {
  // Nem todo usuário de leitor de tela é cego total: muita gente navega por
  // teclado com visão residual, e sem contorno de foco não sabe onde está.
  assert.match(html, /button:focus-visible[\s\S]{0,200}outline:\s*\d+px/);
});

test("quem prefere menos movimento é atendido (WCAG 2.3.3)", () => {
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

// ------------------------------------------------------------
// Conteúdo não textual
// ------------------------------------------------------------

test("imagem decorativa não é lida, e a câmera não é anunciada", () => {
  // O vídeo e o canvas são informação visual pura: anunciá-los só atrapalha.
  // O conteúdo deles chega pela voz, que é o app inteiro.
  assert.match(html, /<video[^>]*aria-hidden="true"/);
  assert.match(html, /<canvas[^>]*aria-hidden="true"/);
  assert.match(html, /<img[^>]*src="icons\/iris-logo\.svg"[^>]*alt=""/);
});

test("todo svg decorativo está escondido do leitor", () => {
  // Um <svg> sem `aria-hidden` dentro de um botão pode ser anunciado como
  // "imagem", antes do rótulo, em alguns leitores.
  //
  // `aria-hidden` é HERDADO: um svg dentro de um <span aria-hidden="true"> já
  // está escondido e não precisa do atributo próprio. Olhamos para trás no
  // documento para não exigir redundância — e para o teste não empurrar
  // ninguém a poluir o HTML.
  const expostos = [];
  for (const m of html.matchAll(/<svg\b[^>]*>/g)) {
    if (temAtributo(m[0], "aria-hidden")) continue;
    const antes = html.slice(Math.max(0, m.index - 400), m.index);
    // O último elemento aberto antes do svg esconde o que vem dentro dele?
    if (/aria-hidden="true"[^<]*>(?:\s|<(?!\/))*$/.test(antes)) continue;
    expostos.push(m[0].slice(0, 60));
  }
  assert.deepEqual(expostos, [],
    'svg decorativo precisa de aria-hidden="true", nele ou num elemento acima');
});
