const $ = (id) => document.getElementById(id);
const APP_VER = 23; // با هر انتشار، با VERSION سرویس‌ورکر و نسخهٔ فوتر یکی باشد
const FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);

/* ---------- نمایشگر خطا ----------
   هر خطای جاوااسکریپت را همان‌جا روی صفحه نشان می‌دهد تا اگر روی گوشی
   چیزی کار نکرد، متن خطا را بتوان برای سازنده فرستاد. */
function showErr(msg) {
  try {
    let t = document.getElementById("errToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "errToast";
      t.className = "err-toast";
      document.body.appendChild(t);
    }
    t.hidden = false;
    t.textContent = "⚠️ " + msg;
  } catch (e) { /* آخر خط */ }
}
window.addEventListener("error", (e) => {
  showErr("خطا (سطر " + (e.lineno || "?") + "): " + (e.message || "نامشخص") + " — از این پیام عکس بگیر و برای سازنده بفرست.");
});
// علامت «اسکریپت اصلی بالا آمد» برای مخفی شدن پیام js-dead-note
try {
  document.documentElement.className += " app-ok";
} catch (e) { /* نادیده */ }
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- قرعه‌کشی امن و عادلانه ----------
   secureInt از crypto استفاده می‌کند (رندوم واقعی) و اگر در دسترس نبود
   به Math.random برمی‌گردد. drawSpiesFair جاسوس‌ها را یکنواخت بین
   بازیکنان پخش می‌کند، با این قید که هیچ‌کس بیش از ۲ دور پشت‌سرهم
   جاسوس نشود. streak برای هر صندلی، تعداد دورهای پیاپی جاسوس‌بودن است. */
function secureInt(n) {
  if (n <= 1) return 0;
  try {
    const c =
      typeof crypto !== "undefined" && crypto.getRandomValues
        ? crypto
        : typeof msCrypto !== "undefined"
          ? msCrypto
          : null;
    if (c) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(4294967296 / n) * n;
      let x;
      do {
        c.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return x % n;
    }
  } catch (e) { /* رندوم معمولی */ }
  return Math.floor(Math.random() * n);
}

function secureShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawSpiesFairFrom(seats, spyCount, streak) {
  const n = Math.max(1, Math.min(spyCount, seats.length));
  const eligible = seats.filter((i) => (streak[i] || 0) < 2);
  let pool;
  if (eligible.length >= n) {
    pool = eligible;
  } else {
    // حالت خاص ریاضی (مثلاً ۳ نفره با ۲ جاسوس): اول همهٔ واجدها،
    // بعد کم‌سابقه‌ترین‌ها به قید قرعه
    const rest = secureShuffle(seats.filter((i) => (streak[i] || 0) >= 2));
    rest.sort((a, b) => (streak[a] || 0) - (streak[b] || 0)); // مرتب‌سازی پایدار: شانس مساوی بین هم‌سابقه‌ها
    pool = eligible.concat(rest);
  }
  return secureShuffle(pool).slice(0, n);
}

function bumpStreak(streak, seats, spySet) {
  seats.forEach((i) => {
    streak[i] = spySet.indexOf(i) !== -1 ? (streak[i] || 0) + 1 : 0;
  });
}

function pickWordAvoidRepeat(lastIdx) {
  if (WORDS.length < 2) return { idx: 0, word: WORDS[0] };
  let idx = secureInt(WORDS.length);
  if (idx === lastIdx) idx = (idx + 1 + secureInt(WORDS.length - 1)) % WORDS.length;
  return { idx, word: WORDS[idx] };
}

const state = {
  players: 6,
  spies: 1,
  seconds: 120,
  word: null,
  lastWordIdx: -1,
  spySet: [],
  spyStreak: {},
  seen: [],
  turn: 0,
  timeLeft: 120,
  timeUp: false,
  timerId: null,
  wakeLock: null,
};

const TIMES = [30, 60, 90, 120, 180, 240, 300, 600];
const timeLabel = (s) =>
  s < 60
    ? `${fa(s)} ثانیه`
    : s % 60 === 0
      ? `${fa(s / 60)} دقیقه`
      : `${fa(Math.floor(s / 60))}٫${fa(Math.round((s % 60) / 6))} دقیقه`;

const screens = {
  home: $("screen-home"),
  setup: $("screen-setup"),
  turn: $("screen-turn"),
  role: $("screen-role"),
  play: $("screen-play"),
  online: $("screen-online"),
  lobby: $("screen-lobby"),
  netrole: $("screen-netrole"),
  netplay: $("screen-netplay"),
  reveal: $("screen-reveal"),
};

