// Testes da estabilidade espacial.
//
// Cada caso aqui é uma cena de rua que já produziu fala errada no simulador ou
// no teste de campo. O que se verifica não é "a função devolve o valor certo",
// é "a pessoa cega ouve a coisa certa uma vez só".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EstabilizadorEspacial, direcaoComHisterese, faixaComHisterese, rotuloVotado,
  sobreposicao, confirmados, HISTERESE, atravancaCorredor,
} from "../estavel.js";
import { analyzeSpatial, AlertEngine, Direction, Proximity } from "../core.js";
import { EstadoDaCena } from "../fala.js";

const caixa = (cx, altura = 0.3, largura = 0.18) => ({
  left: cx - largura / 2, right: cx + largura / 2,
  top: 0.5 - altura / 2, bottom: 0.5 + altura / 2,
});

const det = (label, cx, altura) => ({ label, score: 0.8, box: caixa(cx, altura) });

test("sobreposição: a mesma caixa é 1, caixas separadas são 0", () => {
  const a = caixa(0.5);
  assert.equal(sobreposicao(a, a), 1);
  assert.equal(sobreposicao(caixa(0.1), caixa(0.9)), 0);
  assert.ok(sobreposicao(caixa(0.5), caixa(0.52)) > 0.5);
  assert.equal(sobreposicao(null, a), 0);
});

// ------------------------------------------------------------
// Direção
// ------------------------------------------------------------

test("direção sem estado anterior usa o limite seco", () => {
  assert.equal(direcaoComHisterese(0.2, null), Direction.ESQUERDA);
  assert.equal(direcaoComHisterese(0.5, null), Direction.FRENTE);
  assert.equal(direcaoComHisterese(0.8, null), Direction.DIREITA);
});

test("objeto parado em cima da fronteira NÃO troca de lado", () => {
  // O caso real: um poste cujo centro oscila entre 0,64 e 0,66 por tremor da
  // caixa. Sem histerese, ele era "à frente" e "à direita" alternadamente, e o
  // freio de repetição do alerta — indexado por classe|direção — não o
  // reconhecia como o mesmo objeto. A pessoa ouvia o mesmo poste duas vezes.
  let dir = Direction.FRENTE;
  for (const cx of [0.66, 0.64, 0.67, 0.63, 0.66, 0.68]) {
    dir = direcaoComHisterese(cx, dir);
    assert.equal(dir, Direction.FRENTE, `cx=${cx} não deveria trocar de lado`);
  }
});

test("movimento de verdade troca de lado, só que passando da margem", () => {
  let dir = Direction.FRENTE;
  dir = direcaoComHisterese(0.70, dir);
  assert.equal(dir, Direction.FRENTE, "0,70 ainda está dentro da margem");
  dir = direcaoComHisterese(0.74, dir);
  assert.equal(dir, Direction.DIREITA, "0,74 passou de 0,65 + 0,07");
  // E para voltar também precisa passar da margem, pelo outro lado.
  // E para voltar também precisa passar da margem, pelo outro lado: 0,62 já
  // está "à frente" pela régua seca, e mesmo assim continua à direita.
  dir = direcaoComHisterese(0.62, dir);
  assert.equal(dir, Direction.DIREITA, "0,62 ainda não passou de 0,65 − 0,07");
  dir = direcaoComHisterese(0.56, dir);
  assert.equal(dir, Direction.FRENTE);
});

test("a margem de direção é simétrica dos dois lados", () => {
  let dir = Direction.FRENTE;
  dir = direcaoComHisterese(0.30, dir);
  assert.equal(dir, Direction.FRENTE, "0,30 está dentro da margem de 0,35");
  dir = direcaoComHisterese(0.26, dir);
  assert.equal(dir, Direction.ESQUERDA);
});

// ------------------------------------------------------------
// Faixa de distância
// ------------------------------------------------------------

