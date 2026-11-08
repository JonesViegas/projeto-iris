import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSpatial, AlertEngine, describeScene, Direction, Proximity, Priority } from "../core.js";

const det = (label, l, t, r, b) => ({ label, score: 0.9, box: { left: l, top: t, right: r, bottom: b } });
const obj = (label, direction = Direction.FRENTE, proximity = Proximity.PERTO, inPath = true, extra = {}) =>
  ({ detection: det(label, 0.4, 0.2, 0.6, 0.9), direction, proximity, inPath, ...extra });

test("direção e caminho", () => {
  const out = analyzeSpatial([det("person", 0, .2, .2, .5), det("person", .4, .2, .6, .5), det("person", .8, .2, 1, .5)]);
  assert.deepEqual(out.map((o) => o.direction), [Direction.ESQUERDA, Direction.FRENTE, Direction.DIREITA]);
  assert.equal(out[0].inPath, false);
  assert.equal(analyzeSpatial([det("person", .1, .2, .4, .5)])[0].inPath, true);
});

test("proximidade pelo tamanho da caixa", () => {
  const out = analyzeSpatial([det("p", .3, .2, .7, .9), det("p", .3, .4, .7, .7), det("p", .3, .4, .7, .5)]);
  assert.deepEqual(out.map((o) => o.proximity), [Proximity.PERTO, Proximity.MEDIO, Proximity.LONGE]);
});

test("alerta exige dois quadros e respeita intervalo", () => {
  const e = new AlertEngine();
  assert.equal(e.process([obj("person")], 0), null);
  const a = e.process([obj("person")], 100);
  assert.equal(a.text, "Atenção, pessoa à frente, perto.");
  assert.equal(a.priority, Priority.ALTA);
  assert.equal(e.process([obj("person")], 1000), null);
  // Mesma pessoa, parada, à mesma distância: repete, mas sem martelar.
  assert.equal(e.process([obj("person")], 5200), null);
  assert.ok(e.process([obj("person")], 6200));
});

test("alta vence média e classes fora da lista são ignoradas", () => {
  const e = new AlertEngine();
  // o carro vem na nossa direção: isso, sim, é alta prioridade
  const cena = [obj("chair", Direction.FRENTE, Proximity.MEDIO),
                obj("car", Direction.DIREITA, Proximity.PERTO, false, { approaching: true }),
                obj("toothbrush")];
  e.process(cena, 0);
  assert.equal(e.process(cena, 100).text, "Cuidado, carro à direita, perto.");
});

test("descrição agrupa, ordena e flexiona", () => {
  const frame = [
    obj("dining table", Direction.DIREITA, Proximity.LONGE),
    obj("person", Direction.FRENTE, Proximity.PERTO),
    obj("person", Direction.FRENTE, Proximity.MEDIO),
    obj("chair", Direction.ESQUERDA, Proximity.MEDIO),
  ];
  assert.equal(describeScene([frame]),
    "Duas pessoas à frente, perto. Uma cadeira à esquerda, a média distância. Uma mesa à direita, longe.");
  assert.equal(describeScene([[obj("cup"), obj("cup")]]), "Dois copos à frente, perto.");
  assert.equal(describeScene([[]]), "Não reconheci nenhum objeto conhecido à frente.");
});

test("descrição junta quadros sem duplicar e limita grupos", () => {
  const f1 = [obj("person", Direction.FRENTE, Proximity.MEDIO)];
  const f2 = [obj("person"), obj("person", Direction.FRENTE, Proximity.MEDIO)];
  const f3 = [obj("dog", Direction.ESQUERDA, Proximity.LONGE)];
  assert.equal(describeScene([f1, f2, f3]), "Duas pessoas à frente, perto. Um cachorro à esquerda, longe.");
  const muitos = ["person", "chair", "cup", "bottle", "book", "clock", "vase", "laptop"].map((l) => obj(l, Direction.FRENTE, Proximity.MEDIO));
  assert.ok(describeScene([muitos]).endsWith("E mais 2 tipos de objeto."));
});

// ============================================================
// Projeto Íris — testes do que foi acrescentado
// ============================================================
import {
  distanciaMetros, metrosFalado, MotionTracker, corDoSemaforo, CorSemaforo,
  analisarPiso, obstaculosDoPiso, avisoDePiso,
} from "../core.js";

const cx = (t, b) => ({ left: 0.4, top: t, right: 0.6, bottom: b });

