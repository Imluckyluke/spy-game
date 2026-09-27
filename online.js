/* بازی آنلاین: ساخت روم و ورود با کد
   ارتباط فقط از راه یک بروکر عمومی MQTT (WebSocket) انجام می‌شود؛
   نقش هر بازیکن فقط در «موضوع» مخصوص خودش فرستاده می‌شود. */

const MIN_PLAYERS = 3;

const NET_BROKERS = [
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://test.mosquitto.org:8081/mqtt",
  "wss://broker.emqx.io:8084/mqtt",
];

const N = {
  active: false,
  connecting: false,
  finishHello: null,
  waitingHost: false,
  hostId: null,
  broker: "",
  lastState: 0,
  watchId: null,
  heartId: null,
  client: null,
  isHost: false,
  code: "",
  root: "",
  myId: "",
  myName: "",
  myIndex: -1,
  players: [],
  phase: "idle",
  max: 6,
  asPlayer: true,
  spies: 1,
  seconds: 120,
  endsAt: 0,
  timeUp: false,
  word: null,
  lastWordIdx: -1,
  spyIdx: [],
  spyStreak: {},
  roles: [],
  role: null,
  tickId: null,
  joinPaneOn: true,
};

let ctlMax = null, ctlTime = null, segSpy = null, segRole = null;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const $n = (id) => document.getElementById(id);
const NET_RING = 2 * Math.PI * 52;

const rand = (n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
};
const uid = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const brokerList = () => {
  const custom = ($n("brokerInput") && $n("brokerInput").value.trim()) || "";
  const list = [];
  // اول آخرین سرور سالم، بعد انتخاب دستی، بعد پیش‌فرض‌ها؛ بدون تکرار
  [readBroker(), custom].concat(NET_BROKERS).forEach((u) => {
    if (u && list.indexOf(u) === -1) list.push(u);
  });
  return list;
};

const setStatus = (msg) => {
  $n("netStatus").textContent = msg || "";
};

/* ---------------- نشست مهمان (اتصال مجدد) ----------------
   کد روم + شناسهٔ ثابت بازیکن ذخیره می‌شود تا بعد از قطعی اینترنت یا
   بسته شدن صفحه، با همان صندلی و همان نقش به روم برگردد. */

const SESSION_KEY = "spy-session";
const SESSION_TTL = 3 * 3600 * 1000;
let rejoinSession = null;

function saveSession() {
  try {
    if (N.isHost) return; // بازیابی روم میزبان پشتیبانی نمی‌شود
    if (!N.code || !N.myId) return;
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ code: N.code, myId: N.myId, myName: N.myName, ts: Date.now() })
    );
  } catch (e) { /* حالت خصوصی */ }
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.code || !s.myId || Date.now() - (s.ts || 0) > SESSION_TTL) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  rejoinSession = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* حالت خصوصی */ }
}

function renderRejoin() {
  const btn = $n("rejoinBtn");
  if (!btn) return;
  rejoinSession = !N.active && !N.connecting ? readSession() : null;
  btn.hidden = !rejoinSession;
  if (rejoinSession) btn.textContent = `🔄 بازگشت به روم ${rejoinSession.code}`;
}

/* ---------------- اسنپ‌شات میزبان (بازیابی روم بعد از رفرش) ---------------- */

const HOST_KEY = "spy-host";

function saveHostSnap() {
  try {
    if (!N.isHost || !N.code) return;
    localStorage.setItem(
      HOST_KEY,
      JSON.stringify({
        code: N.code,
        myId: N.myId,
        myName: N.myName,
        asPlayer: N.asPlayer,
        max: N.max,
        spies: N.spies,
        seconds: N.seconds,
        players: N.players,
        word: N.word,
        spyIdx: N.spyIdx,
        spyStreak: N.spyStreak,
        lastWordIdx: N.lastWordIdx,
        phase: N.phase,
        endsAt: N.endsAt,
        timeUp: N.timeUp,
        role: N.role,
        ts: Date.now(),
      })
    );
  } catch (e) { /* حالت خصوصی */ }
}

function readHostSnap() {
  try {
    const raw = localStorage.getItem(HOST_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.code || !s.myId || Date.now() - (s.ts || 0) > SESSION_TTL) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function clearHostSnap() {
  try {
    localStorage.removeItem(HOST_KEY);
  } catch (e) { /* حالت خصوصی */ }
}

function renderRecover() {
  const btn = $n("recoverBtn");
  if (!btn) return;
  const s = !N.active ? readHostSnap() : null;
  btn.hidden = !s;
  if (s) btn.textContent = `🔄 بازگشت به روم خودم (${s.code})`;
}

function findIn(arr, fn) {
  for (let i = 0; i < arr.length; i++) if (fn(arr[i], i)) return arr[i];
  return undefined;
}

/* ---------------- اتصال ----------------
   به همهٔ سرورها هم‌زمان وصل می‌شویم و هرکدام زودتر جواب داد همان را نگه
   می‌داریم (قبلاً تک‌تک با ۱۰ ثانیه مکث امتحان می‌شد و کند بود). سروری که
   سالم باشد ذخیره می‌شود تا دفعهٔ بعد اول همان امتحان شود — این شانس یکی
   بودن سرور میزبان و مهمان را هم بالا می‌برد. */

const BROKER_KEY = "spy-broker";
let lastBrokerUrl = "";

function saveBroker(url) {
  try {
    if (url) localStorage.setItem(BROKER_KEY, url);
  } catch (e) { /* حالت خصوصی */ }
}

function readBroker() {
  try {
    return localStorage.getItem(BROKER_KEY) || null;
  } catch (e) {
    return null;
  }
}

function mqttConnect(url, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let client;
    try {
      client = mqtt.connect(url, {
        clientId: "j" + uid(),
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 8000,
        keepalive: 45,
      });
    } catch (e) {
      return reject(e);
    }
    const to = setTimeout(() => finish(new Error("timeout")), ms || 6000);
    function finish(err, val) {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      if (err) {
        try { client.end(true); } catch (e) { /* بستن ناموفق */ }
        reject(err);
      } else resolve(client);
    }
    client.on("connect", () => finish(null, client));
    client.on("error", (e) => finish(e));
  });
}