test("aproximar vale na hora; afastar exige a margem", () => {
  // Aproximação é reconhecida no limite seco: atrasar aviso de algo chegando
  // perto é o erro que machuca.
  assert.equal(faixaComHisterese(2.4, Proximity.MEDIO), Proximity.PERTO);
  // Afastamento de 10 cm não tira o objeto da faixa PERTO.
  assert.equal(faixaComHisterese(2.6, Proximity.PERTO), Proximity.PERTO);
  assert.equal(faixaComHisterese(3.2, Proximity.PERTO), Proximity.PERTO);
  // Passou de 2,5 + 0,9: agora sim.
  assert.equal(faixaComHisterese(3.6, Proximity.PERTO), Proximity.MEDIO);
});

test("objeto oscilando em volta de 2,5 m não pisca de faixa", () => {
  // Este é o alerta intermitente em estado puro: a distância sai da altura da
  // caixa, e 6% de tremor a 2,5 m já cruza a fronteira para os dois lados.
  const tremor = [2.6, 2.4, 2.55, 2.45, 2.7, 2.3, 2.6, 2.5, 2.65, 2.35];

  // A régua seca, sem memória: é o que o app fazia.
  const seca = tremor.map((d) => (d <= 2.5 ? Proximity.PERTO : Proximity.MEDIO));
  let trocasSecas = 0;
  for (let i = 1; i < seca.length; i++) if (seca[i] !== seca[i - 1]) trocasSecas++;
  assert.ok(trocasSecas >= 5, `o defeito precisa existir: ${trocasSecas} trocas`);

  // Com histerese, o objeto entra em PERTO e fica: para sair precisaria passar
  // de 3,4 m, e ele nunca chega perto disso.
  let faixa = null, trocas = 0, anterior = null;
  for (const d of tremor) {
    faixa = faixaComHisterese(d, faixa);
    if (anterior !== null && faixa !== anterior) trocas++;
    anterior = faixa;
  }
  assert.equal(trocas, 1, `depois de assentar, a faixa não deveria mais mudar (mudou ${trocas}x)`);
  assert.equal(faixa, Proximity.PERTO);
});

test("sem distância medida, a faixa anterior permanece", () => {
  assert.equal(faixaComHisterese(null, Proximity.PERTO), Proximity.PERTO);
  assert.equal(faixaComHisterese(undefined, null), null);
});

// ------------------------------------------------------------
// Voto de rótulo — o "urso à frente" do teste noturno
// ------------------------------------------------------------

test("voto de rótulo: a maioria manda, o empate fica com o mais recente", () => {
  assert.equal(rotuloVotado(["dog", "dog", "bear", "dog"]), "dog");
  assert.equal(rotuloVotado(["bear", "dog"]), "dog");
  assert.equal(rotuloVotado([]), null);
});

test("uma classificação solitária de 'urso' não vira o nome falado", () => {
  // Teste de rua de 7/11, à noite: um quadro isolado classificado como urso
  // numa calçada do Centro. O alerta saiu. Com o voto, o nome falado continua
  // sendo o que a maioria dos quadros sustenta.
  const e = new EstabilizadorEspacial();
  let saida;
  for (const [i, label] of ["dog", "dog", "bear", "dog", "dog"].entries()) {
    saida = e.update(analyzeSpatial([det(label, 0.5, 0.3)]), i * 80);
  }
  assert.equal(saida[0].detection.label, "dog");
});

test("o rótulo cru fica registrado quando o voto o contraria", () => {
  const e = new EstabilizadorEspacial();
  let saida;
  for (const [i, label] of ["dog", "dog", "dog", "bear"].entries()) {
    saida = e.update(analyzeSpatial([det(label, 0.5, 0.3)]), i * 80);
  }
  assert.equal(saida[0].detection.label, "dog", "o voto segura o nome");
  assert.equal(saida[0].detection.rotuloCru, "bear", "mas o detector fica auditável");
});

// ------------------------------------------------------------
// Trilha estável
// ------------------------------------------------------------

