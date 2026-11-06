import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const workflow = read(".github/workflows/pages.yml");
const copy = workflow.match(/^\s*cp (.+) _site\/\s*$/m);
assert.ok(copy, "El workflow debe declarar los archivos publicados en _site/");
const published = new Set(copy[1].trim().split(/\s+/));

// Recorre los módulos propios; las librerías vendorizadas se copian completas.
function appModules() {
  const pending = [...read("index.html").matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map((match) => match[1]);
  const modules = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (modules.has(path)) continue;
    modules.add(path);
    if (path.startsWith("vendor/")) continue;
    for (const match of read(path).matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)) {
      const dependency = new URL(match[1], new URL(path, root));
      pending.push(dependency.href.slice(root.href.length));
    }
  }
  return modules;
}

test("la publicación incluye todos los módulos que carga la aplicación", () => {
  assert.match(workflow, /cp -a vendor\/\. _site\/vendor\//);
  for (const path of appModules()) {
    if (!path.startsWith("vendor/")) {
      assert.ok(published.has(path), `Falta publicar ${path}`);
    }
  }
});

test("tras instalar el service worker, todos los módulos abren sin red", async () => {
  const handlers = new Map();
  const stored = new Map();
  const origin = new URL("https://simpla.example/app/sw.js");
  const cache = {
    async addAll(urls) {
      for (const url of urls) {
        const path = new URL(url).pathname.slice("/app/".length);
        const assetDirectory = /^(?:vendor|fonts|icons)\//.test(path);
        assert.ok(published.has(path) || assetDirectory, `El precaché requiere publicar ${path}`);
        stored.set(url, new Response(readFileSync(new URL(path, root))));
      }
    },
    async match(request) {
      return stored.get(typeof request === "string" ? request : request.url)?.clone();
    },
    async put(url, response) { stored.set(url, response); },
  };
  runInNewContext(read("sw.js"), {
    URL,
    Response,
    caches: { async open() { return cache; } },
    fetch: async () => { throw new Error("Sin conexión"); },
    self: {
      location: origin,
      addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() {},
    },
  });
  let installation;
  handlers.get("install")({ waitUntil(promise) { installation = promise; } });
  await installation;
  for (const path of appModules()) {
    const url = new URL(path, origin).href;
    let response;
    handlers.get("fetch")({
      request: { url, method: "GET", mode: "cors" },
      respondWith(promise) { response = promise; },
    });
    const result = await response;
    assert.equal(result.status, 200, `${path} no está disponible sin red`);
    assert.equal(await result.text(), read(path));
  }
});
