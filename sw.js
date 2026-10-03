// Examenvault service worker (offline modus), opzet uit #9.
// VERSIE en SCHIL worden bij elke build ingevuld door scripts/pwa_na_build.py.
//
// Vier caches:
// - examenvault-vendor-v1   CDN-bestanden met vaste versies (KaTeX, d3, pixi, Mermaid, fonts) en
//                           zelf gehoste kopieën daarvan. Blijft bij een deploy staan; alleen bij een
//                           bewuste versieverhoging (VENDOR hieronder ophogen) wordt hij gewist.
// - examenvault-assets      eigen bestanden met een hash in de naam (index-*.css, component-*.css,
//                           static/scripts/*-<hash>.js, ...). Blijft bij een deploy staan, zodat een
//                           pagina met oude hashes (bv. uit de HTTP-cache) nog werkt; opruimen op aantal.
// - examenvault-paginas     HTML, contentIndex.json en de zoekindex: eerst het netwerk (met time-out),
//                           dan de cache. Blijft bij een deploy staan; zo werken eerder bezochte
//                           pagina's offline ook na een deploy.
// - examenvault-precache-<versie>  / en /offline.html; per build vervangen. De rest van de "schil"
//                           (CSS en JS van /, manifest, iconen, kleine index) gaat naar de blijvende
//                           caches, zodat de offline-startpagina opmaak heeft.
//
// Noodstop: pwa/sw-noodstop.js (zie de uitleg bovenaan dat bestand).
const VERSIE = "20261004-000949-238e48e"
const SCHIL = ["/", "/offline.html", "/manifest.webmanifest", "/icoon-192.png", "/static/icon.png", "/static/contentIndex.json", "/static/fonts/fontsource-5.3.0/source-sans-pro/source-sans-pro-latin-400-normal.woff2", "/index-1f644298.css", "/prescript-2bfc6315.js", "/component-735924e0.css", "/component-589c1cea.css", "/component-bbc3f7c0.css", "/component-2911f5d1.css", "/component-53b25b2b.css", "/component-c93c6a44.css", "/component-8a06014f.css", "/component-77d6a441.css", "/component-6ee21cee.css", "/component-1ea6ad18.css", "/component-34bdfded.css", "/component-788c9ca3.css", "/component-642859cd.css", "/component-4abc06bd.css", "/component-274a3dfe.css", "/component-94cb6c84.css", "/static/resource-style-a5c806d2.css", "/static/resource-style-6bd36952.css", "/static/resource-style-9857b007.css", "/static/resource-style-d3a1a224.css", "/static/katex/0.16.11/katex.min.css", "/static/resource-after-e13fffa1.js", "/static/resource-after-8b336f9a.js", "/static/resource-after-baba652b.js", "/static/resource-after-e6f51aac.js", "/static/katex/0.16.11/contrib/copy-tex.min.js", "/postscript-510b3acb.js"]
const VENDOR = "examenvault-vendor-v1"
const ASSETS = "examenvault-assets"
const PAGINAS = "examenvault-paginas"
const PRECACHE = "examenvault-precache-" + VERSIE
const BEHOUDEN = [VENDOR, ASSETS, PAGINAS, PRECACHE]
// CDN's met vaste versies; al het andere van buiten (GoatCounter) niet aanraken
const VENDOR_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"]
// zelf gehoste vendorbestanden (fase 4): pad bevat de versie, dus cache-first is veilig
const VENDOR_PADEN = ["/static/vendor/", "/static/fonts/", "/static/katex/", "/static/mermaid/"]
const MAX_ASSETS = 300 // ~30 deploys aan gewijzigde hashes
// Een pagina of index die al in de cache staat, wacht hooguit zo lang op het netwerk (hangende
// school-wifi of een captive portal: de verbinding staat open maar er komt niets).
const WACHTTIJD = 3000

const isGehasht = (url) => /-[0-9a-f]{8}\.(css|js)$/.test(url.pathname)
const isIndex = (url) => url.pathname === "/static/contentIndex.json" || url.pathname.startsWith("/static/zoekindex/")
// Quartz haalt pagina's bij doorklikken op met fetch(), niet als navigatie: herken HTML aan het pad
function isPaginaPad(url) {
  const laatste = url.pathname.split("/").pop()
  return url.pathname.endsWith("/") || laatste.endsWith(".html") || !laatste.includes(".")
}

// in welke cache hoort deze URL (null = niet aanraken)
function indeling(url) {
  if (url.origin !== self.location.origin) return VENDOR_HOSTS.includes(url.hostname) ? VENDOR : null
  if (url.pathname.startsWith("/static/pdf/") || url.pathname === "/sw.js") return null
  if (VENDOR_PADEN.some((p) => url.pathname.startsWith(p))) return VENDOR
  if (isGehasht(url)) return ASSETS
  return PAGINAS // pagina's, indexen en overige eigen bestanden (afbeeldingen, manifest, iconen)
}

// alleen echte antwoorden bewaren: geen fouten en geen opaque responses (die rekent Chrome als ~7 MB quota)
const bewaarbaar = (antw) => antw && antw.ok && (antw.type === "basic" || antw.type === "cors" || antw.type === "default")