async function connectAny() {
  const list = brokerList();
  setStatus(`در حال اتصال به سرور…`);
  return new Promise((resolve, reject) => {
    let pending = list.length;
    let done = false;
    let lastErr = null;
    list.forEach((url) => {
      mqttConnect(url).then((client) => {
        if (done) {
          try { client.end(true); } catch (e) { /* اضافی */ }
          return;
        }
        done = true;
        lastBrokerUrl = url;
        saveBroker(url);
        resolve(client);
      }).catch((e) => {
        lastErr = e;
        pending -= 1;
        if (pending <= 0 && !done) reject(lastErr || new Error("اتصال برقرار نشد"));
      });
    });
  });
}

function shortBroker(url) {
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, "");
  } catch (e) {
    return url || "";
  }
}

const pub = (topic, obj, qos) => {
  if (N.client) N.client.publish(topic, JSON.stringify(obj), { qos: qos || 0, retain: false });
};
const pubRaw = (topic, str, retain) => {
  if (N.client) N.client.publish(topic, str, { qos: retain ? 1 : 0, retain: !!retain });
};

/* ---------------- ساخت روم (میزبان) ---------------- */

async function hostCreate() {
  setStatus("در حال ساخت روم…");
  const name = readName();
  let client;
  try {
    client = await connectAny();
  } catch (e) {
    setStatus("❌ اتصال به سرور ممکن نشد. اینترنت را بررسی کنید یا در تنظیمات پیشرفته سرور دیگری بنویسید.");
    return;
  }

  N.client = client;
  N.isHost = true;
  N.broker = lastBrokerUrl;
  N.myId = uid();
  N.myName = name;
  N.myIndex = N.asPlayer ? 0 : -1;
  N.players = [];
  N.phase = "lobby";
  N.active = true;
  N.spyStreak = {};
  N.lastWordIdx = -1;
  clearSession();

  let code = null;
  for (let attempt = 0; attempt < 6 && !code; attempt++) {
    code = rand(6);
    N.code = code;
    N.root = `jasoos/${code.toLowerCase()}`;
    const free = await claimCode(client, N.root, N.myId);
    if (!free) code = null;
  }
  if (!code) {
    netLeave();
    setStatus("❌ پیدا کردن کد آزاد ممکن نشد؛ دوباره تلاش کنید.");
    return;
  }

  client.on("message", onHostMessage);
  client.on("connect", () => {
    pubRaw(`${N.root}/host`, "here:" + N.myId, true);
    if (N.phase === "lobby") N.players.forEach((p) => sendWelcome(p));
    else if (N.phase === "role" && N.word) N.players.forEach((p) => sendWelcome(p, giveRole(p.i)));
    syncHostState();
  });
  client.subscribe(`${N.root}/#`);
  openLobby("میزبان");
  setStatus("");
  renderRecover();
  startHeartbeat();
  syncHostState();
}

function claimCode(client, root, myId) {
  return new Promise((resolve) => {
    const topic = `${root}/host`;
    let taken = false;
    const onMsg = (t, msg) => {
      const payload = msg && msg.toString ? msg.toString() : "";
      // فقط نشانهٔ زنده بودن میزبان دیگر مهم است؛ پیام closed یعنی روم بسته‌شده و کد آزاد است
      if (payload.indexOf("here:") === 0 && payload !== "here:" + myId) taken = true;
    };
    client.on("message", onMsg);
    client.subscribe(topic);
    pubRaw(topic, "here:" + myId, true);
    setTimeout(() => {
      if (client.off) client.off("message", onMsg);
      else if (client.removeListener) client.removeListener("message", onMsg);
      resolve(!taken);
    }, 1400);
  });
}

function onHostMessage(topic, msg) {
  let data;
  try {
    data = JSON.parse(msg.toString());
  } catch (e) {
    return;
  }
  if (!data || data.from === N.myId) return;

  if (topic === `${N.root}/join` && data.t === "hello") {
    addGuest(data);
    return;
  }
  if (topic === `${N.root}/ping` && data.t === "ping") {
    const p = findIn(N.players, (x) => x.id === data.id);
    if (p) sendWelcome(p);
  }
}

function seatList() {
  const list = N.players.slice();
  // فقط خود میزبانِ بازیکن، صندلی ۰ را اضافه می‌کند؛ مهمان‌ها asPlayer پیش‌فرض
  // داشتند و برای خودشان صندلی خیالی ۱ 👑 می‌ساختند (تکراری + شمارش اشتباه).
  if (N.isHost && N.asPlayer) list.unshift({ i: 0, id: N.myId, name: N.myName, host: true });
  return list;
}

function activeSeats() {
  return seatList().map((p) => p.i);
}

