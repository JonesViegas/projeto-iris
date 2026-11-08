import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Orientacao, caminhoAFrente, soAVia,
  PRIMEIRA_MS, INTERVALO_ANDANDO_MS, INTERVALO_PARADO_MS,
} from "../orientar.js";

const obj = (inPath, distanceM) => ({ inPath, distanceM, detection: { label: "x" } });

test("caminho à frente: livre, ocupado e 'não sei'", () => {
  assert.equal(caminhoAFrente([]), "livre");
  assert.equal(caminhoAFrente([obj(true, 2)]), "ocupado");
  // fora do caminho não ocupa o caminho
  assert.equal(caminhoAFrente([obj(false, 1)]), "livre");
  // longe demais para atrapalhar o próximo passo
  assert.equal(caminhoAFrente([obj(true, 20)]), "livre");
  // sem câmera o app NÃO afirma que está livre: isso derruba gente
  assert.equal(caminhoAFrente([], { vendo: false }), null);
  assert.equal(caminhoAFrente(null), null);
});

test("soAVia corta o complemento do endereço", () => {
  assert.equal(soAVia("Rua Barão de Melgaço, perto do número 200, no Centro"),
    "Rua Barão de Melgaço");
  assert.equal(soAVia(null), null);
  assert.equal(soAVia(""), null);
});

test("cala enquanto não há rua nem destino", () => {
  const o = new Orientacao();
  assert.equal(o.proxima(100000, { caminho: "livre", andando: true }), null);
});

test("não fala em cima do início da percepção", () => {
  const o = new Orientacao();
  o.iniciar(0);
  assert.equal(o.proxima(PRIMEIRA_MS - 1, { via: "Rua A", andando: true }), null);
  assert.ok(o.proxima(PRIMEIRA_MS + 1, { via: "Rua A", andando: true }));
});

test("a primeira orientação traz rua, sentido, caminho e destino", () => {
  const o = new Orientacao();
  o.iniciar(0);
  const f = o.proxima(PRIMEIRA_MS + 1, {
    via: "Rua Barão de Melgaço", cardeal: "leste", caminho: "livre",
    destino: "Farmácia Central", faltamM: 118, andando: true,
  });
  assert.equal(f.texto,
    "Você está na Rua Barão de Melgaço, indo para o leste. Caminho livre à frente. "
    + "Faltam 120 metros até Farmácia Central.");
});

test("não repete antes do intervalo, e respeita estar parado", () => {
  const o = new Orientacao();
  o.iniciar(0);
  const ctx = { via: "Rua A", cardeal: "leste", andando: true };
  const t0 = PRIMEIRA_MS + 1;
  assert.ok(o.proxima(t0, ctx));
  assert.equal(o.proxima(t0 + INTERVALO_ANDANDO_MS - 1, ctx), null);
  assert.ok(o.proxima(t0 + INTERVALO_ANDANDO_MS + 1, ctx));

  const p = new Orientacao();
  p.iniciar(0);
  const parado = { ...ctx, andando: false };
  const u0 = PRIMEIRA_MS + 1;
  assert.ok(p.proxima(u0, parado));
  assert.equal(p.proxima(u0 + INTERVALO_ANDANDO_MS + 1, parado), null);
  assert.ok(p.proxima(u0 + INTERVALO_PARADO_MS + 1, parado));
});

test("mudar de rua fura o intervalo — é a informação mais útil que existe", () => {
  const o = new Orientacao();
  o.iniciar(0);
  const t0 = PRIMEIRA_MS + 1;
  o.proxima(t0, { via: "Rua Barão de Melgaço", andando: true });
  const f = o.proxima(t0 + 2000, {
    via: "Avenida Getúlio Vargas", andando: true,
    destino: "Farmácia Central", faltamM: 80,
  });
  assert.ok(f, "mudança de rua não pode esperar o intervalo");
  assert.equal(f.texto,
    "Agora você está na Avenida Getúlio Vargas. Faltam 80 metros até Farmácia Central.");
});

test("as frases seguintes não repetem a mesma forma", () => {
  const o = new Orientacao();
  o.iniciar(0);
  const ctx = {
    via: "Rua A", cardeal: "leste", caminho: "livre",
    destino: "Padaria", faltamM: 200, andando: true,
  };
  let t = PRIMEIRA_MS + 1;
  const ditas = [];
  for (let i = 0; i < 4; i++) {
    const f = o.proxima(t, ctx);
    assert.ok(f, `faltou a fala ${i}`);
    ditas.push(f.texto);
    t += INTERVALO_ANDANDO_MS + 1;
  }
  for (let i = 1; i < ditas.length; i++) {
    assert.notEqual(ditas[i], ditas[i - 1], `repetiu literalmente: ${ditas[i]}`);
  }
});

test("chegando perto, troca metros por 'bem aqui'", () => {
  const o = new Orientacao();
  o.iniciar(0);
  const f = o.proxima(PRIMEIRA_MS + 1, {
    via: "Rua A", destino: "Farmácia Central", faltamM: 8, andando: true,
  });
  assert.match(f.texto, /Farmácia Central está bem aqui, a uns 8 metros\./);
});

test("sem destino, orienta só pelo lugar", () => {
  const o = new Orientacao();
  o.iniciar(0);
  const f = o.proxima(PRIMEIRA_MS + 1, { via: "Rua A", cardeal: "norte", andando: true });
  assert.equal(f.texto, "Você está na Rua A, indo para o norte.");
});

test("reset volta tudo ao estado de quem nunca falou", () => {
  const o = new Orientacao();
  o.iniciar(0);
  assert.ok(o.proxima(PRIMEIRA_MS + 1, { via: "Rua A", andando: true }));
  o.reset();
  o.iniciar(0);
  const f = o.proxima(PRIMEIRA_MS + 1, { via: "Rua A", andando: true });
  assert.equal(f.texto, "Você está na Rua A.");
});
