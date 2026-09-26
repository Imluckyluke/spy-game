const $ = (id) => document.getElementById(id);
const FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const fa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const state = {
  players: 6,
  spies: 1,
  seconds: 120,
  word: null,
  spySet: new Set(),
  seen: new Set(),
  turn: 0,
  timeLeft: 120,
  timeUp: false,
  timerId: null,
  wakeLock: null,
};

const TIMES = [30, 60, 90, 120, 180, 240, 300, 600];
const timeLabel = (s) =>
  s < 60 ? `${fa(s)} ثانیه` : s % 60 === 0 ? `${fa(s / 60)} دقیقه` : `${fa(s / 60)}٫${fa((s % 60) / 10)} دقیقه`;

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
  Object.values(screens).forEach((s) => s.classList.remove("is-active"));
  const el = screens[name];
  if (el) el.classList.add("is-active");
  window.scrollTo({ top: 0 });
}

const netOn = () => window.NET && window.NET.isActive();

/* ---------------- صفحهٔ اول ---------------- */

$("toOfflineBtn").addEventListener("click", () => {
  renderDots();
  renderSpyChips();
  renderTimeChips();
  show("setup");
});
$("toOnlineBtn").addEventListener("click", () => show("online"));
$("homeBtn").addEventListener("click", () => show("home"));
$("homeBtn2").addEventListener("click", () => show("home"));

/* ---------------- تنظیمات ---------------- */

const maxSpies = () => Math.max(1, Math.floor(state.players / 2));

function renderDots() {
  $("playersDots").innerHTML = Array.from(
    { length: state.players },
    () => "<i class='on'></i>"
  ).join("");
  $("playersOut").textContent = fa(state.players);
  $("players").value = state.players;
}

function renderSpyChips() {
  const max = maxSpies();
  if (state.spies > max) state.spies = max;
  $("spyChips").innerHTML = Array.from({ length: max }, (_, i) => i + 1)
    .map(
      (n) =>
        `<button type="button" class="chip ${n === state.spies ? "on" : ""}" data-spies="${n}">${fa(n)} جاسوس</button>`
    )
    .join("");
  $("spiesOut").textContent = fa(state.spies);
}

function renderTimeChips() {
  $("timeChips").innerHTML = TIMES.map(
    (s) => `<button type="button" class="chip ${s === state.seconds ? "on" : ""}" data-seconds="${s}">${timeLabel(s)}</button>`
  ).join("");
}

function saveSettings() {
  try {
    localStorage.setItem("spy-settings", JSON.stringify({
      players: state.players,
      spies: state.spies,
      seconds: state.seconds,
    }));
  } catch (e) { /* حالت ناشناس مرورگر */ }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("spy-settings");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.players >= 3 && s.players <= 16) state.players = s.players;
    if (TIMES.includes(s.seconds)) state.seconds = s.seconds;
    if (s.spies >= 1) state.spies = s.spies;
  } catch (e) { /* تنظیمات خراب، پیش‌فرض */ }
}

$("players").addEventListener("input", (e) => {
  state.players = +e.target.value;
  renderDots();
  renderSpyChips();
  saveSettings();
});

document.querySelectorAll(".step-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const delta = +btn.dataset.delta;
    state.players = Math.min(16, Math.max(3, state.players + delta));
    renderDots();
    renderSpyChips();
    saveSettings();
    buzz(8);
  });
});

$("spyChips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-spies]");
  if (!chip) return;
  state.spies = +chip.dataset.spies;
  renderSpyChips();
  saveSettings();
  buzz(8);
});

$("timeChips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-seconds]");
  if (!chip) return;
  state.seconds = +chip.dataset.seconds;
  renderTimeChips();
  saveSettings();
  buzz(8);
});

/* ---------------- شروع دور ---------------- */

function newRound() {
  const word = pick(WORDS);
  state.word = word;
  state.spySet = new Set(shuffle(Array.from({ length: state.players }, (_, i) => i)).slice(0, state.spies));
  state.seen = new Set();
  state.turn = 0;
  showTurn();
}

function showTurn() {
  $("turnBadge").textContent = `بازیکن ${fa(state.turn + 1)}`;
  renderSeats($("seats"), state.turn);
  show("turn");
}

function renderSeats(el, now) {
  el.innerHTML = Array.from({ length: state.players }, (_, i) => {
    const cls = i === now ? "seat now" : state.seen.has(i) ? "seat seen" : "seat";
    const mark = i === now ? " 👈" : state.seen.has(i) ? " ✔" : "";
    return `<span class="${cls}">${fa(i + 1)}${mark}</span>`;
  }).join("");
}

/* ---------------- نقش هر نفر ---------------- */

$("startBtn").addEventListener("click", () => {
  newRound();
  buzz(20);
});

$("peekBtn").addEventListener("click", () => {
  const i = state.turn;
  const isSpy = state.spySet.has(i);
  const card = $("roleCard");
  card.classList.toggle("is-spy", isSpy);
  card.classList.toggle("is-agent", !isSpy);
  $("roleBadge").textContent = `بازیکن ${fa(i + 1)}`;

  const secret = $("roleSecret");
  secret.classList.toggle("spy-word", isSpy);
  secret.textContent = isSpy ? "تو جاسوسی!" : state.word.w;

  $("roleKicker").textContent = isSpy ? "این راهنما فقط مال توست" : "این کلمه را به کسی نگو";
  $("roleHintBox").hidden = !isSpy;
  $("roleHintWord").textContent = isSpy ? state.word.h : "";
  $("roleHelp").textContent = isSpy
    ? "کلمهٔ اصلی را تو هم نمی‌دانی. وانمود کن خبر نداری و بگذار بقیه به تو شک کنند!"
    : "تو جاسوس نیستی. با توضیح‌هایت کلمه را لو نده و بگذار جاسوس خودش را نشان بدهد.";

  $("hideBtn").textContent = isSpy
    ? "پنهان کن و نفر بعدی"
    : i === state.players - 1
      ? "پنهان کن و شروع گفت‌وگو"
      : "پنهان کن و نفر بعدی";

  show("role");
  buzz(25);
});

$("hideBtn").addEventListener("click", () => {
  state.seen.add(state.turn);
  state.turn += 1;
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
  state.timeLeft = state.seconds;
  state.timeUp = false;
  $("timerNum").textContent = fa(state.seconds);
  $("playNote").textContent = "";
  $("minus30Btn").disabled = false;
  const ring = $("ringFg");
  ring.style.strokeDasharray = RING;
  ring.style.strokeDashoffset = 0;
  $("screen-play").querySelector(".timer-wrap").classList.remove("hurry");
  renderSeats($("seatsPlay"), -1);
  show("play");
  requestWake();
  stopTimer();
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
  const spies = [...state.spySet].sort((a, b) => a - b);
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
  show("reveal");
  buzz([40, 60, 120]);
}

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
renderDots();
renderSpyChips();
renderTimeChips();
$("wordCount").textContent = `${fa(WORDS.length)} کلمهٔ فارسی`;

window.SPY_FA = fa;
window.showScreen = show;
window.SPY_TIMES = TIMES;
window.SPY_TIME_LABEL = timeLabel;
window.SPY_DEBUG = { state, tick };