function addGuest(data) {
  const existing = findIn(N.players, (x) => x.id === data.id);
  if (!existing && seatList().length >= N.max) {
    pub(`${N.root}/to/${data.id}`, { t: "full", from: N.myId });
    return;
  }

  const name = (data.name || "بازیکن").slice(0, 14);
  let p = existing;
  if (!p) {
    p = { i: N.players.length + 1, id: data.id, name: dupName(name, data.id) };
    N.players.push(p);
  } else {
    p.name = dupName(name, data.id);
  }

  if (N.phase === "lobby") {
    sendWelcome(p);
  } else if (N.word) {
    sendWelcome(p, giveRole(p.i));
  }
  syncHostState();
}

function dupName(name, selfId) {
  let n = name;
  let k = 2;
  while (N.players.some((p) => p.name === n && p.id !== selfId)) {
    n = `${name} ${k++}`;
  }
  return n;
}

function sendWelcome(p, role) {
  const payload = {
    t: "welcome",
    from: N.myId,
    you: p.i,
    phase: N.phase,
    max: N.max,
    spies: N.spies,
    seconds: N.seconds,
    endsAt: N.endsAt,
  };
  if (role) {
    payload.kind = role.kind;
    payload.word = role.word;
    if (role.kind === "spy") payload.hint = role.hint;
  }
  pub(`${N.root}/to/${p.id}`, payload, 1);
}

function syncHostState() {
  const msg = {
    t: "state",
    from: N.myId,
    phase: N.phase,
    players: seatList().map((p) => ({ i: p.i, name: p.name, host: !!p.host })),
    asPlayer: N.asPlayer,
    minPlayers: MIN_PLAYERS,
    max: N.max,
    spies: N.spies,
    seconds: N.seconds,
    endsAt: N.endsAt,
    timeUp: N.timeUp,
  };
  if (N.phase === "reveal" && N.word) {
    msg.word = N.word.w;
    msg.hint = N.word.h;
    msg.spyIdx = N.spyIdx;
    msg.roles = seatList().map((p) => ({ i: p.i, name: p.name, host: !!p.host, spy: N.spyIdx.indexOf(p.i) !== -1 }));
  }
  pub(`${N.root}/state`, msg, 1);
  saveHostSnap();
  if (N.isHost) renderLobby();
}

function giveRole(i) {
  const isSpy = N.spyIdx.indexOf(i) !== -1;
  return isSpy
    ? { kind: "spy", word: N.word.w, hint: N.word.h }
    : { kind: "agent", word: N.word.w, hint: N.word.h };
}

/* ---------------- ورود به روم (مهمان) ---------------- */

async function guestJoin(code, reuseId) {
  code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) {
    setStatus("❌ کد روم باید ۶ کاراکتر باشد.");
    return;
  }
  if (N.connecting || N.active) return; // جلوگیری از ورود دوباره با دو بار زدن دکمه
  N.connecting = true;
  $n("joinBtn").disabled = true;
  renderRejoin();
  setStatus("در حال اتصال به روم…");
  let client;
  try {
    client = await connectAny();
  } catch (e) {
    N.connecting = false;
    $n("joinBtn").disabled = false;
    setStatus("❌ اتصال به سرور ممکن نشد.");
    renderRejoin();
    return;
  }

  const sayHello = () => {
    if (N.client === client && N.connecting) {
      pub(`${N.root}/join`, { t: "hello", from: N.myId, id: N.myId, name: N.myName }, 1);
    }
  };

  N.client = client;
  N.isHost = false;
  N.broker = lastBrokerUrl;
  N.code = code;
  N.root = `jasoos/${code.toLowerCase()}`;
  N.myId = reuseId || uid();
  N.myName = readName();
  N.myIndex = -1;
  N.players = [];
  N.phase = "lobby";
  N.role = null;
  N.word = null;
  N.spyIdx = [];
  N.endsAt = 0;
  N.timeUp = false;
  stopNetTick();

  client.on("message", onGuestMessage);
  client.on("connect", () => {
    if (N.client !== client) return;
    // اتصال دوباره (بعد از قطعی اینترنت): خودمان را دوباره معرفی می‌کنیم تا میزبان نقش را بفرستد
    pub(`${N.root}/join`, { t: "hello", from: N.myId, id: N.myId, name: N.myName }, 1);
  });
  client.subscribe(`${N.root}/state`);
  client.subscribe(`${N.root}/to/${N.myId}`);
  client.subscribe(`${N.root}/host`);
  // عمداً هنوز وارد لابی نمی‌شویم: اول باید میزبان جواب بدهد تا با کد
  // اشتباه وارد روم خیالی نشویم. با اولین welcome لابی باز می‌شود.
  sayHello();
  const helloTimer = setInterval(sayHello, 2000);
  N.finishHello = () => clearInterval(helloTimer);

  setTimeout(() => {
    if (N.finishHello) {
      try { N.finishHello(); } catch (e) { /* بی‌اهمیت */ }
      N.finishHello = null;
    }
    if (!N.connecting || N.client !== client) return;
    // هنوز هیچ خبری از میزبان نیست: چنین رومی وجود ندارد (یا میزبان رفته)
    try { client.end(true); } catch (e) { /* بی‌اهمیت */ }
    N.client = null;
    N.active = false;
    N.connecting = false;
    N.phase = "idle";
    $n("joinBtn").disabled = false;
    window.showScreen("online");
    setStatus("❌ کد روم پیدا نشد. اگه کد درسته، یعنی به سرور میزبان نرسیدیم؛ دوباره تلاش کن.");
    renderRejoin();
  }, 12000);
}