function show(name) {
  Object.keys(screens).forEach((k) => screens[k].classList.remove("is-active"));
  const el = screens[name];
  if (el) el.classList.add("is-active");
  window.scrollTo({ top: 0 });
  if (name === "home") renderResume();
}

const netOn = () => window.NET && window.NET.isActive();

/* ---------------- صفحهٔ اول ---------------- */

$("toOfflineBtn").addEventListener("click", () => {
  initSetupControls();
  show("setup");
});
$("toOnlineBtn").addEventListener("click", () => show("online"));
$("homeBtn").addEventListener("click", () => show("home"));
$("homeBtn2").addEventListener("click", () => show("home"));

/* ---------------- کامپوننت‌های تنظیمات ---------------- */

/** اسلایدر + دکمه‌های −/+ + نمایش مقدار */
function bindSlider(opts) {
  const range = $(opts.range);
  const out = $(opts.out);
  const minus = $(opts.minus);
  const plus = $(opts.plus);
  const format = opts.label;
  const paint = () => {
    const min = +range.min, max = +range.max;
    const pct = ((+range.value - min) / (max - min)) * 100;
    const host = range.closest(".slider") || range.parentElement || range;
    host.style.setProperty("--pct", pct + "%");
    if (out) out.textContent = format ? format(+range.value) : fa(+range.value);
    if (minus) minus.disabled = +range.value <= min;
    if (plus) plus.disabled = +range.value >= max;
  };
  const set = (v) => {
    const min = +range.min, max = +range.max, step = +range.step || 1;
    const snapped = Math.round((v - min) / step) * step + min;
    range.value = String(Math.min(max, Math.max(min, snapped)));
    paint();
    if (opts.onChange) opts.onChange(+range.value);
  };
  range.addEventListener("input", () => {
    paint();
    if (opts.onChange) opts.onChange(+range.value);
  });
  if (minus) minus.addEventListener("click", () => set(+range.value - (+range.step || 1)));
  if (plus) plus.addEventListener("click", () => set(+range.value + (+range.step || 1)));
  paint();
  const setSilent = (v) => {
    range.value = String(v);
    paint();
  };
  return { set, setSilent, get: () => +range.value, paint };
}

/** گروه دکمه‌های هم‌اندازه (سگمنت) */
function bindSeg(containerId, attr, onChange) {
  const el = $(containerId);
  el.addEventListener("click", (e) => {
    const btn = e.target.closest(`[data-${attr}]`);
    if (!btn || btn.disabled) return;
    [...el.children].forEach((c) => c.classList.toggle("on", c === btn));
    const v = btn.dataset[attr];
    onChange(attr === "asplayer" ? v === "true" : +v, btn);
  });
  return {
    set(v) {
      [...el.children].forEach((c) =>
        c.classList.toggle("on", attr === "asplayer" ? c.dataset[attr] === String(v) : +c.dataset[attr] === +v)
      );
    },
    get() {
      const on = el.querySelector(".on");
      if (!on) return undefined;
      return attr === "asplayer" ? on.dataset[attr] === "true" : +on.dataset[attr];
    },
  };
}

const maxSpies = (players) => Math.max(1, Math.floor(players / 2));

/* ---------------- تنظیمات ---------------- */

let playersCtl, timeCtl, spySeg, setupReady = false;

function initSetupControls() {
  if (setupReady) {
    // فقط مقادیر را با وضعیت هم‌گام کن (دیگر شنوندهٔ تکراری نساز)
    playersCtl.set(state.players);
    timeCtl.set(state.seconds);
    spySeg.set(state.spies);
    $("spiesOut").textContent = fa(state.spies);
    [...$("spySeg").children].forEach((c) => (c.disabled = +c.dataset.spy > maxSpies(state.players)));
    return;
  }
  setupReady = true;
  playersCtl = bindSlider({
    range: "playersRange",
    out: "playersOut",
    minus: "playersMinus",
    plus: "playersPlus",
    onChange: (v) => {
      state.players = v;
      const max = maxSpies(v);
      if (state.spies > max) {
        state.spies = max;
        spySeg.set(max);
        $("spiesOut").textContent = fa(max);
      }
      [...$("spySeg").children].forEach((c) => (c.disabled = +c.dataset.spy > max));
      saveSettings();
    },
  });

  timeCtl = bindSlider({
    range: "timeRange",
    out: "timeOut",
    minus: "timeMinus",
    plus: "timePlus",
    label: timeLabel,
    onChange: (v) => {
      state.seconds = v;
      saveSettings();
    },
  });

  spySeg = bindSeg("spySeg", "spy", (v) => {
    state.spies = v;
    $("spiesOut").textContent = fa(v);
    saveSettings();
  });

  // بازگرداندن تنظیمات ذخیره‌شده
  const max = maxSpies(state.players);
  if (state.spies > max) state.spies = max;
  playersCtl.set(state.players);
  timeCtl.set(state.seconds);
  spySeg.set(state.spies);
  $("spiesOut").textContent = fa(state.spies);
  [...$("spySeg").children].forEach((c) => (c.disabled = +c.dataset.spy > maxSpies(state.players)));
}

