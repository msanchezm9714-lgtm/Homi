/* Homi · sirve las páginas con sus metas (Open Graph por depa), la configuración pública
   desde variables de entorno, la analítica, el 404 real, robots.txt y sitemap.xml.
   vercel.json reescribe /, /depa, /proyecto, /aviso-privacidad, /admin, /404, /robots.txt y /sitemap.xml hacia aquí. */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const env = k => (process.env[k] || "").trim();
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
let CAT = null;
const catalog = () => CAT || (CAT = JSON.parse(read("catalogo.json")));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cur) => "$" + Math.round(n).toLocaleString("en-US") + " " + cur;

const TPL = { index: "_index.html", depa: "_depa.html", proyecto: "_proyecto.html", "aviso-privacidad": "_aviso-privacidad.html", admin: "_admin.html", 404: "404.html" };
const TXT = {
  es: {
    index: ["Homi | Departamentos en venta en Playa del Carmen", "Desliza, descubre y guarda departamentos en venta en Playa del Carmen. Precios, fotos y un asesor que te acompaña."],
    "aviso-privacidad": ["Aviso de privacidad | Homi", "Cómo Homi recaba, usa y protege tus datos personales."],
    admin: ["Leads | Homi", ""], 404: ["Página no encontrada | Homi", "Este departamento ya no está disponible."],
    depaDesc: (d, x, p) => `${d.rec} recámaras, ${d.banos} baños${d.m2 ? `, ${d.m2} m²` : ""}. ${x.entrega}. Desde ${money(d.precio, d.moneda)} en ${p.nombre}, Playa del Carmen.`,
    pjTitle: (d, p) => `${p.nombre}: unidades, precios y amenidades | Homi`
  },
  en: {
    index: ["Homi | Apartments for sale in Playa del Carmen", "Swipe, discover and save apartments for sale in Playa del Carmen. Prices, photos and an advisor by your side."],
    "aviso-privacidad": ["Privacy notice | Homi", "How Homi collects, uses and protects your personal data."],
    admin: ["Leads | Homi", ""], 404: ["Page not found | Homi", "This listing is no longer available."],
    depaDesc: (d, x, p) => `${d.rec} bedrooms, ${d.banos} bathrooms${d.m2 ? `, ${d.m2} m²` : ""}. ${x.entrega}. From ${money(d.precio, d.moneda)} at ${p.nombre}, Playa del Carmen.`,
    pjTitle: (d, p) => `${p.nombre}: units, pricing and amenities | Homi`
  }
};

function siteUrl(req) {
  const s = env("SITE_URL");
  if (s) return s.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${req.headers["x-forwarded-proto"] || "https"}://${host}`;
}

function analytics() {
  let h = "";
  const pd = env("PLAUSIBLE_DOMAIN"), px = env("META_PIXEL_ID").replace(/\D/g, "");
  if (pd) h += `<script defer data-domain="${esc(pd)}" src="${esc(env("PLAUSIBLE_SRC") || "https://plausible.io/js/script.js")}"></script>` +
    `<script>window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}</script>`;
  if (px) h += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${px}');fbq('track','PageView');</script>`;
  return h;
}

function head({ page, lang, site, title, desc, canonPath, image, noindex, cfgExtra }) {
  const q = lang === "en" ? (canonPath.includes("?") ? "&" : "?") + "lang=en" : "";
  const canon = site + canonPath + q, alt = l => site + canonPath + (l === "en" ? (canonPath.includes("?") ? "&" : "?") + "lang=en" : "");
  const cfg = Object.assign({ site, wa: env("OPERATOR_WHATSAPP").replace(/\D/g, ""), pixel: env("META_PIXEL_ID"), plausible: env("PLAUSIBLE_DOMAIN"),
    clean: true, sw: true, lang }, cfgExtra || {});
  return [
    `<meta name="description" content="${esc(desc)}">`,
    noindex ? `<meta name="robots" content="noindex, nofollow">` : `<link rel="canonical" href="${esc(canon)}">`,
    noindex ? "" : `<link rel="alternate" hreflang="es" href="${esc(alt("es"))}"><link rel="alternate" hreflang="en" href="${esc(alt("en"))}"><link rel="alternate" hreflang="x-default" href="${esc(alt("es"))}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="Homi">`,
    `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(title)}">`,
    `<meta property="og:locale" content="${lang === "en" ? "en_US" : "es_MX"}"><meta property="og:locale:alternate" content="${lang === "en" ? "es_MX" : "en_US"}">`,
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">`,
    `<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`,
    `<script>window.HOMI_CFG=${JSON.stringify(cfg).replace(/</g, "\\u003c")};</script>`,
    page === "admin" || page === "404" ? "" : analytics()
  ].join("\n");
}