test("o mesmo objeto mantém a trilha entre quadros", () => {
  const e = new EstabilizadorEspacial();
  const a = e.update(analyzeSpatial([det("car", 0.5, 0.3)]), 0);
  const b = e.update(analyzeSpatial([det("car", 0.52, 0.31)]), 80);
  assert.equal(a[0].trilha, b[0].trilha);
});

test("dois objetos iguais lado a lado não dividem a trilha", () => {
  // `classe|direção` colidia: seis carros estacionados à direita dividiam a
  // mesma chave, e o histórico de distância de um era comparado com o de
  // outro. Era a origem de "fechamento" de dezenas de m/s com tudo parado.
  const e = new EstabilizadorEspacial();
  const saida = e.update(analyzeSpatial([det("car", 0.78, 0.3), det("car", 0.9, 0.22)]), 0);
  assert.notEqual(saida[0].trilha, saida[1].trilha);
});

test("objeto de um quadro só não nasce confirmado", () => {
  const e = new EstabilizadorEspacial();
  const saida = e.update(analyzeSpatial([det("person", 0.5, 0.3)]), 0);
  assert.equal(saida[0].confirmado, false);
  assert.equal(confirmados(saida).length, 0);

  const dois = e.update(analyzeSpatial([det("person", 0.5, 0.3)]), 80);
  assert.equal(dois[0].confirmado, true);
  assert.equal(confirmados(dois).length, 1);
});

test("a trilha morre depois da sobrevida e o objeto volta a ser novo", () => {
  const e = new EstabilizadorEspacial();
  const a = e.update(analyzeSpatial([det("car", 0.5, 0.3)]), 0);
  const b = e.update(analyzeSpatial([det("car", 0.5, 0.3)]), HISTERESE.sobrevidaMs + 200);
  assert.notEqual(a[0].trilha, b[0].trilha);
});

test("piscada de um quadro não cria objeto novo", () => {
  // O detector perde o objeto num quadro e o reencontra no seguinte. Sem
  // sobrevida, ele voltava com trilha nova — e, com trilha nova, o freio de
  // repetição do alerta não o reconhecia e ele era anunciado outra vez.
  const e = new EstabilizadorEspacial();
  const a = e.update(analyzeSpatial([det("car", 0.5, 0.3)]), 0);
  e.update([], 80);
  const c = e.update(analyzeSpatial([det("car", 0.5, 0.3)]), 160);
  assert.equal(a[0].trilha, c[0].trilha);
});

test("entrar no corredor pede dois quadros; sair pede três", () => {
  // A assimetria é de segurança, e os números são pequenos de propósito: dois
  // quadros são cerca de 170 ms, que não atrasam nada de útil, e bastam para
  // cortar a "entrada" provocada por um tremor de caixa. Sair custa mais
  // porque declarar que o caminho ficou livre cedo demais é o erro que machuca.
  const e = new EstabilizadorEspacial();

  // Bem no meio do caminho, perto: atravanca sem dúvida.
  let s = e.update(analyzeSpatial([det("person", 0.5, 0.62)]), 0);
  assert.equal(s[0].inPath, false, "um quadro só não confirma obstrução");
  s = e.update(analyzeSpatial([det("person", 0.5, 0.62)]), 80);
  assert.equal(s[0].inPath, true, "dois quadros bastam");

  // Oscilar na beira não pode zerar o que já foi confirmado.
  for (const [i, cx] of [0.56, 0.5, 0.56].entries()) {
    s = e.update(analyzeSpatial([det("person", cx, 0.62)]), 160 + 80 * i);
  }
  assert.equal(s[0].inPath, true, "oscilar não pode zerar 'está no meu caminho'");

  // Saiu de verdade: três quadros seguidos fora do corredor.
  for (const [i, cx] of [0.80, 0.84, 0.88].entries()) {
    s = e.update(analyzeSpatial([det("person", cx, 0.62)]), 500 + 80 * i);
  }
  assert.equal(s[0].inPath, false, "saída sustentada precisa ser reconhecida");
});