// تماس میزبان برقرار شد: پایان حالت «در حال اتصال» و ورود به لابی/بازی
function guestContacted() {
  if (N.finishHello) {
    try { N.finishHello(); } catch (e) { /* بی‌اهمیت */ }
    N.finishHello = null;
  }
  if (N.connecting) {
    N.connecting = false;
    N.active = true;
    N.lastState = Date.now();
    $n("joinBtn").disabled = false;
    setStatus("");
    saveSession();
    startWatch();
    openLobby("مهمان");
  }
}

function onGuestMessage(topic, msg) {
  const raw = msg.toString();

  if (topic === `${N.root}/host`) {
    // بستن عمدی روم توسط میزبان: مرگ فوری. خداحافظی (bye) ممکن است فقط
    // رفرش کوتاه باشد پس فقط وارد انتظار می‌شویم؛ پیام bye مهمان‌ها نادیده.
    if (raw.indexOf("closed:") === 0) {
      realHostGone();
      return;
    }
    if (N.hostId && raw === "bye:" + N.hostId) setWaiting(true);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!data || data.from === N.myId) return;

  if (data.t === "full") {
    N.active = false;
    N.connecting = false;
    if (N.finishHello) {
      try { N.finishHello(); } catch (e) { /* بی‌اهمیت */ }
      N.finishHello = null;
    }
    if (N.client) N.client.end(true);
    N.client = null;
    $n("joinBtn").disabled = false;
    clearSession();
    window.showScreen("online");
    setStatus("❌ این روم پر است؛ به یک روم دیگر بپیوندید.");
    renderRejoin();
    return;
  }

  if (data.t === "welcome" && topic === `${N.root}/to/${N.myId}`) {
    guestContacted();
    if (data.from) N.hostId = data.from;
    N.lastState = Date.now();
    setWaiting(false);
    N.myIndex = data.you;
    N.max = data.max || N.max;
    N.spies = data.spies || N.spies;
    N.seconds = data.seconds || N.seconds;
    // نقش تازه فقط وقتی نشان داده می‌شود که وسط بازی نباشیم؛ وگرنه همان نقش
    // قبلی را داریم و پریدن به صفحهٔ نقش وسط گفت‌وگو آزاردهنده است.
    if (data.kind && N.phase !== "play" && N.phase !== "reveal") {
      N.role = { kind: data.kind, word: data.word, hint: data.hint };
      N.phase = "role";
      renderNetRole();
    }
    return;
  }

  if (data.t === "state" && topic === `${N.root}/state`) {
    if (data.from) N.hostId = data.from;
    N.lastState = Date.now();
    setWaiting(false);
    N.players = data.players || [];
    N.max = data.max;
    N.spies = data.spies;
    N.seconds = data.seconds;
    N.endsAt = data.endsAt || 0;
    N.timeUp = !!data.timeUp;

    if (data.phase === "reveal" && data.word) {
      N.word = { w: data.word, h: data.hint };
      N.spyIdx = data.spyIdx || [];
      N.roles = data.roles || [];
      N.phase = "reveal";
      renderNetReveal();
      return;
    }
    if (data.phase === "play") {
      const was = N.phase;
      N.phase = "play";
      if (was !== "play") openNetPlay();
      renderNetPlay();
      return;
    }
    if (data.phase === "lobby") {
      N.phase = "lobby";
      N.role = null;
      N.word = null;
      N.spyIdx = [];
      N.endsAt = 0;
      openLobby("مهمان");
    }
  }
}

function realHostGone() {
  stopNetTick();
  stopWatch();
  setWaiting(false);
  window.showScreen("online");
  setStatus("❌ میزبان روم از دسترس خارج شد.");
  N.active = false;
  N.connecting = false;
  N.client = null;
  N.hostId = null;
  N.lastState = 0;
  $n("joinBtn").disabled = false;
  clearSession();
  renderRejoin();
}

/* ---------------- بازیابی روم میزبان (بعد از رفرش اتفاقی) ----------------
   با همان شناسه برمی‌گردد پس کد برای خودش آزاد است؛ بازیکن‌ها، کلمه،
   جاسوس‌ها و تایمر (زمان مطلق) از اسنپ‌شات برمی‌گردد و با اولین همگام‌سازی
   همهٔ مهمان‌ها سر جایشان می‌نشینند. */

async function hostRecover() {
  const s = readHostSnap();
  if (!s || N.active || N.connecting) return;
  setStatus("در حال بازیابی روم…");
  let client;
  try {
    client = await connectAny();
  } catch (e) {
    setStatus("❌ اتصال به سرور ممکن نشد.");
    return;
  }

  N.client = client;
  N.isHost = true;
  N.broker = lastBrokerUrl;
  N.code = s.code;
  N.root = `jasoos/${s.code.toLowerCase()}`;
  N.myId = s.myId;
  N.myName = s.myName || "میزبان";
  N.asPlayer = typeof s.asPlayer === "boolean" ? s.asPlayer : true;
  N.max = s.max || 6;
  N.spies = s.spies || 1;
  N.seconds = s.seconds || 120;
  N.players = s.players || [];
  N.word = s.word || null;
  N.spyIdx = s.spyIdx || [];
  N.spyStreak = s.spyStreak || {};
  N.lastWordIdx = typeof s.lastWordIdx === "number" ? s.lastWordIdx : -1;
  N.phase = s.phase || "lobby";
  N.endsAt = s.endsAt || 0;
  N.timeUp = !!s.timeUp;
  N.role = s.role || null;
  N.myIndex = N.asPlayer ? 0 : -1;
  N.active = true;
  setWaiting(false);

  const free = await claimCode(client, N.root, N.myId);
  if (!free) {
    try { client.end(true); } catch (e) { /* بی‌اهمیت */ }
    N.client = null;
    N.active = false;
    N.isHost = false;
    setStatus("❌ کد روم گرفته شده؛ یک روم تازه بسازید.");
    return;
  }

  client.on("message", onHostMessage);
  client.on("connect", () => {
    pubRaw(`${N.root}/host`, "here:" + N.myId, true);
    syncHostState();
  });
  client.subscribe(`${N.root}/#`);
  setStatus("");
  renderRecover();
  startHeartbeat();
  if (N.phase === "play") {
    openNetPlay();
    renderNetPlay();
  } else if (N.phase === "role") {
    if (N.asPlayer && N.role) renderNetRole();
    else openNetPlay();
  } else if (N.phase === "reveal" && N.word) {
    N.roles = seatList().map((p) => ({ i: p.i, name: p.name, host: !!p.host, spy: N.spyIdx.indexOf(p.i) !== -1 }));
    renderNetReveal();
  } else {
    N.phase = "lobby";
    openLobby("میزبان");
  }
  syncHostState();
}