test("distância usa o tamanho real da classe, não só a caixa", () => {
  // mesma caixa, classes diferentes: o ônibus é maior, logo está mais longe
  const caixa = cx(0.2, 0.75);
  const pessoa = distanciaMetros("person", caixa);
  const onibus = distanciaMetros("bus", caixa);
  assert.ok(onibus > pessoa * 1.5, `ônibus ${onibus} deveria estar bem mais longe que pessoa ${pessoa}`);

  // caixa menor = mais longe
  assert.ok(distanciaMetros("person", cx(0.4, 0.5)) > distanciaMetros("person", cx(0.2, 0.9)));

  // classe sem altura conhecida devolve null (cai no método antigo)
  assert.equal(distanciaMetros("frisbee", caixa), null);
});

test("caixa cortada na borda puxa a distância para perto, a favor da segurança", () => {
  const inteira = distanciaMetros("person", cx(0.30, 0.80));
  const cortada = distanciaMetros("person", cx(0.30, 1.0));
  assert.ok(cortada < inteira, "objeto cortado embaixo tem altura subestimada; não pode sair mais longe");
  // cortado em cima e embaixo: está em cima de nós
  assert.ok(distanciaMetros("person", cx(0, 1)) <= 1.5);
});

test("fala da distância em português natural", () => {
  assert.equal(metrosFalado(0.8), "a menos de um metro");
  assert.equal(metrosFalado(1.0), "a menos de um metro");
  assert.equal(metrosFalado(2.5), "a dois metros e meio");
  assert.equal(metrosFalado(3.0), "a três metros");
  assert.equal(metrosFalado(25), "a mais de vinte metros");
  assert.equal(metrosFalado(null), null);
});

test("MotionTracker separa o que vem do que está parado", () => {
  const t = new MotionTracker();
  const alvo = (d) => [{ detection: { label: "car" }, direction: Direction.FRENTE, distanceM: d }];

  t.update(alvo(12), 0);
  const vindo = t.update(alvo(8), 1000);          // 4 m/s na nossa direção
  assert.equal(vindo[0].approaching, true);

  const t2 = new MotionTracker();
  t2.update(alvo(8), 0);
  const parado = t2.update(alvo(8), 1000);        // mesma distância
  assert.equal(parado[0].approaching, false);

  const t3 = new MotionTracker();
  t3.update(alvo(8), 0);
  const afastando = t3.update(alvo(12), 1000);    // se afastando
  assert.equal(afastando[0].approaching, false);
});

test("veículo parado fora do caminho não é alta prioridade", () => {
  // esta era a regressão: carro estacionado disparava alerta máximo e virava ruído
  const e = new AlertEngine();
  const cena = [obj("car", Direction.DIREITA, Proximity.PERTO, false, { approaching: false })];
  e.process(cena, 0);
  const a = e.process(cena, 100);
  assert.equal(a.priority, Priority.MEDIA);
  assert.ok(!a.text.startsWith("Atenção"), `não deveria ser urgente: ${a.text}`);
});

test("cor do semáforo: matiz e posição da lâmpada acesa", () => {
  const px = (r, g, b, yRel) => ({ r, g, b, yRel });
  const repetir = (p, n) => Array.from({ length: n }, () => p);

  // lâmpada vermelha acesa no alto
  const vermelho = corDoSemaforo(repetir(px(230, 40, 30, 0.15), 20));
  assert.equal(vermelho.cor, CorSemaforo.VERMELHO);

  // lâmpada verde acesa embaixo
  const verde = corDoSemaforo(repetir(px(40, 220, 90, 0.85), 20));
  assert.equal(verde.cor, CorSemaforo.VERDE);

  // tudo apagado ou cinza: não arrisca um palpite
  assert.equal(corDoSemaforo(repetir(px(30, 30, 30, 0.5), 20)), null);
  assert.equal(corDoSemaforo(repetir(px(200, 200, 200, 0.5), 20)), null);

  // amostras de menos: silêncio
  assert.equal(corDoSemaforo(repetir(px(230, 40, 30, 0.15), 3)), null);
});