test("o corredor é medido em metros, não em ângulo", () => {
  // O defeito que o teste de persona encontrou: `analyzeSpatial` decide "no
  // meu caminho" por posição na imagem, que é um cone. A ±0,20 da largura
  // correspondem ±12 graus — 42 cm a dois metros, 1,70 m a oito. Um poste a
  // um metro do ombro, oito metros à frente, caía dentro do "corredor".
  assert.equal(atravancaCorredor({ left: 0.42, right: 0.58, top: 0.3, bottom: 0.7 }, 2.0), true);

  // Mesma posição angular, oito metros: agora está a mais de um metro do lado.
  assert.equal(atravancaCorredor({ left: 0.60, right: 0.66, top: 0.45, bottom: 0.55 }, 8.0), false);

  // Sem distância, não há o que medir: quem chama cai na regra antiga.
  assert.equal(atravancaCorredor({ left: 0.4, right: 0.6, top: 0.3, bottom: 0.7 }, null), null);
});

// ------------------------------------------------------------
// O efeito de tudo junto: a cena sossega e o alerta não repete
// ------------------------------------------------------------

test("cena parada com tremor: a assinatura para de mudar", () => {
  // Sem estabilizador, `EstadoDaCena` nunca considera a cena estável, porque a
  // assinatura carrega direção e faixa. A narração, que foi feita para calar
  // quando nada muda, nunca chegava a calar.
  const tremor = [0.66, 0.64, 0.67, 0.63, 0.66, 0.65, 0.64, 0.66];
  const alturas = [0.30, 0.31, 0.29, 0.305, 0.30, 0.295, 0.31, 0.30];

  const cru = new EstadoDaCena();
  let mudancasCruas = 0;
  for (const [i, cx] of tremor.entries()) {
    if (cru.atualizar(analyzeSpatial([det("pole", cx, alturas[i])]), i * 100).mudou) mudancasCruas++;
  }

  const e = new EstabilizadorEspacial();
  const estavel = new EstadoDaCena();
  let mudancasEstaveis = 0;
  for (const [i, cx] of tremor.entries()) {
    const objs = e.update(analyzeSpatial([det("pole", cx, alturas[i])]), i * 100);
    if (estavel.atualizar(objs, i * 100).mudou) mudancasEstaveis++;
  }

  assert.ok(mudancasEstaveis < mudancasCruas,
    `estabilizado deveria mudar menos: ${mudancasEstaveis} contra ${mudancasCruas}`);
  assert.equal(mudancasEstaveis, 1, "só a primeira observação é novidade");
});

test("o poste na fronteira é anunciado UMA vez, não duas", () => {
  // O teste que resume o módulo. Mesma pessoa, parada, com a caixa derivando
  // de leve em volta da fronteira dos 0,65 — quatro quadros de um lado, quatro
  // do outro, quatro de volta. Nada se moveu de verdade.
  //
  // Sem histerese são duas chaves diferentes no freio de repetição
  // (`person|à frente` e `person|à direita`), cada uma com o próprio contador
  // e o próprio intervalo: a MESMA pessoa é anunciada duas vezes, uma de cada
  // lado. É isto que destrói a confiança na direção.
  const tremor = [0.63, 0.63, 0.63, 0.63, 0.67, 0.67, 0.67, 0.67, 0.63, 0.63, 0.63, 0.63];

  const falar = (usarEstabilizador) => {
    const alerts = new AlertEngine();
    const e = new EstabilizadorEspacial();
    const ditos = [];
    for (const [i, cx] of tremor.entries()) {
      const ts = i * 300;
      let objs = analyzeSpatial([det("person", cx, 0.62)]);
      if (usarEstabilizador) objs = e.update(objs, ts);
      const a = alerts.process(objs, ts);
      if (a) ditos.push(a.text);
    }
    return ditos;
  };

  const sem = falar(false);
  const com = falar(true);
  assert.ok(sem.length >= 2, `o defeito precisa existir sem a correção (saiu ${sem.length})`);
  assert.equal(com.length, 1, `com o estabilizador deveria falar uma vez (falou ${com.length}: ${com.join(" / ")})`);
});