/* ---------------- شروع و افشا (میزبان) ---------------- */

function netStart() {
  if (!N.isHost) return;
  if (seatList().length < MIN_PLAYERS) return;
  if (typeof WORDS === "undefined" || !WORDS.length) {
    setStatus("❌ فایل کلمات بارگذاری نشد؛ صفحه را کامل ببند و با اینترنت دوباره باز کن.");
    return;
  }
  const picked = pickWordAvoidRepeat(N.lastWordIdx);
  N.lastWordIdx = picked.idx;
  N.word = picked.word;
  const seats = activeSeats();
  const count = Math.max(1, Math.min(N.spies, Math.floor(seats.length / 2)));
  N.spyIdx = drawSpiesFairFrom(seats, count, N.spyStreak);
  seats.forEach((i) => {
    N.spyStreak[i] = N.spyIdx.indexOf(i) !== -1 ? (N.spyStreak[i] || 0) + 1 : 0;
  });
  N.phase = "role";
  N.endsAt = 0;
  N.timeUp = false;

  N.players.forEach((p) => sendWelcome(p, giveRole(p.i)));
  N.role = N.asPlayer ? giveRole(0) : null;
  syncHostState();
  if (N.asPlayer) renderNetRole();
  else openNetPlay();
}

function netStartTalk() {
  if (!N.isHost) return;
  if (!N.endsAt) {
    N.endsAt = Date.now() + N.seconds * 1000;
    N.timeUp = false;
    N.phase = "play";
    syncHostState();
    openNetPlay();
  } else {
    netReveal();
  }
}

function netShift(delta) {
  if (!N.isHost) return;
  if (N.timeUp) {
    if (delta <= 0) return;
    N.timeUp = false;
    N.endsAt = Date.now() + delta * 1000;
  } else {
    if (!N.endsAt) return;
    N.endsAt = Math.max(Date.now() + 3000, N.endsAt + delta * 1000);
  }
  syncHostState();
  renderNetPlay();
}

function netReveal() {
  if (!N.isHost || !N.word) return;
  N.phase = "reveal";
  N.endsAt = 0;
  N.timeUp = false;
  N.roles = seatList().map((p) => ({ i: p.i, name: p.name, host: !!p.host, spy: N.spyIdx.indexOf(p.i) !== -1 }));
  stopNetTick();
  syncHostState();
  renderNetReveal();
}

function netAgain() {
  if (!N.isHost) return;
  N.phase = "lobby";
  N.word = null;
  N.spyIdx = [];
  N.role = null;
  N.endsAt = 0;
  N.timeUp = false;
  stopNetTick();
  syncHostState();
  openLobby("میزبان");
}

/* ---------------- ضربان میزبان و نگهبان مهمان ----------------
   میزبان هر ۱۰ ثانیه وضعیت را همگام می‌کند تا مهمان‌ها بفهمند روم زنده است؛
   اگر خبری از میزبان نباشد، مهمان اول وارد «انتظار» می‌شود و فقط بعد از
   سکوت طولانی روم را مرده حساب می‌کند (فرصت برای رفرش و برگشتن میزبان). */

const HEART_MS = 10000;
const GRACE_MS = 25000;
const DEATH_MS = 70000;

function startHeartbeat() {
  stopHeartbeat();
  N.heartId = setInterval(() => {
    if (N.isHost && N.client && N.phase !== "idle") syncHostState();
  }, HEART_MS);
}

function stopHeartbeat() {
  if (N.heartId) clearInterval(N.heartId);
  N.heartId = null;
}

function startWatch() {
  stopWatch();
  N.watchId = setInterval(watchTick, 5000);
}

function stopWatch() {
  if (N.watchId) clearInterval(N.watchId);
  N.watchId = null;
}

function watchTick() {
  if (!N.active || N.isHost || N.connecting || N.phase === "idle") return;
  const silent = Date.now() - (N.lastState || 0);
  if (silent > DEATH_MS) realHostGone();
  else if (silent > GRACE_MS || N.waitingHost) setWaiting(true);
}

function setWaiting(on) {
  N.waitingHost = !!on;
  const bar = $n("waitBar");
  if (bar) bar.hidden = !on;
}

/* ---------------- ترک روم ---------------- */

