// Projeto Íris — cache para funcionar sem internet depois do primeiro uso.
// Arquivos do app: rede primeiro (atualiza fácil durante os testes), cache se offline.
// Modelos, bibliotecas e fonte: cache primeiro (são versões fixas e pesadas).
const VERSION = "iris-0.8.2";
const SHELL = [
  "./", "./index.html", "./app.js", "./core.js", "./vision.js", "./ocr.js", "./diario.js",
  "./fala.js", "./navegacao.js", "./rotas.js", "./posicao.js", "./aberto.js",
  "./nuvem.js", "./integracao.js",
  "./manifest.webmanifest",
  "./icons/iris-logo.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
];
// Rota, geocodificação e descrição na nuvem NÃO entram em cache de propósito:
// uma rota velha leva a pessoa para o lugar errado, e é pior do que não ter rota.
// Por não estarem em nenhuma das duas listas, essas requisições passam direto.
const PINNED_HOSTS = [
  "cdn.jsdelivr.net",        // MediaPipe tasks-vision e transformers.js
  "storage.googleapis.com",  // EfficientDet-Lite0
  "huggingface.co",          // SegFormer-B0 / ADE20K
  "tessdata.projectnaptha.com", // dados do portugues para o OCR
  "cdn-lfs.huggingface.co",  // pesos do modelo (LFS)
  "cdn-lfs-us-1.hf.co",
  "fonts.googleapis.com", "fonts.gstatic.com",
];

self.addEventListener("install", (event) => {
  // addAll falha inteiro se um arquivo faltar; aqui cada um é melhor-esforço
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (PINNED_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) ?? (await cache.match("./index.html")) ?? Response.error();
  }
}