test("piso: calçada é segura, via é perigo", () => {
  const calcada = analisarPiso({ 11: 700, 6: 100 }, 1000);
  assert.equal(calcada.nome, "calçada");
  assert.equal(calcada.seguro, true);

  const via = analisarPiso({ 6: 800, 11: 50 }, 1000);
  assert.equal(via.nome, "via");
  assert.equal(via.seguro, false);

  // nada domina: não inventa resposta
  assert.equal(analisarPiso({ 11: 100, 6: 100, 9: 100 }, 1000), null);
});

test("aviso de piso só fala quando importa", () => {
  const calcada = { nome: "calçada", seguro: true };
  const via = { nome: "via", seguro: false };

  assert.equal(avisoDePiso(calcada, calcada), null);              // seguir na calçada é silêncio
  assert.equal(avisoDePiso(via, calcada).priority, Priority.ALTA); // entrou na via
  assert.ok(avisoDePiso(via, calcada).text.includes("na via"));
  assert.ok(avisoDePiso(calcada, via).text.includes("De volta"));  // voltou para a calçada
});

test("obstáculos do piso: degrau e poste, que o detector de objetos não vê", () => {
  const achados = obstaculosDoPiso({ 121: 80, 93: 50, 11: 800 }, 1000);
  assert.deepEqual(achados.map((o) => o.nome), ["degrau", "poste"]);

  // ruído pequeno não vira alarme
  assert.deepEqual(obstaculosDoPiso({ 121: 5 }, 1000), []);

  // escada e escadaria colapsam num nome só
  const esc = obstaculosDoPiso({ 53: 100, 59: 90 }, 1000);
  assert.equal(esc.length, 1);
  assert.equal(esc[0].nome, "escada");
});

// ============================================================
// Narrador e estabilidade do alerta
// ============================================================
import { Narrador, Verbosidade } from "../core.js";

// A caixa acompanha a direção: mudar de lado sem a caixa andar não existe
// no mundo real, e o narrador agora exige deslocamento de verdade.
const CX_DIR = { [Direction.ESQUERDA]: 0.18, [Direction.FRENTE]: 0.50, [Direction.DIREITA]: 0.82 };
const objD = (label, direction = Direction.FRENTE, metros = 3, extra = {}) => {
  const cx = extra.cx ?? CX_DIR[direction];
  const { cx: _, ...resto } = extra;
  return {
    detection: det(label, cx - 0.1, 0.2, cx + 0.1, 0.9),
    direction,
    proximity: metros <= 2.5 ? Proximity.PERTO : metros <= 8 ? Proximity.MEDIO : Proximity.LONGE,
    inPath: true,
    distanceM: metros,
    ...resto,
  };
};

test("regressão: distância oscilando não pode calar o alerta", () => {
  // A distância estimada treme de quadro a quadro. Se o contador de quadros
  // usar a proximidade na chave, ele zera sempre e o app nunca fala.
  const e = new AlertEngine();
  const oscila = [2.4, 2.6, 2.4, 2.6, 2.45];
  let falou = null;
  oscila.forEach((m, i) => {
    const r = e.process([objD("person", Direction.FRENTE, m)], i * 100);
    if (r && !falou) falou = r;
  });
  assert.ok(falou, "o alerta precisa sair mesmo com a distância tremendo na fronteira");
  assert.ok(falou.text.toLowerCase().includes("pessoa"));
});

test("narrador anuncia objeto novo", () => {
  const n = new Narrador();
  const ev = n.evento([objD("person", Direction.DIREITA, 4)], 1000, Verbosidade.NORMAL);
  assert.equal(ev.tipo, "apareceu");
  assert.ok(ev.text.includes("Pessoa"));
  assert.ok(ev.text.includes("à direita"));
});

test("narrador anuncia o que vem na direção da pessoa", () => {
  const n = new Narrador();
  n.evento([objD("car", Direction.FRENTE, 10)], 0, Verbosidade.NORMAL);
  const ev = n.evento([objD("car", Direction.FRENTE, 6, { approaching: true })], 4000, Verbosidade.NORMAL);
  assert.equal(ev.tipo, "aproximando");
  assert.ok(ev.text.includes("se aproximando"));
});

test("narrador percebe alguém passando de um lado para o outro", () => {
  const n = new Narrador();
  n.evento([objD("person", Direction.ESQUERDA, 4)], 0, Verbosidade.NORMAL);
  const ev = n.evento([objD("person", Direction.DIREITA, 4)], 4000, Verbosidade.NORMAL);
  assert.equal(ev.tipo, "passando");
  assert.ok(ev.text.includes("passando"));
});

