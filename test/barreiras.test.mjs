// Testes do registro de barreiras e da denúncia.
//
// Dois tipos de regra aqui, e eles puxam para lados opostos:
//   - a denúncia tem de ser FORTE o bastante para alguém agir;
//   - e HONESTA o bastante para não cair na primeira contestação.
// Boa parte dos testes guarda a segunda, porque é a que se perde primeiro
// quando alguém quer que o relatório pareça mais convincente.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TipoBarreira, BARREIRAS, Dificuldade, RegistroDeBarreiras,
  classificar, distanciaM, prioridade, textoDeDenuncia, pacoteDeDenuncia,
  manifestoDeTreino, RAIO_M,
} from "../barreiras.js";

const pos = (lat, lng, precisaoM = 8) => ({ lat, lng, precisaoM });
const T = (h, m = 0) => `2026-11-${String(10).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

// ------------------------------------------------------------
// Categorização
// ------------------------------------------------------------

test("os seis tipos da taxonomia existem e estão completos", () => {
  const tipos = Object.values(TipoBarreira);
  assert.equal(tipos.length, 6);
  for (const t of tipos) {
    const b = BARREIRAS[t];
    assert.ok(b, `${t} sem definição`);
    assert.ok(b.rotulo && b.descricao, `${t} sem rótulo ou descrição`);
    assert.ok(b.norma, `${t} sem referência normativa — sem norma não há denúncia`);
    assert.ok(b.responsavel, `${t} sem responsável provável`);
    assert.ok(b.gravidade >= 1 && b.gravidade <= 3, `${t} com gravidade fora de 1..3`);
  }
});

test("classificar leva o que o detector vê ao tipo da taxonomia", () => {
  assert.equal(classificar("buraco"), TipoBarreira.INFRA_DEGRADADA);
  assert.equal(classificar("bueiro aberto"), TipoBarreira.INFRA_DEGRADADA);
  assert.equal(classificar("tapume de obra"), TipoBarreira.OCUPACAO_IRREGULAR);
  assert.equal(classificar("piso tátil"), TipoBarreira.PISO_TATIL);
  assert.equal(classificar("degrau"), TipoBarreira.PAVIMENTO_IRREGULAR);
  assert.equal(classificar("BURACO"), TipoBarreira.INFRA_DEGRADADA, "não pode depender de caixa");
});

test("classe desconhecida NÃO vira denúncia", () => {
  // A regra mais importante deste módulo. Mandar ao Ministério Público uma
  // acusação que o app não sabe sustentar queima a credibilidade de todas as
  // outras — inclusive das corretas.
  assert.equal(classificar("guarda-chuva"), null);
  assert.equal(classificar(null), null);

  const r = new RegistroDeBarreiras();
  assert.equal(r.anotar({ classe: "guarda-chuva", posicao: pos(-15.6, -56.09) }), null);
  assert.equal(r.ocorrencias.length, 0);
});

// ------------------------------------------------------------
// Agrupamento por local
// ------------------------------------------------------------

test("a distância entre leituras próximas bate com a realidade", () => {
  // ~10 m ao norte
  assert.ok(Math.abs(distanciaM({ lat: -15.6, lng: -56.09 }, { lat: -15.60009, lng: -56.09 }) - 10) < 1);
  // ~200 m
  assert.ok(Math.abs(distanciaM({ lat: -15.6, lng: -56.09 }, { lat: -15.6018, lng: -56.09 }) - 200) < 5);
  assert.equal(distanciaM(null, { lat: -15.6, lng: -56.09 }), Infinity);
});

test("o agrupamento não tem fronteira: a posição absoluta não decide nada", () => {
  // O defeito que matou a versão em grade: dois registros a poucos metros
  // caíam em células diferentes quando calhavam de estar nos dois lados de uma
  // fronteira. Aqui a mesma sequência é testada em vinte pontos da cidade — se
  // houvesse fronteira, algum deles a encontraria.
  for (let k = 0; k < 20; k++) {
    const base = -15.6 + k * 0.000037;
    const r = new RegistroDeBarreiras();
    for (let i = 0; i < 5; i++) {
      r.anotar({ classe: "buraco", posicao: pos(base + i * 0.00002, -56.09 + k * 0.000041), quando: T(8 + i) });
    }
    assert.equal(r.porLocal().length, 1, `base ${base} partiu o mesmo buraco em vários`);
  }
});

test("cinco registros no mesmo buraco viram UM caso com cinco ocorrências", () => {
  // É assim que a recorrência aparece no painel: "Denúncias no mesmo local: 5".
  const r = new RegistroDeBarreiras();
  for (let i = 0; i < 5; i++) {
    r.anotar({
      classe: "buraco", posicao: pos(-15.6000 + i * 0.00002, -56.0900),
      endereco: "Rua Barão de Melgaço, 200", dificuldade: Dificuldade.DESVIEI,
      quando: T(8 + i),
    });
  }
  const locais = r.porLocal();
  assert.equal(locais.length, 1, "o mesmo buraco não pode virar cinco buracos");
  assert.equal(locais[0].ocorrencias, 5);
  assert.equal(locais[0].primeira, T(8));
  assert.equal(locais[0].ultima, T(12));
});

test("tipos diferentes no mesmo ponto são casos diferentes", () => {
  // Um tapume e um bueiro aberto na mesma esquina têm responsáveis diferentes
  // e viram ofícios diferentes.
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(8) });
  r.anotar({ classe: "tapume de obra", posicao: pos(-15.6, -56.09), quando: T(9) });
  assert.equal(r.porLocal().length, 2);
});

// ------------------------------------------------------------
// Prioridade: quem decide a ordem é o dano
// ------------------------------------------------------------

test("uma barreira que derrubou alguém passa à frente de uma mais frequente", () => {
  const caiu = { tipo: TipoBarreira.PAVIMENTO_IRREGULAR, ocorrencias: 1, dificuldades: [Dificuldade.CAI] };
  const muitas = {
    tipo: TipoBarreira.PAVIMENTO_IRREGULAR, ocorrencias: 4,
    dificuldades: [Dificuldade.PERCEBI, Dificuldade.PERCEBI, Dificuldade.PERCEBI, Dificuldade.PERCEBI],
  };
  assert.ok(prioridade(caiu) > prioridade(muitas),
    "uma queda tem de pesar mais do que quatro desvios tranquilos");
});

test("a recorrência conta, mas o décimo caso não vale dez vezes o primeiro", () => {
  const um = { tipo: TipoBarreira.INFRA_DEGRADADA, ocorrencias: 1, dificuldades: [] };
  const dez = { tipo: TipoBarreira.INFRA_DEGRADADA, ocorrencias: 10, dificuldades: [] };
  assert.ok(prioridade(dez) > prioridade(um));
  assert.ok(prioridade(dez) < prioridade(um) * 10);
});

test("os casos saem ordenados por prioridade", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "piso tátil", posicao: pos(-15.70, -56.10), dificuldade: Dificuldade.PERCEBI, quando: T(8) });
  r.anotar({ classe: "bueiro aberto", posicao: pos(-15.60, -56.09), dificuldade: Dificuldade.CAI, quando: T(9) });
  const locais = r.porLocal();
  assert.equal(locais[0].tipo, TipoBarreira.INFRA_DEGRADADA, "o bueiro que derrubou vem primeiro");
});

// ------------------------------------------------------------
// A dificuldade da pessoa: o dado que nenhum sensor dá
// ------------------------------------------------------------

test("a denúncia conta o que aconteceu com a pessoa, não só o que havia", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({
    classe: "tapume de obra", posicao: pos(-15.6, -56.09),
    endereco: "Av. Getúlio Vargas, 1400", dificuldade: Dificuldade.FUI_PARA_RUA,
    nota: "O tapume tomou a calçada inteira, tive que andar na pista.", quando: T(10),
  });
  const texto = textoDeDenuncia(r.porLocal()[0]);
  assert.match(texto, /Ocupação irregular/);
  assert.match(texto, /Av\. Getúlio Vargas, 1400/);
  assert.match(texto, /precisei descer para a rua/);
  assert.match(texto, /tapume tomou a calçada inteira/);
  assert.match(texto, /NBR 9050/, "sem norma a denúncia não tem onde se apoiar");
});

// ------------------------------------------------------------
// Honestidade do documento
// ------------------------------------------------------------

test("a denúncia declara que a classificação é automática e o GPS é aproximado", () => {
  // Sem estas duas frases, a primeira contestação derruba o conjunto inteiro —
  // e com ele as denúncias que estavam certas.
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(10) });
  const texto = textoDeDenuncia(r.porLocal()[0]);
  assert.match(texto, /classificação do tipo de barreira[\s\S]*automática/);
  assert.match(texto, /erro típico de 5 a 20 metros/);
  assert.match(texto, /verificação em campo/);
});

test("sem foto, a denúncia diz que não há foto — não omite", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(10) });
  assert.match(textoDeDenuncia(r.porLocal()[0]), /Nenhuma imagem anexada/);
});

test("o pacote nunca carrega imagem embutida, só a referência", () => {
  // A foto vai à parte e por escolha. Um pacote que carrega a imagem dentro
  // vaza por acidente no primeiro encaminhamento de e-mail.
  const r = new RegistroDeBarreiras();
  r.anotar({
    classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(10),
    evidencia: { id: "foto-1" },
  });
  const p = pacoteDeDenuncia(r, { gerado: T(12) });
  const json = JSON.stringify(p);
  assert.match(json, /foto-1/);
  assert.doesNotMatch(json, /data:image|base64/, "imagem embutida no pacote é vazamento");
});

test("o registro não guarda nada que identifique a pessoa", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({
    classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(10),
    dificuldade: Dificuldade.TROPECEI,
  });
  const campos = Object.keys(r.ocorrencias[0]);
  for (const proibido of ["nome", "usuario", "email", "telefone", "dispositivo", "ua"]) {
    assert.ok(!campos.includes(proibido), `o registro não pode ter ${proibido}`);
  }
});

// ------------------------------------------------------------
// Relatório e treino
// ------------------------------------------------------------

test("o relatório conta por tipo e respeita o período", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "buraco", posicao: pos(-15.60, -56.09), quando: T(8) });
  r.anotar({ classe: "buraco", posicao: pos(-15.70, -56.10), quando: T(9) });
  r.anotar({ classe: "piso tátil", posicao: pos(-15.80, -56.11), quando: T(20) });

  const tudo = r.relatorio();
  assert.equal(tudo.totalOcorrencias, 3);
  assert.equal(tudo.totalLocais, 3);
  assert.equal(tudo.porTipo[TipoBarreira.INFRA_DEGRADADA], 2);

  const manha = r.relatorio({ de: T(7), ate: T(10) });
  assert.equal(manha.totalOcorrencias, 2);
  assert.equal(manha.porTipo[TipoBarreira.PISO_TATIL], undefined);
});

test("o manifesto de treino divide por LOCAL, não por foto", () => {
  // Sem isso o treino vira decoreba: trinta fotos do mesmo buraco espalhadas
  // entre treino e validação dão mAP alto e modelo inútil. Ver
  // treino/classes.yaml, chave `divisao.por: local`.
  const r = new RegistroDeBarreiras();
  for (let i = 0; i < 4; i++) {
    r.anotar({
      classe: "buraco", posicao: pos(-15.6000 + i * 0.00001, -56.09), quando: T(8 + i),
      evidencia: { id: `foto-${i}` },
    });
  }
  r.anotar({ classe: "degrau", posicao: pos(-15.70, -56.10), quando: T(14), evidencia: { id: "foto-x" } });

  const m = manifestoDeTreino(r);
  assert.equal(m.total, 5);
  assert.equal(m.locais, 2, "quatro fotos do mesmo buraco são UM local");
  assert.equal(m.porClasse.buraco, 4);
});

test("só entra no treino o que tem evidência consentida", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(8) });
  r.anotar({ classe: "buraco", posicao: pos(-15.7, -56.10), quando: T(9), evidencia: { id: "f1" } });
  assert.equal(manifestoDeTreino(r).total, 1);
});

test("serializar e carregar preservam o registro", () => {
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "buraco", posicao: pos(-15.6, -56.09), quando: T(8), dificuldade: Dificuldade.CAI });
  const volta = RegistroDeBarreiras.carregar(r.serializar());
  assert.deepEqual(volta.ocorrencias, r.ocorrencias);
  assert.equal(volta.porLocal()[0].ocorrencias, 1);
});

test("sem GPS o registro ainda vale, agrupado à parte", () => {
  // Dentro de uma galeria, num corredor coberto, o GPS não responde. A
  // barreira continua existindo e o relato continua valendo.
  const r = new RegistroDeBarreiras();
  r.anotar({ classe: "degrau", posicao: null, quando: T(8), dificuldade: Dificuldade.TROPECEI });
  const l = r.porLocal();
  assert.equal(l.length, 1);
  assert.equal(l[0].lat, null, "sem GPS não se inventa coordenada");
  assert.match(l[0].local, /^sem-gps:/);
  const texto = textoDeDenuncia(l[0]);
  assert.match(texto, /endereço não identificado/);
  assert.doesNotMatch(texto, /Coordenadas/, "sem coordenada, não imprime coordenada");
});