async function haalEnBewaar(cachenaam, url) {
  const eigen = new URL(url).origin === self.location.origin
  const antw = await fetch(url, eigen ? {} : { mode: "cors", credentials: "omit" })
  if (bewaarbaar(antw)) await (await caches.open(cachenaam)).put(url, antw)
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const pre = await caches.open(PRECACHE)
      await pre.addAll(["/", "/offline.html"]) // zonder deze twee geen installatie
      // de rest naar de blijvende caches; wat daar al staat, hoeft niet opnieuw
      await Promise.all(
        SCHIL.filter((u) => u !== "/" && u !== "/offline.html").map(async (u) => {
          const url = new URL(u, self.location.origin)
          const naam = indeling(url)
          if (!naam || (await (await caches.open(naam)).match(url.href))) return
          await haalEnBewaar(naam, url.href).catch(() => {})
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

async function ruimAssetsOp() {
  const cache = await caches.open(ASSETS)
  const sleutels = await cache.keys()
  if (sleutels.length <= MAX_ASSETS) return
  const schil = new Set(SCHIL.map((u) => new URL(u, self.location.origin).href))
  const metDatum = await Promise.all(
    sleutels.map(async (k) => {
      const a = await cache.match(k)
      return { k, t: Date.parse(a?.headers.get("date") || "") || 0 }
    }),
  )
  metDatum
    .filter((x) => !schil.has(x.k.url))
    .sort((a, b) => a.t - b.t)
    .slice(0, sleutels.length - MAX_ASSETS)
    .forEach((x) => cache.delete(x.k))
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // oude caches weg: de per-build-caches van de vorige opzet en oude precaches. Wat daarin nog
      // bruikbaar is (geen opaque antwoorden), gaat eerst naar de nieuwe caches, zodat de offline-
      // voorraad van de vorige opzet de overstap overleeft.
      for (const k of await caches.keys()) {
        if (!k.startsWith("examenvault-") || BEHOUDEN.includes(k)) continue
        if (!k.startsWith("examenvault-precache-")) {
          const oud = await caches.open(k)
          for (const req of await oud.keys()) {
            const naam = indeling(new URL(req.url))
            const antw = naam && (await oud.match(req))
            const doel = naam && (await caches.open(naam))
            if (bewaarbaar(antw) && !(await doel.match(req))) await doel.put(req, antw)
          }
        }
        await caches.delete(k)
      }
      await ruimAssetsOp()
      await self.clients.claim()
    })(),
  )
})

async function netwerkEerst(e, req, pagina) {
  const cache = await caches.open(PAGINAS)
  const netwerk = fetch(req)
  // eerst klonen (deze then staat vóór elke andere lezer van het antwoord), dan pas de pagina
  e.waitUntil(netwerk.then((antw) => bewaarbaar(antw) && cache.put(req, antw.clone())).catch(() => {}))
  const bewaard = (await cache.match(req, { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true }))
  if (bewaard) {
    // de netwerkfetch loopt door en werkt de cache bij voor de volgende keer
    const opTijd = await Promise.race([netwerk.catch(() => null), new Promise((klaar) => setTimeout(() => klaar(null), WACHTTIJD))])
    return opTijd || bewaard
  }
  try {
    return await netwerk
  } catch (err) {
    if (pagina) return caches.match("/offline.html")
    throw err
  }
}

// Pagina's uit de vorige opzet laden KaTeX- en Google Fonts-bestanden nog zonder de cors-parameter
// (zie pwa_na_build.py). Zonder netwerk kan de variant mét parameter dienen: dezelfde inhoud.
function corsVariant(url) {
  const u = new URL(url)
  if (u.origin === self.location.origin) return null
  if (u.search === "?cors") u.search = ""
  else if (u.search.endsWith("&cors")) u.search = u.search.slice(0, -5)
  else u.search = u.search ? u.search + "&cors" : "?cors"
  return u.href
}

async function cacheEerst(cachenaam, req) {
  const bewaard = await caches.match(req)
  if (bewaard) return bewaard
  try {
    const antw = await fetch(req)
    if (bewaarbaar(antw)) (await caches.open(cachenaam)).put(req, antw.clone())
    return antw
  } catch (err) {
    const variant = corsVariant(req.url)
    const ander = variant && (await caches.match(variant))
    if (ander) return ander
    throw err
  }
}

// overige eigen bestanden (afbeeldingen, manifest): meteen uit de cache, op de achtergrond bijwerken
async function bewaardEnBijwerken(e, req) {
  const cache = await caches.open(PAGINAS)
  const bewaard = await caches.match(req) // ook de precache (manifest, iconen)
  const netwerk = fetch(req).then((antw) => {
    if (bewaarbaar(antw)) return cache.put(req, antw.clone()).then(() => antw)
    return antw
  })
  if (bewaard) {
    e.waitUntil(netwerk.catch(() => {}))
    return bewaard
  }
  return netwerk
}

self.addEventListener("fetch", (e) => {
  const req = e.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  const naam = indeling(url)
  if (!naam) return
  if (naam === VENDOR || naam === ASSETS) return e.respondWith(cacheEerst(naam, req))
  const pagina = req.mode === "navigate" || isPaginaPad(url)
  if (pagina || isIndex(url)) return e.respondWith(netwerkEerst(e, req, pagina))
  e.respondWith(bewaardEnBijwerken(e, req))
})

// Bij het allereerste bezoek kijkt de service worker nog niet mee: de pagina stuurt daarom de lijst
// met wat ze al geladen heeft (performance-entries), en wat hier nog niet bewaard is, wordt alsnog
// opgehaald (meestal uit de HTTP-cache, dus zonder extra verkeer). Zo werkt een pagina offline na
// één bezoek, inclusief opmaak en Mermaid.
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "bewaar" || !Array.isArray(e.data.urls)) return
  e.waitUntil(
    (async () => {
      for (const u of e.data.urls.slice(0, 300)) {
        let url
        try {
          url = new URL(u)
        } catch {
          continue
        }
        url.hash = ""
        const naam = indeling(url)
        if (!naam) continue
        const pagina = naam === PAGINAS && isPaginaPad(url)
        if (await caches.match(url.href, { ignoreSearch: pagina })) continue
        await haalEnBewaar(naam, url.href).catch(() => {})
      }
    })(),
  )
})
