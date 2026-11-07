// Lugares familiares — o Íris aprende os lugares da pessoa.
//
// O GPS diz "Rua X, perto do 200". Não diz "a sua cozinha", "o portão de
// casa", "a sala de espera do posto". Dentro de casa ou de um prédio o GPS nem
// funciona. Para esses lugares, quem melhor reconhece é a própria câmera,
// treinada pela própria pessoa.
//
// Como aprende (aprendizagem de poucos exemplos, toda no aparelho):
//
//   1. A pessoa aponta a câmera e diz "memorize como cozinha". O app tira
//      alguns quadros, de ângulos ligeiramente diferentes.
//   2. Cada quadro vira um vetor de características (embedding) por uma rede
//      já treinada em milhões de imagens — MobileNet-V3 via MediaPipe. A rede
//      não sabe o que é "cozinha"; ela sabe dizer quando duas imagens se
//      parecem.
//   3. Para reconhecer, o quadro atual vira vetor e é comparado com os
//      exemplos guardados (vizinhos mais próximos, similaridade de cosseno).
//      O GPS, quando existe, descarta lugares a quilômetros dali.
//
// Por que assim e não treinando uma rede: com 5 a 20 fotos por lugar não há
// treino que preste, e treino no celular gasta bateria e memória. Vizinhos
// mais próximos sobre um embedding pronto aprendem na hora, com uma foto,
// e esquecer é apagar uma linha.
//
// Privacidade: o que se guarda é o vetor, não a foto. Do vetor não se
// reconstrói a imagem. Nada sai do aparelho.
//
// Este arquivo é lógica pura (sem navegador). O embedder e o armazenamento
// entram por injeção — ver `embedder.js` e `ArmazemIndexedDB` abaixo.

import { distanciaM } from "./navegacao.js";

/** Abaixo disto, não arriscamos dizer o nome do lugar. Calibrar no piloto. */
export const LIMIAR_SIMILARIDADE = 0.78;
/** O primeiro colocado precisa ganhar do segundo por esta folga. */
export const MARGEM_MINIMA = 0.03;
export const MAX_EXEMPLOS_POR_LUGAR = 24;
export const K_VIZINHOS = 3;
/** Lugar memorizado com GPS a mais disto não concorre. */
export const RAIO_GPS_M = 300;