function saveSettings() {
  try {
    localStorage.setItem(
      "spy-settings",
      JSON.stringify({ players: state.players, spies: state.spies, seconds: state.seconds })
    );
  } catch (e) { /* حالت ناشناس مرورگر */ }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("spy-settings");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.players >= 3 && s.players <= 16) state.players = s.players;
    if (TIMES.indexOf(s.seconds) !== -1) state.seconds = s.seconds;
    if (s.spies >= 1) state.spies = s.spies;
  } catch (e) { /* تنظیمات خراب، پیش‌فرض */ }
}

/* ---------------- ادامه بازی نیمه‌تمام (بعد از رفرش اتفاقی) ---------------- */

const OFF_KEY = "spy-offline";

function saveOff() {
  try {
    if (!state.word) return;
    localStorage.setItem(
      OFF_KEY,
      JSON.stringify({
        players: state.players,
        spies: state.spies,
        seconds: state.seconds,
        word: state.word,
        lastWordIdx: state.lastWordIdx,
        spySet: state.spySet,
        spyStreak: state.spyStreak,
        seen: state.seen,
        turn: state.turn,
        phase: state.timerId ? "play" : "turn",
        endsAt: state.timerId ? Date.now() + state.timeLeft * 1000 : 0,
      })
    );
  } catch (e) { /* حالت خصوصی */ }
}

