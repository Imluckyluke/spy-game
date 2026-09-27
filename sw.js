/* سرویس‌ورکر بازی جاسوس — کارکرد آفلاین و نصب روی گوشی */
/* نسخهٔ انتشار: هنگام انتشار نسخهٔ جدید، عدد VERSION و «نسخهٔ فوتر» در index.html را با هم بالا ببر */
/* نکته: رویدادی به نام installed وجود ندارد؛ خبر نسخهٔ جدید در activate فرستاده می‌شود */
const VERSION = "v26";
const CACHE = `jasoos-${VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./style.css?v=26",
  "./app.js?v=26",
  "./online.js?v=26",
  "./words.js?v=26",
  "./manifest.webmanifest",
  "./fonts/Vazirmatn-var.woff2",
  "./vendor/mqtt.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // خبر «نسخهٔ جدید آماده است» به صفحه‌های باز (این همان نواری است که بالای سایت می‌آید)
      .then(() => self.clients.matchAll({ includeUncontrolled: true }))
      .then((list) => {
        list.forEach((c) => {
          try {
            c.postMessage({ type: "SW_UPDATED", version: VERSION });
          } catch (err) { /* بی‌اهمیت */ }
        });
      })
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // MQTT و بیرون از سایت: دست‌نخورده

  // ناوبری: اول شبکه (تا نسخهٔ جدید سریع بیاید)، در نبود شبکه از حافظهٔ نهان
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // بقیهٔ فایل‌ها: از حافظهٔ نهان، سپس به‌روزرسانی در پس‌زمینه
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