function render(tplFile, lang, title, headHtml) {
  let html = read(tplFile);
  html = html.replace(/<html lang="[a-z]+"/, `<html lang="${lang}"`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description"[^>]*>\n?/g, "");
  return html.replace("</head>", headHtml + "\n</head>");
}

function privacyFill(html) {
  const keys = ["RESPONSABLE", "DOMICILIO", "EMAIL_PRIVACIDAD", "TELEFONO", "ACTUALIZACION"];
  keys.forEach(k => { const v = env("PRIVACY_" + k); if (v) html = html.split(`[[${k}]]`).join(esc(v)); });
  return html;
}

function sitemap(site) {
  const c = catalog(), urls = ["/", "/aviso-privacidad"];
  c.depas.forEach(d => { urls.push(`/depa?id=${d.id}`, `/proyecto?id=${d.id}`); });
  const e = u => esc(site + u), en = u => esc(site + u + (u.includes("?") ? "&" : "?") + "lang=en");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    urls.map(u => `<url><loc>${e(u)}</loc><xhtml:link rel="alternate" hreflang="es" href="${e(u)}"/><xhtml:link rel="alternate" hreflang="en" href="${en(u)}"/></url>`).join("\n") + "\n</urlset>\n";
}

module.exports = (req, res) => {
  const url = new URL(req.url, "http://x");
  const q = Object.assign({}, req.query || {}, Object.fromEntries(url.searchParams));
  const page = q.p || "index", site = siteUrl(req), lang = q.lang === "en" ? "en" : "es", T = TXT[lang];
  const send = (status, type, body, cache) => {
    res.statusCode = status;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", cache || "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    res.end(body);
  };
  try {
    if (page === "robots") return send(200, "text/plain; charset=utf-8", `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${site}/sitemap.xml\n`);
    if (page === "sitemap") return send(200, "application/xml; charset=utf-8", sitemap(site));

    const notFound = () => send(404, "text/html; charset=utf-8",
      render(TPL[404], lang, T[404][0], head({ page: "404", lang, site, title: T[404][0], desc: T[404][1], canonPath: "/404", image: `${site}/og-image.jpg`, noindex: true })));

    if (page === "depa" || page === "proyecto") {
      if (!q.id) { res.statusCode = 302; res.setHeader("Location", lang === "en" ? "/?lang=en" : "/"); return res.end(); }
      const c = catalog(), d = c.depas.find(x => x.id === q.id);
      if (!d) return notFound();
      const p = c.proyectos[d.proyecto], x = d[lang];
      const title = page === "depa" ? `${d.nombre}, ${p.nombre} · ${money(d.precio, d.moneda)} | Homi` : T.pjTitle(d, p);
      const desc = T.depaDesc(d, x, p);
      return send(200, "text/html; charset=utf-8", render(TPL[page], lang, title,
        head({ page, lang, site, title, desc, canonPath: `/${page}?id=${encodeURIComponent(d.id)}`, image: `${site}/og-${encodeURIComponent(d.id)}.jpg` })));
    }
    if (page === "404") return notFound();
    if (!TPL[page]) return notFound();

    const [title, desc] = T[page];
    const extra = page === "admin" ? { supabase: { url: env("SUPABASE_URL"), anon: env("SUPABASE_ANON_KEY") }, sw: false } : null;
    let html = render(TPL[page], lang, title, head({ page, lang, site, title, desc, canonPath: page === "index" ? "/" : "/" + page,
      image: `${site}/og-image.jpg`, noindex: page === "admin", cfgExtra: extra }));
    if (page === "aviso-privacidad") html = privacyFill(html);
    return send(200, "text/html; charset=utf-8", html, page === "admin" ? "private, no-store" : undefined);
  } catch (e) {
    console.error("page error", e);
    return send(500, "text/plain; charset=utf-8", "Error", "no-store");
  }
};