function readOff() {
  try {
    const raw = localStorage.getItem(OFF_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.word || !s.word.w || !(s.players >= 3)) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function clearOff() {
  try {
    localStorage.removeItem(OFF_KEY);
  } catch (e) { /* حالت خصوصی */ }
}

function renderResume() {
  const btn = $("resumeBtn");
  if (btn) btn.hidden = !readOff();
}

/* پیام یک‌بارمصرف هر نسخه در صفحهٔ اصلی */
function renderUpdateTip() {
  try {
    const tip = $("updateTip");
    if (!tip) return;
    const key = "spy-tip-v" + APP_VER;
    if (localStorage.getItem(key)) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    $("updateTipClose").addEventListener("click", () => {
      try {
        localStorage.setItem(key, "1");
      } catch (e) { /* حالت خصوصی */ }
      tip.hidden = true;
    });
  } catch (e) { /* نادیده */ }
}

/* ---------------- شروع دور ---------------- */

function newRound() {
  if (typeof WORDS === "undefined" || !WORDS.length) {
    showErr("فایل کلمات بارگذاری نشد؛ صفحه را کامل ببند و با اینترنت دوباره باز کن.");
    return;
  }
  const picked = pickWordAvoidRepeat(state.lastWordIdx);
  state.lastWordIdx = picked.idx;
  state.word = picked.word;
  const seats = [];
  for (let i = 0; i < state.players; i++) seats.push(i);
  state.spySet = drawSpiesFairFrom(seats, state.spies, state.spyStreak);
  bumpStreak(state.spyStreak, seats, state.spySet);
  state.seen = [];
  state.turn = 0;
  saveOff();
  showTurn();
}

function showTurn() {
  $("turnBadge").textContent = `بازیکن ${fa(state.turn + 1)}`;
  renderSeats($("seats"), state.turn);
  show("turn");
}

function renderSeats(el, now) {
  let html = "";
  for (let i = 0; i < state.players; i++) {
    const seenIt = state.seen.indexOf(i) !== -1;
    const cls = i === now ? "seat now" : seenIt ? "seat seen" : "seat";
    const mark = i === now ? " 👈" : seenIt ? " ✔" : "";
    html += `<span class="${cls}">${fa(i + 1)}${mark}</span>`;
  }
  el.innerHTML = html;
}

/* ---------------- نقش هر نفر ---------------- */

$("startBtn").addEventListener("click", () => {
  newRound();
  buzz(20);
});

$("peekBtn").addEventListener("click", () => {
  const i = state.turn;
  const isSpy = state.spySet.indexOf(i) !== -1;
  const card = $("roleCard");
  card.classList.toggle("is-spy", isSpy);
  card.classList.toggle("is-agent", !isSpy);
  $("roleBadge").textContent = `بازیکن ${fa(i + 1)}`;

  const secret = $("roleSecret");
  secret.classList.toggle("spy-word", isSpy);
  secret.textContent = isSpy ? "تو جاسوسی!" : state.word.w;

  $("roleKicker").textContent = isSpy ? "این راهنما فقط برای توست" : "این کلمه را به کسی نگو";
  $("roleHintBox").hidden = !isSpy;
  $("roleHintWord").textContent = isSpy ? state.word.h : "";
  $("roleHelp").textContent = isSpy
    ? "کلمهٔ اصلی را نمی‌دانی؛ فقط همین راهنما را داری. طوری حرف بزن که انگار کلمه را می‌دانی تا کسی به تو شک نکند!"
    : "تو جاسوس نیستی. دربارهٔ کلمه حرف بزن ولی آن‌قدر واضح نگو که جاسوس بفهمد؛ جاسوس با حرف‌هایش خودش را لو می‌دهد.";

  $("hideBtn").textContent = isSpy
    ? "پنهان کن و نفر بعدی"
    : i === state.players - 1
      ? "پنهان کن و شروع گفت‌وگو"
      : "پنهان کن و نفر بعدی";

  show("role");
  buzz(25);
});

$("hideBtn").addEventListener("click", () => {
  state.seen.push(state.turn);
  state.turn += 1;
  saveOff();
  if (state.turn < state.players) showTurn();
  else startTalk();
  buzz(15);
});

$("cancelPeekBtn").addEventListener("click", () => showTurn());
$("backSetupBtn").addEventListener("click", () => {
  stopTimer();
  show("setup");
});

/* ---------------- مرحلهٔ گفت‌وگو ---------------- */

const RING = 2 * Math.PI * 52;

function startTalk() {
  beginTalk(state.seconds);
}

function resumeTalk(left) {
  beginTalk(Math.max(0, Math.min(left, state.seconds)));
}

function beginTalk(left) {
  state.timeLeft = left;
  state.timeUp = false;
  $("timerNum").textContent = fa(left);
  $("playNote").textContent = "";
  $("minus30Btn").disabled = left <= 0;
  const ring = $("ringFg");
  ring.style.strokeDasharray = RING;
  ring.style.strokeDashoffset = RING * (1 - left / state.seconds);
  $("screen-play").querySelector(".timer-wrap").classList.remove("hurry");
  renderSeats($("seatsPlay"), -1);
  show("play");
  requestWake();
  stopTimer();
  saveOff();
  state.timerId = setInterval(tick, 1000);
}

function tick() {
  state.timeLeft -= 1;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.timeUp = true;
    stopTimer();
    $("timerNum").textContent = "۰";
    $("ringFg").style.strokeDashoffset = RING;
    $("playNote").textContent = "⏱ زمان تمام شد — تا وقتی «پایان و افشا» را نزنید، کلمه دیده نمی‌شود.";
    $("minus30Btn").disabled = true;
    $("screen-play").querySelector(".timer-wrap").classList.remove("hurry");
    buzz([80, 60, 80]);
    return;
  }
  $("timerNum").textContent = fa(state.timeLeft);
  $("ringFg").style.strokeDashoffset = RING * (1 - state.timeLeft / state.seconds);
  $("screen-play").querySelector(".timer-wrap").classList.toggle("hurry", state.timeLeft <= 10);
  if (state.timeLeft === 10) buzz([80, 60, 80]);
  saveOff();
}

function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
  releaseWake();
}

function addTime(delta) {
  state.timeLeft = Math.max(0, state.timeLeft + delta);
  if (state.timeUp && state.timeLeft > 0) {
    state.timeUp = false;
    $("playNote").textContent = "";
    $("minus30Btn").disabled = false;
    stopTimer();
    state.timerId = setInterval(tick, 1000);
  }
  $("timerNum").textContent = fa(state.timeLeft);
  $("ringFg").style.strokeDashoffset = RING * (1 - state.timeLeft / state.seconds);
  saveOff();
  buzz(10);
}

$("plus30Btn").addEventListener("click", () => addTime(30));
$("minus30Btn").addEventListener("click", () => addTime(-30));
$("revealBtn").addEventListener("click", () => {
  stopTimer();
  reveal();
  buzz(30);
});

/* ---------------- افشا ---------------- */

