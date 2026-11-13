#!/usr/bin/env node
// Responsividade + SEO básico das telas públicas da Tucaí, do celular à TV, nos temas claro e escuro.
// SOMENTE LEITURA e SEM rede externa: gera um build com Supabase falso (127.0.0.1:9), serve localmente e bloqueia
// qualquer requisição para fora de localhost. Não precisa de login nem de dados reais.
// Uso (na raiz do repositório):
//   node .claude/skills/tucai-release-audit/scripts/responsive-audit.cjs [--out pasta] [--skip-build]
// Saída: capturas PNG por rota/largura/tema + resultado.json; código 1 se houver rolagem horizontal ou falta de título/h1.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const out = path.resolve(
  arg("--out") || path.join("release-audit", "responsivo"),
);
const dist = path.resolve(
  arg("--dist") || path.join(require("node:os").tmpdir(), "tucai-audit-dist"),
);
const ROUTES = [
  "/",
  "/restaurantes",
  "/lojas",
  "/servicos",
  "/vagas",
  "/entrar",
  "/entregadores",
  "/cadastrar-negocio",
  "/privacidade",
  "/termos",
];
const WIDTHS = [
  [360, 740, "celular-pequeno"],
  [390, 844, "celular"],
  [820, 1180, "tablet"],
  [1366, 768, "notebook"],
  [1920, 1080, "desktop"],
  [2560, 1440, "tv"],
];

if (!process.argv.includes("--skip-build")) {
  console.log("> build com backend falso (sem chamadas ao Supabase)");
  execFileSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "http://127.0.0.1:9",
      VITE_SUPABASE_ANON_KEY: "auditoria-local",
    },
  });
}
fs.mkdirSync(out, { recursive: true });
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  let p = path.join(dist, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(dist) || !fs.existsSync(p) || fs.statSync(p).isDirectory())
    p = path.join(dist, "index.html");
  res.writeHead(200, {
    "content-type": types[path.extname(p)] || "application/octet-stream",
  });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const results = [];
  for (const theme of ["light", "dark"]) {
    for (const [w, h, label] of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        colorScheme: theme,
      });
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("tucai:theme", t);
        } catch {
          /* sem armazenamento */
        }
      }, theme);
      const page = await ctx.newPage();
      // nada sai do computador: backend falso responde vazio, o resto é bloqueado
      await page.route("**/*", (route) => {
        const u = new URL(route.request().url());
        if (
          u.hostname === "127.0.0.1" &&
          u.port === String(server.address().port)
        )
          return route.continue();
        if (u.hostname === "127.0.0.1")
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "[]",
          });
        return route.abort();
      });
      for (const r of ROUTES) {
        const errors = [];
        const onErr = (m) => {
          if (
            m.type() === "error" &&
            !/Failed to load resource|net::ERR|127\.0\.0\.1:9/.test(m.text())
          )
            errors.push(m.text().slice(0, 200));
        };
        page.on("console", onErr);
        page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
        await page.goto(base + r, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        const info = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          title: document.title,
          description:
            document
              .querySelector('meta[name="description"]')
              ?.getAttribute("content") ?? "",
          h1: document.querySelectorAll("h1").length,
          smallTargets: [...document.querySelectorAll("a,button")].filter(
            (el) => {
              const b = el.getBoundingClientRect();
              return (
                b.width > 0 && b.height > 0 && (b.height < 24 || b.width < 24)
              );
            },
          ).length,
        }));
        page.off("console", onErr);
        const problems = [];
        if (info.overflow > 1)
          problems.push(`rolagem horizontal de ${info.overflow}px`);
        if (!info.title || info.title.length < 10)
          problems.push("título ausente/curto");
        if (info.description.length < 50)
          problems.push("meta description curta");
        if (info.h1 === 0) problems.push("sem <h1>");
        if (errors.length) problems.push(`${errors.length} erro(s) no console`);
        const shot = `${theme}-${label}-${r === "/" ? "inicio" : r.slice(1).replace(/\//g, "_")}.png`;
        if (
          label === "celular" ||
          label === "notebook" ||
          label === "tv" ||
          problems.length
        )
          await page.screenshot({ path: path.join(out, shot) });
        results.push({
          theme,
          width: w,
          label,
          route: r,
          ...info,
          errors,
          problems,
          screenshot: shot,
        });
        if (problems.length)
          console.log(
            `[${theme} ${label} ${w}px] ${r}: ${problems.join("; ")}`,
          );
      }
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  fs.writeFileSync(
    path.join(out, "resultado.json"),
    JSON.stringify(results, null, 2),
  );
  const bad = results.filter((x) => x.overflow > 1 || x.h1 === 0 || !x.title);
  console.log(
    `\n${results.length} verificações; ${bad.length} com problema de layout/estrutura; capturas em ${out}`,
  );
  console.log(
    "Observação: o backend é falso, então listas aparecem vazias ou com aviso de erro de conexão; o objetivo é o layout.",
  );
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(2);
});