function netLeave() {
  stopNetTick();
  stopHeartbeat();
  stopWatch();
  setWaiting(false);
  if (N.client) {
    try {
      // بستن واقعی روم (مهمان‌ها فوراً می‌فهمند) + پاک کردن نشانهٔ روم
      if (N.isHost) pubRaw(`${N.root}/host`, "closed:" + N.myId, false);
      N.client.publish(`${N.root}/host`, "", { qos: 1, retain: true });
      N.client.end(true);
    } catch (e) { /* اتصال از قبل بسته شده */ }
  }
  N.client = null;
  N.active = false;
  N.connecting = false;
  N.isHost = false;
  N.players = [];
  N.role = null;
  N.word = null;
  N.phase = "idle";
  N.myIndex = -1;
  N.hostId = null;
  N.lastState = 0;
  setStatus("");
  clearSession();
  clearHostSnap();
  window.showScreen("online");
  renderRejoin();
  renderRecover();
}

/* ---------------- نمایش ---------------- */

function readName() {
  const v = ($n("nameInput") && $n("nameInput").value.trim()) || "";
  const name = v || "بازیکن";
  try { localStorage.setItem("spy-name", name); } catch (e) { /* حالت خصوصی */ }
  return name;
}

function openLobby(tag) {
  stopNetTick();
  $n("lobbyTag").textContent = tag === "میزبان" ? "میزبان روم" : "مهمان";
  $n("roomCode").textContent = N.code;
  $n("hostSettings").hidden = !N.isHost;
  $n("lobbyHint").textContent = N.isHost
    ? "این کد را برای دوستانتان بفرستید تا با گوشی خودشان وارد شوند"
    : "منتظر میزبان… صفحه را باز نگه دارید";
  renderNetChips();
  renderLobby();
  window.showScreen("lobby");
}

function renderLobby() {
  $n("roomCode").textContent = N.code;
  $n("netRoleNote").textContent = N.isHost
    ? N.asPlayer
      ? "شما بازیکن ۱ هستید. نقش‌ها بین همهٔ بازیکنان از جمله شما قرعه‌کشی می‌شود."
      : "شما فقط میزبانید و نقشی نمی‌گیرید؛ دکمه‌های شروع و افشا با شماست."
    : "";
  const seats = seatList();
  $n("lobbySeats").innerHTML = seats
    .map(
      (p) =>
        `<span class="seat with-name ${p.i === N.myIndex ? "now" : "seen"}"><b>${window.SPY_FA(p.i + 1)}${p.host ? " 👑" : ""}</b><i>${esc(p.name)}</i></span>`
    )
    .join("") +
    // کارت «میزبان» فقط وقتی که میزبان داور است؛ در حالت بازیکن، خودش
    // صندلی ۱ را دارد و کارت دوم تکراری می‌شد.
    (N.isHost && !N.asPlayer
      ? `<span class="seat with-name master"><b>🎯</b><i>${esc(N.myName)} (میزبان)</i></span>`
      : "");
  const n = seatList().length;
  $n("lobbyCount").textContent = `${window.SPY_FA(n)} بازیکن حاضر — حداکثر ${window.SPY_FA(N.max)}`;
  // سرور متصل را نشان بده تا اگر میزبان و مهمان روی سرورهای متفاوت‌اند معلوم شود
  const bn = $n("brokerNote");
  if (bn) bn.textContent = N.broker ? "server: " + shortBroker(N.broker) : "";
  if (N.isHost) {
    const btn = $n("netStartBtn");
    const ready = n >= MIN_PLAYERS;
    btn.disabled = !ready;
    btn.textContent = ready
      ? "شروع بازی و پخش نقش‌ها"
      : `${window.SPY_FA(MIN_PLAYERS - n)} بازیکن دیگر لازم است تا بازی شروع شود (${window.SPY_FA(n)} از ${window.SPY_FA(MIN_PLAYERS)})`;
  }
}

function renderNetChips() {
  if (!N.isHost) return;
  if (ctlMax) ctlMax.setSilent(N.max);
  if (ctlTime) ctlTime.setSilent(N.seconds);
  if (segSpy) segSpy.set(N.spies);
  if (segRole) segRole.set(N.asPlayer);
  $n("roleOut").textContent = N.asPlayer ? "بازیکن" : "داور";
  $n("netMaxOut").textContent = window.SPY_FA(N.max);
  $n("netSpiesOut").textContent = window.SPY_FA(N.spies);
  $n("netTimeOut").textContent = window.SPY_TIME_LABEL(N.seconds);
}

function renderNetRole() {
  const r = N.role || {};
  const isSpy = r.kind === "spy";
  $n("netRoleBadge").textContent = `شما • بازیکن ${window.SPY_FA((N.myIndex < 0 ? 0 : N.myIndex) + 1)}`;
  $n("netRoleCard").classList.toggle("is-spy", isSpy);
  $n("netRoleCard").classList.toggle("is-agent", !isSpy);
  $n("netRoleSecret").textContent = isSpy ? "تو جاسوسی!" : r.word || "—";
  $n("netRoleSecret").classList.toggle("spy-word", isSpy);
  $n("netRoleKicker").textContent = isSpy ? "این راهنما فقط برای توست" : "این کلمه را به کسی نگو";
  $n("netHintBox").hidden = !isSpy;
  $n("netHintWord").textContent = isSpy ? r.hint : "";
  $n("netRoleHelp").textContent = isSpy
    ? "کلمهٔ اصلی را نمی‌دانی؛ فقط همین راهنما را داری. طوری حرف بزن که انگار کلمه را می‌دانی تا کسی به تو شک نکند!"
    : "تو جاسوس نیستی؛ دربارهٔ کلمه حرف بزن ولی آن‌قدر واضح نگو که جاسوس بفهمد!";
  window.showScreen("netrole");
}