export function normalizar(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosseno de dois vetores já normalizados. */
export function cosseno(a, b) {
  if (a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Nome normalizado para comparar "Cozinha" com "a cozinha". */
export function chaveDoNome(nome) {
  return String(nome ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^((a|o|as|os|minha|meu|minhas|meus|da|do|para|pra)\s+)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Vetores viajam como base64 de Float32: um terço do tamanho do JSON de números.
export function vetorParaTexto(v) {
  const bytes = new Uint8Array(Float32Array.from(v).buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function textoParaVetor(t) {
  const s = atob(t);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class MemoriaDeLugares {
  /**
   * armazem: { carregar(): Promise<obj|null>, salvar(obj): Promise<void> }.
   * Sem armazém, vive só na memória (testes).
   */
  constructor({
    armazem = null, limiar = LIMIAR_SIMILARIDADE, margem = MARGEM_MINIMA, k = K_VIZINHOS,
  } = {}) {
    this.armazem = armazem;
    this.limiar = limiar;
    this.margem = margem;
    this.k = k;
    this.lugares = new Map();   // chave -> { nome, exemplos: Float32Array[], posicao }
  }

  get tamanho() { return this.lugares.size; }
  nomes() { return [...this.lugares.values()].map((l) => l.nome); }

  async carregar() {
    const dados = await this.armazem?.carregar?.();
    this.lugares.clear();
    for (const l of dados?.lugares ?? []) {
      this.lugares.set(chaveDoNome(l.nome), {
        nome: l.nome,
        posicao: l.posicao ?? null,
        exemplos: (l.exemplos ?? []).map(textoParaVetor),
      });
    }
    return this.tamanho;
  }

  async #persistir() {
    if (!this.armazem) return;
    await this.armazem.salvar({
      versao: 1,
      lugares: [...this.lugares.values()].map((l) => ({
        nome: l.nome, posicao: l.posicao, exemplos: l.exemplos.map(vetorParaTexto),
      })),
    });
  }

  /**
   * Ensina um lugar. `vetores` é um ou mais embeddings do mesmo lugar.
   * `posicao` ({lat,lng,precisaoM}) é opcional: dentro de casa o GPS mente,
   * e nesse caso é melhor não guardar do que guardar errado.
   */
  async ensinar(nome, vetores, posicao = null) {
    const chave = chaveDoNome(nome);
    if (!chave) throw new Error("O lugar precisa de um nome.");
    const lista = (Array.isArray(vetores) ? vetores : [vetores]).map(normalizar);
    if (!lista.length) throw new Error("Nenhum quadro para aprender.");
    const atual = this.lugares.get(chave) ?? { nome: String(nome).trim(), exemplos: [], posicao: null };
    atual.exemplos.push(...lista);
    // Fila: os exemplos mais novos ficam. Lugar muda (móvel arrastado, obra).
    if (atual.exemplos.length > MAX_EXEMPLOS_POR_LUGAR) {
      atual.exemplos.splice(0, atual.exemplos.length - MAX_EXEMPLOS_POR_LUGAR);
    }
    if (posicao && Number.isFinite(posicao.lat) && (posicao.precisaoM ?? 0) <= 40) {
      atual.posicao = { lat: posicao.lat, lng: posicao.lng };
    }
    this.lugares.set(chave, atual);
    await this.#persistir();
    return atual.exemplos.length;
  }

  async esquecer(nome) {
    const ok = this.lugares.delete(chaveDoNome(nome));
    if (ok) await this.#persistir();
    return ok;
  }

  async esquecerTodos() {
    this.lugares.clear();
    await this.#persistir();
  }

  /**
   * Pontua cada lugar: média dos k exemplos mais parecidos. Média dos k
   * melhores, e não o melhor sozinho, para um quadro de sorte não decidir.
   */
  pontuar(vetor, posicao = null) {
    const q = normalizar(vetor);
    const out = [];
    for (const l of this.lugares.values()) {
      if (posicao && l.posicao && Number.isFinite(posicao.lat)
          && distanciaM(posicao, l.posicao) > RAIO_GPS_M + (posicao.precisaoM ?? 0)) continue;
      const sims = l.exemplos.map((e) => cosseno(q, e)).sort((a, b) => b - a);
      const k = Math.min(this.k, sims.length);
      if (!k) continue;
      const media = sims.slice(0, k).reduce((s, x) => s + x, 0) / k;
      out.push({ nome: l.nome, similaridade: media });
    }
    return out.sort((a, b) => b.similaridade - a.similaridade);
  }

  /**
   * Reconhece, ou devolve null. Só diz um nome quando passa do limiar E ganha
   * do segundo colocado com folga: "parece a cozinha" dito na sala faz a
   * pessoa desconfiar do app inteiro.
   */
  reconhecer(vetor, posicao = null) {
    const p = this.pontuar(vetor, posicao);
    if (!p.length || p[0].similaridade < this.limiar) return null;
    const margem = p.length > 1 ? p[0].similaridade - p[1].similaridade : 1;
    if (margem < this.margem) return null;
    return { ...p[0], margem };
  }

  /**
   * Agrega vários quadros (a pessoa girando o celular devagar): vota por
   * maioria entre os quadros reconhecidos.
   */
  reconhecerVarios(vetores, posicao = null) {
    const votos = new Map();
    for (const v of vetores) {
      const r = this.reconhecer(v, posicao);
      if (!r) continue;
      const atual = votos.get(r.nome) ?? { nome: r.nome, n: 0, soma: 0 };
      atual.n += 1; atual.soma += r.similaridade;
      votos.set(r.nome, atual);
    }
    const melhor = [...votos.values()].sort((a, b) => b.n - a.n || b.soma - a.soma)[0];
    if (!melhor || melhor.n < Math.ceil(vetores.length / 2)) return null;
    return { nome: melhor.nome, similaridade: melhor.soma / melhor.n, votos: melhor.n };
  }

  /** Como provedor de lugares: "ir para casa" vira destino se "casa" tem GPS. */
  comoProvedor() {
    return {
      nome: "lugares-familiares",
      buscar: async (texto) => {
        const l = this.lugares.get(chaveDoNome(texto));
        if (!l?.posicao) return [];
        return [{ nome: l.nome, lat: l.posicao.lat, lng: l.posicao.lng }];
      },
    };
  }
}

/** Armazém em IndexedDB: cabe muito mais que o localStorage e não trava a página. */
export class ArmazemIndexedDB {
  constructor(banco = "iris-lugares", loja = "memoria") {
    this.banco = banco;
    this.loja = loja;
  }

  #abrir() {
    return new Promise((ok, falha) => {
      const req = indexedDB.open(this.banco, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.loja);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(req.error);
    });
  }

  async carregar() {
    try {
      const db = await this.#abrir();
      return await new Promise((ok, falha) => {
        const r = db.transaction(this.loja).objectStore(this.loja).get("dados");
        r.onsuccess = () => ok(r.result ?? null);
        r.onerror = () => falha(r.error);
      });
    } catch { return null; }
  }

  async salvar(obj) {
    const db = await this.#abrir();
    await new Promise((ok, falha) => {
      const tx = db.transaction(this.loja, "readwrite");
      tx.objectStore(this.loja).put(obj, "dados");
      tx.oncomplete = () => ok();
      tx.onerror = () => falha(tx.error);
    });
  }
}