function reveal() {
  const spies = state.spySet.slice().sort((a, b) => a - b);
  $("revealWord").textContent = state.word.w;
  $("revealList").innerHTML =
    spies
      .map((i) => `<span class="reveal-tag spy">🕵️ بازیکن ${fa(i + 1)} — جاسوس</span>`)
      .join("") +
    `<span class="reveal-tag">راهنما: ${state.word.h}</span>`;
  $("revealMsg").textContent =
    `جاسوس‌ها بازیکن ${spies.map((i) => fa(i + 1)).join(" و ")} بودند. اگر حدس شما درست بود، آفرین!`;
  $("revealAll").innerHTML = "";
  $("againBtn").hidden = false;
  $("againBtn").textContent = "یک دور دیگر";
  $("menuBtn").textContent = "تغییر تنظیمات";
  clearOff();
  show("reveal");
  buzz([40, 60, 120]);
}

$("resumeBtn").addEventListener("click", () => {
  const s = readOff();
  if (!s) return;
  stopTimer();
  state.players = s.players;
  state.spies = s.spies;
  state.seconds = s.seconds;
  state.word = s.word;
  state.lastWordIdx = typeof s.lastWordIdx === "number" ? s.lastWordIdx : -1;
  state.spySet = s.spySet || [];
  state.spyStreak = s.spyStreak || {};
  state.seen = s.seen || [];
  state.turn = s.turn || 0;
  if (state.turn >= state.players) state.turn = 0;
  initSetupControls();
  if (s.phase === "play" && s.endsAt) {
    resumeTalk(Math.round((s.endsAt - Date.now()) / 1000));
  } else {
    showTurn();
  }
  buzz(20);
});

$("againBtn").addEventListener("click", () => {
  if (netOn()) return window.NET.again();
  newRound();
});
$("menuBtn").addEventListener("click", () => {
  if (netOn()) return window.NET.leave();
  stopTimer();
  show("setup");
});

/* ---------------- ابزارها ---------------- */

function buzz(p) {
  if (navigator.vibrate) navigator.vibrate(p);
}

async function requestWake() {
  try {
    if ("wakeLock" in navigator) state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) { /* پشتیبانی نمی‌شود */ }
}

function releaseWake() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.timerId) requestWake();
});

loadSettings();
initSetupControls();
renderResume();
renderUpdateTip();
$("wordCount").textContent = `${fa(WORDS.length)} کلمهٔ فارسی`;

window.SPY_FA = fa;
window.showScreen = show;
window.SPY_TIMES = TIMES;
window.SPY_TIME_LABEL = timeLabel;
window.SPY_DEBUG = { state, tick };
window.SPY_UI = { bindSlider, bindSeg, fa, timeLabel };

/* ---------------- نصب روی گوشی (PWA) ---------------- */

function initPWA() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* مرورگر پشتیبانی نمی‌کند؛ بازی بدون آن هم کار می‌کند */
      });
    });
  }

  // میان‌برهای مانیفست: ?go=offline / ?go=online
  const go = new URLSearchParams(location.search).get("go");
  if (go === "offline" || go === "online") {
    show(go === "online" ? "online" : "setup");
  }
}

// خبر «نسخهٔ جدید آماده است» از سرویس‌ورکر
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "SW_UPDATED" && !document.getElementById("updateBar")) showUpdateBar();
  });
}

function showUpdateBar() {
  const bar = document.createElement("div");
  bar.className = "update-bar";
  bar.id = "updateBar";
  bar.innerHTML =
    '<span>نسخهٔ جدید آماده است</span><button type="button" class="update-btn">به‌روزرسانی</button>';
  bar.querySelector("button").addEventListener("click", () => {
    // اول صبر می‌کنیم سرویس‌ورکر جدید کنترل را بگیرد، بعد رفرش؛ وگرنه
    // ممکن است با فایل‌های نصفه‌نیمهٔ قدیمی بالا بیاید
    const go = () => location.reload();
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          setTimeout(go, 300);
        }
      };
      navigator.serviceWorker.addEventListener("controllerchange", finish);
      setTimeout(finish, 2500);
      navigator.serviceWorker.controller.postMessage("skip-waiting");
    } else {
      go();
    }
  });
  document.body.appendChild(bar);
}

/* ---------------- ریپل متریال ---------------- */

const reduceMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduceMotion) {
  document.addEventListener("pointerdown", (e) => {
    const target = e.target.closest(".btn, .seg-btn, .icon-btn");
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = span.style.height = size * 2 + "px";
    span.style.right = e.clientX - rect.left - size + "px";
    span.style.top = e.clientY - rect.top - size + "px";
    target.appendChild(span);
    setTimeout(() => span.remove(), 600);
  });
}

initPWA();