function openNetPlay() {
  $n("netHostControls").hidden = !N.isHost;
  $n("netPlayHint").textContent = N.isHost
    ? "میزبان تویی؛ با «شروع گفت‌وگو» بحث را راه بینداز."
    : "دربارهٔ کلمه حرف بزن و حدس بزن جاسوس کیست!";
  $n("netRingFg").style.strokeDashoffset = 0;
  $n("netTimerNum").parentElement.classList.remove("hurry");
  $n("netPlayNote").textContent = "";
  $n("netMinusBtn").disabled = true;
  $n("netTalkBtn").textContent = N.endsAt ? "پایان و افشا" : "شروع گفت‌وگو";
  window.showScreen("netplay");
  startNetTick();
}

function startNetTick() {
  stopNetTick();
  N.tickId = setInterval(() => {
    if (N.phase !== "play") return;
    const total = N.seconds * 1000;
    const left = N.timeUp ? 0 : N.endsAt ? Math.max(0, N.endsAt - Date.now()) : total;
    $n("netTimerNum").textContent = window.SPY_FA(Math.ceil(left / 1000));
    $n("netRingFg").style.strokeDashoffset = NET_RING * (1 - Math.min(1, left / total));
    $n("netTimerNum").parentElement.classList.toggle("hurry", left > 0 && left <= 10000);

    if (N.isHost) {
      $n("netTalkBtn").textContent = "پایان و افشا";
      $n("netMinusBtn").disabled = !N.endsAt || N.timeUp;
      if (N.endsAt && !N.timeUp && left <= 0) {
        N.timeUp = true;
        setNetNote("⏱ زمان تمام شد — تا وقتی «پایان و افشا» را نزنید، کلمه دیده نمی‌شود.");
        $n("netMinusBtn").disabled = true;
        $n("netTimerNum").parentElement.classList.remove("hurry");
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
        syncHostState();
      }
    } else if (N.timeUp) {
      setNetNote("⏱ زمان تمام شد — منتظر دکمهٔ میزبان برای افشای کلمه…");
      $n("netTimerNum").parentElement.classList.remove("hurry");
    }
  }, 250);
}

function setNetNote(text) {
  if ($n("netPlayNote").textContent !== text) $n("netPlayNote").textContent = text;
}

function stopNetTick() {
  if (N.tickId) clearInterval(N.tickId);
  N.tickId = null;
}

function renderNetPlay() {
  $n("netSeats").innerHTML = seatList()
    .map((p) => `<span class="seat seen">${window.SPY_FA(p.i + 1)}${p.host ? " 👑" : ""}</span>`)
    .join("");
  if (N.isHost && N.endsAt) $n("netTalkBtn").textContent = "پایان و افشا";
}

function renderNetReveal() {
  stopNetTick();
  $n("revealKicker").textContent = "کلمهٔ این دور";
  $n("revealWord").textContent = N.word ? N.word.w : "";
  const seats = seatList();
  const spyNames = N.spyIdx.map((i) => {
    const p = findIn(seats, (x) => x.i === i);
    return p ? p.name : "بازیکن " + window.SPY_FA(i + 1);
  });
  $n("revealList").innerHTML =
    N.spyIdx.map((i) => {
      const p = findIn(seats, (x) => x.i === i);
      const label = p ? esc(p.name) : window.SPY_FA(i + 1);
      return `<span class="reveal-tag spy">🕵️ ${label} — جاسوس</span>`;
    }).join("") +
    (N.word ? `<span class="reveal-tag">راهنما: ${esc(N.word.h)}</span>` : "");
  $n("revealMsg").textContent = spyNames.length
    ? `جاسوس: ${spyNames.join(" و ")}`
    : "—";
  $n("revealAll").innerHTML = N.roles.length
    ? `<details><summary>نقش همهٔ بازیکنان</summary><div class="reveal-all-list">${N.roles
        .map(
          (r) =>
            `<span class="reveal-tag ${r.spy ? "spy" : ""}">${esc(r.name)}${r.host ? " 👑" : ""} — ${r.spy ? "جاسوس" : "کلمه را داشت"}</span>`
        )
        .join("")}</div></details>`
    : "";
  $n("againBtn").hidden = !N.isHost;
  $n("menuBtn").textContent = N.isHost ? "بستن روم" : "خروج از روم";
  window.showScreen("reveal");
}

/* ---------------- ابزارها ---------------- */