test("narrador não repete nem atropela a voz", () => {
  const n = new Narrador();
  const cena = [objD("person", Direction.FRENTE, 4)];
  assert.ok(n.evento(cena, 0, Verbosidade.NORMAL));
  assert.equal(n.evento(cena, 500, Verbosidade.NORMAL), null, "intervalo mínimo entre falas");
  assert.equal(n.evento(cena, 5000, Verbosidade.NORMAL), null, "mesmo objeto não repete dentro do cooldown");
});

test("verbosidade controla o que é narrado", () => {
  // "book" não gera alerta de locomoção. A 5 m, fora do alcance imediato,
  // só o modo detalhado fala. Perto, qualquer nível acima de PERIGOS fala
  // (coberto no teste do bicho de pelúcia).
  const livro = [objD("book", Direction.FRENTE, 5)];
  assert.equal(new Narrador().evento(livro, 1000, Verbosidade.PERIGOS), null);
  assert.equal(new Narrador().evento(livro, 1000, Verbosidade.NORMAL), null,
    "objeto sem risco e fora do alcance não vira tagarelice");
  const det = new Narrador().evento(livro, 1000, Verbosidade.DETALHADO);
  assert.ok(det, "no modo detalhado até o livro é narrado");
  assert.ok(det.text.includes("Livro"));
});

test("objeto perto é narrado mesmo fora da lista de risco", () => {
  // Caso real do piloto: o app reconheceu um bicho de pelúcia à frente
  // e ficou mudo, porque "teddy bear" não gera alerta de locomoção.
  const perto = [objD("teddy bear", Direction.FRENTE, 1.5)];
  const ev = new Narrador().evento(perto, 1000, Verbosidade.NORMAL);
  assert.ok(ev, "objeto perto precisa ser falado");
  assert.ok(ev.text.toLowerCase().includes("pelúcia"));

  // longe e sem risco continua em silêncio, para não virar tagarelice
  const longe = [objD("teddy bear", Direction.FRENTE, 12)];
  assert.equal(new Narrador().evento(longe, 1000, Verbosidade.NORMAL), null);
});

// ============================================================
// Achados do simulador (test/simular.mjs)
// ============================================================
import { associarCortantes, OBJETOS_CORTANTES, NOMES } from "../core.js";

test("tremor da caixa não pode inventar que o objeto passou de lado", () => {
  // O simulador acusou "Copo passando à frente" sem parar, com o copo imóvel:
  // o ruído natural da detecção cruzava a fronteira entre direções.
  const n = new Narrador();
  n.evento([objD("person", Direction.FRENTE, 3, { cx: 0.49 })], 0, Verbosidade.NORMAL);
  const tremeu = n.evento(
    [{ ...objD("person", Direction.ESQUERDA, 3, { cx: 0.34 }) }], 4000, Verbosidade.NORMAL);
  assert.ok(!tremeu || tremeu.tipo !== "passando",
    `deslocamento de 0,15 é tremor, não passagem: veio ${tremeu?.tipo}`);

  // deslocamento grande de verdade continua sendo passagem
  const n2 = new Narrador();
  n2.evento([objD("person", Direction.ESQUERDA, 3)], 0, Verbosidade.NORMAL);
  const passou = n2.evento([objD("person", Direction.DIREITA, 3)], 4000, Verbosidade.NORMAL);
  assert.equal(passou?.tipo, "passando");
});

test("metro no singular", () => {
  assert.equal(metrosFalado(1.5), "a um metro e meio");
  assert.equal(metrosFalado(2.5), "a dois metros e meio");
});

test("objeto cortante herda a distância da pessoa que o segura", () => {
  // Faca de perfil vira caixa fininha e a distância pela altura sai absurda.
  // Junto a uma pessoa, a distância DELA é a confiável.
  const pessoa = objD("person", Direction.FRENTE, 3);
  const faca = {
    detection: { label: "knife", score: .7, box: { left: .52, top: .45, right: .58, bottom: .55 } },
    direction: Direction.FRENTE, proximity: Proximity.LONGE, inPath: true, distanceM: 40,
  };
  const [, k] = associarCortantes([pessoa, faca]);
  assert.equal(k.comPessoa, true);
  assert.equal(k.distanceM, 3, "deve herdar os 3 m da pessoa, não os 40 m da lâmina");
  assert.equal(k.proximity, Proximity.MEDIO);

  // sem pessoa na cena, nada é associado
  const [so] = associarCortantes([faca]);
  assert.ok(!so.comPessoa);
});