test("o que realmente se aproxima continua sendo anunciado", () => {
  // A prova de que a histerese não cegou o app: um carro vindo de verdade,
  // fechando distância, tem de falar — e falar de novo ao mudar de faixa.
  const alerts = new AlertEngine();
  const e = new EstabilizadorEspacial();
  const ditos = [];
  // altura crescente = objeto chegando perto
  for (const [i, altura] of [0.10, 0.12, 0.16, 0.22, 0.32, 0.46, 0.62].entries()) {
    const ts = i * 400;
    const objs = e.update(analyzeSpatial([det("person", 0.5, altura)]), ts);
    const a = alerts.process(objs, ts);
    if (a) ditos.push(a.text);
  }
  assert.ok(ditos.length >= 1, "uma pessoa chegando tem de ser anunciada");
  assert.ok(ditos.some((t) => /pessoa/i.test(t)));
});

// ------------------------------------------------------------
// Mascaramento: o defeito mais grave que o simulador encontrou
// ------------------------------------------------------------

test("um obstáculo no caminho NÃO pode ser emudecido por outro da mesma classe", () => {
  // O CASO REAL, do cenário "quadra" do simulador. Numa calçada com
  // parquímetros ao longo do meio-fio, os de longe são lidos como "à frente":
  // a 20 m, um metro de desvio lateral dá menos de três graus. Eles chegavam
  // primeiro na lista de detecções e tomavam a chave `parking meter|à frente`,
  // que é inofensiva — longe, fora do caminho, prioridade BAIXA.
  //
  // Quando um poste PLANTADO NO MEIO DA CALÇADA aparecia, ele gerava a mesma
  // chave e era descartado antes de qualquer decisão. Medido: anunciado
  // normalmente quando sozinho na cena; NUNCA anunciado com os outros em
  // volta. Um obstáculo real emudecido por mobiliário urbano.
  const alerts = new AlertEngine();
  const e = new EstabilizadorEspacial();

  const ditos = [];
  for (let i = 0; i < 12; i++) {
    const ts = i * 400;
    const cena = [
      // longe e à frente, inofensivo — mas na mesma chave
      det("parking meter", 0.54, 0.06),
      // plantado no caminho, chegando perto: ESTE precisa falar
      det("parking meter", 0.50, 0.62),
    ];
    const a = alerts.process(e.update(analyzeSpatial(cena), ts), ts);
    if (a) ditos.push(a.text);
  }

  assert.ok(ditos.some((t) => /^Atenção/.test(t)),
    `o poste no caminho tem de gerar alerta de alta prioridade. Saiu: ${ditos.join(" / ") || "nada"}`);
});

test("empate de prioridade fica com o mais próximo", () => {
  const alerts = new AlertEngine();
  const e = new EstabilizadorEspacial();
  let ultimo = null;
  for (let i = 0; i < 6; i++) {
    const ts = i * 400;
    const cena = [det("car", 0.5, 0.20), det("car", 0.5, 0.42)];
    const a = alerts.process(e.update(analyzeSpatial(cena), ts), ts);
    if (a) ultimo = a;
  }
  assert.ok(ultimo, "alguma coisa tem de ser dita");
  // Caixa de 0,42 de altura ≈ 4 m; a de 0,20 ≈ 8 m. A fala tem de ser a do
  // mais próximo — se sair "oito metros", o longe tomou a chave do perto.
  assert.match(ultimo.text, /quatro metros/,
    `deveria falar do mais próximo (≈4 m), falou: ${ultimo.text}`);
  assert.doesNotMatch(ultimo.text, /oito metros/);
});