function shuffleArray(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

/* ---------- قرعه‌کشی امن و عادلانه (مشترک با منطق نسخهٔ حضوری) ----------
   رندوم واقعی با crypto؛ هیچ صندلی بیش از ۲ دور پشت‌سرهم جاسوس نمی‌شود؛
   در بقیهٔ حالت‌ها شانس همهٔ صندلی‌ها دقیقاً مساوی است. */
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

function secureShuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = secureInt(i + 1);
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

function drawSpiesFairFrom(seats, spyCount, streak) {
  const n = Math.max(1, Math.min(spyCount, seats.length));
  const eligible = seats.filter((i) => (streak[i] || 0) < 2);
  let pool;
  if (eligible.length >= n) {
    pool = eligible;
  } else {
    const rest = secureShuffle(seats.filter((i) => (streak[i] || 0) >= 2));
    rest.sort((a, b) => (streak[a] || 0) - (streak[b] || 0));
    pool = eligible.concat(rest);
  }
  return secureShuffle(pool).slice(0, n);
}

function pickWordAvoidRepeat(lastIdx) {
  if (WORDS.length < 2) return { idx: 0, word: WORDS[0] };
  let idx = secureInt(WORDS.length);
  if (idx === lastIdx) idx = (idx + 1 + secureInt(WORDS.length - 1)) % WORDS.length;
  return { idx, word: WORDS[idx] };
}

/* ---------------- اتصال رویدادها ---------------- */

function initOnline() {
  if (!$n("brokerInput")) return;
  if (!$n("brokerInput").value) $n("brokerInput").value = NET_BROKERS[0];

  if (typeof mqtt === "undefined") {
    $n("tabJoin").disabled = true;
    $n("tabCreate").disabled = true;
    $n("joinBtn").disabled = true;
    $n("createBtn").disabled = true;
    $n("codeInput").disabled = true;
    $n("nameInput").disabled = true;
    setStatus("❌ بازی آنلاین بارگذاری نشد؛ صفحه را دوباره باز کنید. بازی حضوری در دسترس است.");
    return;
  }
  try {
    const saved = localStorage.getItem("spy-name");
    if (saved) $n("nameInput").value = saved;
  } catch (e) { /* حالت خصوصی */ }

  const room = new URLSearchParams(location.search).get("room");
  if (room) {
    $n("codeInput").value = room.toUpperCase().slice(0, 6);
    switchPane(true);
  }

  $n("tabJoin").addEventListener("click", () => switchPane(true));
  $n("tabCreate").addEventListener("click", () => switchPane(false));
  $n("createBtn").addEventListener("click", hostCreate);
  $n("joinBtn").addEventListener("click", () => guestJoin($n("codeInput").value));
  $n("rejoinBtn").addEventListener("click", () => {
    const s = rejoinSession;
    if (!s) return;
    $n("nameInput").value = s.myName || "";
    switchPane(true);
    guestJoin(s.code, s.myId);
  });
  $n("recoverBtn").addEventListener("click", hostRecover);
  renderRejoin();
  renderRecover();
  $n("codeInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  $n("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") guestJoin($n("codeInput").value);
  });
  $n("nameInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[<>]/g, "").slice(0, 14);
  });

  $n("copyCodeBtn").addEventListener("click", async () => {
    const done = await copyText(N.code);
    flash(done ? "کد کپی شد ✓" : "کد روم: " + N.code);
  });
  $n("shareBtn").addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?room=${N.code}`;
    if (navigator.share) {
      navigator.share({ title: "بازی جاسوس", text: `با این کد به روم بیا: ${N.code}`, url }).catch(() => {});
      return;
    }
    const done = await copyText(url);
    flash(done ? "لینک روم کپی شد ✓" : "لینک: " + url);
  });

  if (window.SPY_UI) {
    segRole = window.SPY_UI.bindSeg("netRoleSeg", "asplayer", (v) => {
      if (N.phase !== "lobby") {
        segRole.set(N.asPlayer);
        return;
      }
      N.asPlayer = v;
      N.myIndex = v ? 0 : -1;
      N.role = null;
      renderNetChips();
      renderLobby();
      syncHostState();
    });
    ctlMax = window.SPY_UI.bindSlider({
      range: "netMaxRange",
      out: "netMaxOut",
      minus: "netMaxMinus",
      plus: "netMaxPlus",
      label: window.SPY_FA,
      onChange: (v) => { N.max = v; renderNetChips(); syncHostState(); },
    });
    segSpy = window.SPY_UI.bindSeg("netSpySeg", "nspies", (v) => {
      N.spies = v;
      renderNetChips();
      syncHostState();
    });
    ctlTime = window.SPY_UI.bindSlider({
      range: "netTimeRange",
      out: "netTimeOut",
      minus: "netTimeMinus",
      plus: "netTimePlus",
      label: window.SPY_TIME_LABEL,
      onChange: (v) => { N.seconds = v; renderNetChips(); syncHostState(); },
    });
    // همگام‌سازی اولیهٔ کنترل‌ها با وضعیت
    renderNetChips();
  }

  $n("netStartBtn").addEventListener("click", netStart);
  $n("netHideBtn").addEventListener("click", () => {
    N.role = null;
    openNetPlay();
  });
  $n("netTalkBtn").addEventListener("click", netStartTalk);
  $n("netPlusBtn").addEventListener("click", () => netShift(30));
  $n("netMinusBtn").addEventListener("click", () => netShift(-30));
  $n("netLeaveBtn").addEventListener("click", netLeave);

  window.addEventListener("beforeunload", () => {
    if (N.client) {
      try { N.client.publish(`${N.root}/host`, "bye:" + N.myId, { qos: 0, retain: false }); } catch (e) { /* بی‌اهمیت */ }
    }
  });

  initOnline.done = true;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* دسترسی نیست */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand("copy");
    document.body.removeChild(ta);
    return done;
  } catch (e) {
    return false;
  }
}

function switchPane(join) {
  N.joinPaneOn = join;
  $n("tabJoin").classList.toggle("on", join);
  $n("tabCreate").classList.toggle("on", !join);
  $n("joinPane").hidden = !join;
  $n("createPane").hidden = join;
  setStatus("");
}

function flash(msg) {
  const prev = $n("lobbyHint").textContent;
  $n("lobbyHint").textContent = msg;
  setTimeout(() => {
    $n("lobbyHint").textContent = prev;
  }, 1600);
}

window.NET = {
  N,
  init: initOnline,
  isActive: () => N.active,
  seats: seatList,
  activeSeats,
  hostCreate,
  guestJoin,
  start: netStart,
  again: netAgain,
  leave: netLeave,
  reveal: netReveal,
  startTalk: netStartTalk,
  showRole: renderNetRole,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOnline);
} else {
  initOnline();
}