test("alerta de cortante é hedgeado e absorve o alerta da pessoa", () => {
  const e = new AlertEngine();
  const pessoa = objD("person", Direction.FRENTE, 2);
  const faca = {
    detection: { label: "knife", score: .7, box: { left: .52, top: .45, right: .58, bottom: .55 } },
    direction: Direction.FRENTE, proximity: Proximity.LONGE, inPath: true, distanceM: 40,
  };
  const cena = associarCortantes([pessoa, faca]);
  e.process(cena, 0);
  const a = e.process(cena, 100);

  assert.equal(a.priority, Priority.ALTA);
  assert.ok(a.text.includes("objeto pontiagudo"), `esperava linguagem hedgeada: ${a.text}`);
  assert.ok(!/faca|arma/i.test(a.text), `nunca nomear a lâmina nem dizer arma: ${a.text}`);

  // o alerta simples de "pessoa" foi absorvido: uma frase, não duas
  const seguinte = e.process(cena, 4000);
  assert.ok(!seguinte || seguinte.text.includes("pontiagudo"),
    `não pode repetir a pessoa em separado: ${seguinte?.text}`);
});

test("COCO não detecta arma de fogo, e isso é contratual", () => {
  // Se um dia alguém adicionar uma classe de arma, este teste força a revisão
  // da comunicação ao usuário e do README antes de prometer qualquer coisa.
  assert.ok(!Object.keys(NOMES).some((k) => /gun|pistol|firearm|weapon|rifle/i.test(k)));
  for (const c of OBJETOS_CORTANTES) assert.ok(NOMES[c], `${c} precisa de nome em português`);
});

test("vários objetos na cena: todos ganham voz, não só o primeiro", () => {
  // Sintoma relatado no piloto: o app mostrava vários objetos na tela e
  // falava um só. A causa era marcar TODOS como vistos a cada ciclo mesmo
  // anunciando um; os demais nasciam calados para sempre.
  const n = new Narrador();
  const cena = [
    objD("cup", Direction.ESQUERDA, 1),
    objD("cell phone", Direction.FRENTE, 1),
    objD("bottle", Direction.DIREITA, 1),
  ];
  const ditos = [];
  for (let t = 0; t <= 8000; t += 200) {
    const ev = n.evento(cena, t, Verbosidade.NORMAL);
    if (ev?.tipo === "apareceu") ditos.push(ev.text);
  }
  const juntos = ditos.join(" ").toLowerCase();
  for (const esperado of ["copo", "celular", "garrafa"]) {
    assert.ok(juntos.includes(esperado), `"${esperado}" nunca foi falado: ${ditos.join(" | ")}`);
  }
});

// ---------------- Sem repetição (0.10) ----------------

test("alerta: subir para 'Atenção' com a mesma frase não repete a frase", () => {
  const e = new AlertEngine();
  const medio = obj("person", Direction.FRENTE, Proximity.PERTO, false, { distanceM: 2.4 });
  const alta = obj("person", Direction.FRENTE, Proximity.PERTO, true, { distanceM: 2.4 });
  e.process([medio], 0);
  assert.match(e.process([medio], 100).text, /^Pessoa/);
  assert.equal(e.process([alta], 1200), null, "mesma pessoa, mesma distância: nada novo a dizer");
});

test("alerta: objeto parado não vira alarme a cada 3 segundos", () => {
  const e = new AlertEngine();
  const mesa = [obj("chair", Direction.FRENTE, Proximity.PERTO, false, { distanceM: 1.5 })];
  const falas = [];
  for (let t = 0; t <= 20000; t += 100) { const a = e.process(mesa, t); if (a) falas.push(t); }
  assert.ok(falas.length <= 2, `repetiu ${falas.length} vezes em 20 s`);
});

test("alerta: semáforo que muda de cor fala na hora", () => {
  const e = new AlertEngine();
  const sem = (cor) => [obj("traffic light", Direction.FRENTE, Proximity.MEDIO, false, { distanceM: 7, cor })];
  e.process(sem("vermelho"), 0);
  assert.match(e.process(sem("vermelho"), 100).text, /vermelho/);
  const v = e.process(sem("verde"), 1200) ?? e.process(sem("verde"), 1300);
  assert.match(v?.text ?? "", /verde/);
});
