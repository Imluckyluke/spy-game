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
  seconds: 60,
  endsAt: 0,
  timeUp: false,
  word: null,
  spyIdx: [],
  roles: [],
  role: null,
  tickId: null,
  joinPaneOn: true,
};

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const $n = (id) => document.getElementById(id);
const NET_RING = 2 * Math.PI * 52;

const rand = (n) =>
  Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const uid = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const brokerList = () => {
  const custom = ($n("brokerInput") && $n("brokerInput").value.trim()) || "";
  const list = [...NET_BROKERS];
  if (custom) list.unshift(custom);
  return list;
};

const setStatus = (msg) => {
  $n("netStatus").textContent = msg || "";
};

/* ---------------- اتصال ---------------- */

function mqttConnect(url) {
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
    const to = setTimeout(() => finish(new Error("timeout")), 10000);
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
  let lastErr = null;
  for (let i = 0; i < list.length; i++) {
    setStatus(`در حال اتصال به سرور ${i + 1} از ${list.length}…`);
    try {
      return await mqttConnect(list[i]);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("اتصال برقرار نشد");
}

const pub = (topic, obj) => {
  if (N.client) N.client.publish(topic, JSON.stringify(obj), { qos: 0, retain: false });
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
  N.myId = uid();
  N.myName = name;
  N.myIndex = N.asPlayer ? 0 : -1;
  N.players = [];
  N.phase = "lobby";
  N.active = true;

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
  syncHostState();
}

function claimCode(client, root, myId) {
  return new Promise((resolve) => {
    const topic = `${root}/host`;
    let taken = false;
    const onMsg = (t, msg) => {
      const payload = msg && msg.toString ? msg.toString() : "";
      if (payload && payload !== "here:" + myId) taken = true;
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
    const p = N.players.find((x) => x.id === data.id);
    if (p) sendWelcome(p);
  }
}

function seatList() {
  const list = N.players.slice();
  if (N.asPlayer) list.unshift({ i: 0, id: N.myId, name: N.myName, host: true });
  return list;
}

function activeSeats() {
  return seatList().map((p) => p.i);
}

function addGuest(data) {
  const existing = N.players.find((x) => x.id === data.id);
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
  pub(`${N.root}/to/${p.id}`, payload);
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
    msg.roles = seatList().map((p) => ({ i: p.i, name: p.name, host: !!p.host, spy: N.spyIdx.includes(p.i) }));
  }
  pub(`${N.root}/state`, msg);
  if (N.isHost) renderLobby();
}

function giveRole(i) {
  const isSpy = N.spyIdx.includes(i);
  return isSpy
    ? { kind: "spy", word: N.word.w, hint: N.word.h }
    : { kind: "agent", word: N.word.w, hint: N.word.h };
}

/* ---------------- ورود به روم (مهمان) ---------------- */

async function guestJoin(code) {
  code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) {
    setStatus("❌ کد روم باید ۶ حرف باشد.");
    return;
  }
  setStatus("در حال اتصال…");
  let client;
  try {
    client = await connectAny();
  } catch (e) {
    setStatus("❌ اتصال به سرور ممکن نشد.");
    return;
  }

  N.client = client;
  N.isHost = false;
  N.code = code;
  N.root = `jasoos/${code.toLowerCase()}`;
  N.myId = uid();
  N.myName = readName();
  N.myIndex = -1;
  N.players = [];
  N.phase = "lobby";
  N.role = null;
  N.active = true;

  client.on("message", onGuestMessage);
  client.on("connect", () => {
    if (!N.client) return;
    pub(`${N.root}/join`, { t: "hello", from: N.myId, id: N.myId, name: N.myName });
  });
  client.subscribe(`${N.root}/state`);
  client.subscribe(`${N.root}/to/${N.myId}`);
  client.subscribe(`${N.root}/host`);
  openLobby("مهمان");
  setStatus("");
  pub(`${N.root}/join`, { t: "hello", from: N.myId, id: N.myId, name: N.myName });

  setTimeout(() => {
    if (N.phase === "lobby" && N.myIndex === -1) {
      N.active = false;
      if (N.client) N.client.end(true);
      N.client = null;
      window.showScreen("online");
      setStatus("❌ کد روم پیدا نشد؛ مطمئن شو درست وارد کرده‌ای.");
    }
  }, 9000);
}

function onGuestMessage(topic, msg) {
  const raw = msg.toString();

  if (topic === `${N.root}/host`) {
    if (raw.startsWith("bye:")) hostGone();
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
    if (N.client) N.client.end(true);
    N.client = null;
    window.showScreen("online");
    setStatus("❌ این روم پر است؛ به یک روم دیگر بپیوندید.");
    return;
  }

  if (data.t === "welcome" && topic === `${N.root}/to/${N.myId}`) {
    N.myIndex = data.you;
    N.max = data.max || N.max;
    N.spies = data.spies || N.spies;
    N.seconds = data.seconds || N.seconds;
    if (data.kind) {
      N.role = { kind: data.kind, word: data.word, hint: data.hint };
      N.phase = "role";
      renderNetRole();
    }
    return;
  }

  if (data.t === "state" && topic === `${N.root}/state`) {
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

function hostGone() {
  stopNetTick();
  window.showScreen("online");
  setStatus("❌ میزبان روم از دسترس خارج شد.");
  N.active = false;
  N.client = null;
}

/* ---------------- شروع و افشا (میزبان) ---------------- */

function netStart() {
  if (!N.isHost) return;
  if (seatList().length < MIN_PLAYERS) return;
  N.word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const seats = activeSeats();
  const count = Math.max(1, Math.min(N.spies, Math.floor(seats.length / 2)));
  N.spyIdx = shuffleArray(seats).slice(0, count);
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
  N.roles = seatList().map((p) => ({ i: p.i, name: p.name, host: !!p.host, spy: N.spyIdx.includes(p.i) }));
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

/* ---------------- ترک روم ---------------- */

function netLeave() {
  stopNetTick();
  if (N.client) {
    try {
      if (N.isHost) pubRaw(`${N.root}/host`, "bye:" + N.myId, false);
      N.client.publish(`${N.root}/host`, "", { qos: 1, retain: true });
      N.client.end(true);
    } catch (e) { /* اتصال از قبل بسته شده */ }
  }
  N.client = null;
  N.active = false;
  N.isHost = false;
  N.players = [];
  N.role = null;
  N.word = null;
  N.phase = "idle";
  N.myIndex = -1;
  setStatus("");
  window.showScreen("online");
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
  $n("hostSettings").style.display = N.isHost ? "" : "none";
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
    (N.isHost
      ? `<span class="seat with-name master"><b>🎯</b><i>${esc(N.myName)} (میزبان)</i></span>`
      : "");
  const n = seatList().length;
  $n("lobbyCount").textContent = `${window.SPY_FA(n)} بازیکن حاضر — حداکثر ${window.SPY_FA(N.max)}`;
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
  $n("netRoleChips").innerHTML = [
    { v: true, t: "👑 هم بازی می‌کنم" },
    { v: false, t: "🎯 فقط میزبان (بازی نمی‌کنم)" },
  ]
    .map(
      (o) =>
        `<button type="button" class="chip ${N.asPlayer === o.v ? "on" : ""}" data-asplayer="${o.v}">${o.t}</button>`
    )
    .join("");
  $n("netMaxChips").innerHTML = [4, 6, 8, 10, 12]
    .map((n) => `<button type="button" class="chip ${n === N.max ? "on" : ""}" data-max="${n}">${window.SPY_FA(n)} نفر</button>`)
    .join("");
  $n("netSpyChips").innerHTML = [1, 2, 3]
    .map((n) => `<button type="button" class="chip ${n === N.spies ? "on" : ""}" data-nspies="${n}">${window.SPY_FA(n)} جاسوس</button>`)
    .join("");
  $n("netTimeChips").innerHTML = window.SPY_TIMES.map(
    (s) => `<button type="button" class="chip ${s === N.seconds ? "on" : ""}" data-nseconds="${s}">${window.SPY_TIME_LABEL(s)}</button>`
  ).join("");
}

function renderNetRole() {
  const r = N.role || {};
  const isSpy = r.kind === "spy";
  $n("netRoleBadge").textContent = `شما • بازیکن ${window.SPY_FA((N.myIndex < 0 ? 0 : N.myIndex) + 1)}`;
  $n("netRoleCard").classList.toggle("is-spy", isSpy);
  $n("netRoleCard").classList.toggle("is-agent", !isSpy);
  $n("netRoleSecret").textContent = isSpy ? "تو جاسوسی!" : r.word || "—";
  $n("netRoleSecret").classList.toggle("spy-word", isSpy);
  $n("netRoleKicker").textContent = isSpy ? "این راهنما فقط مال توست" : "این کلمه را به کسی نگو";
  $n("netHintBox").hidden = !isSpy;
  $n("netHintWord").textContent = isSpy ? r.hint : "";
  $n("netRoleHelp").textContent = isSpy
    ? "کلمهٔ اصلی را تو هم نمی‌دانی. وانمود کن خبر نداری و بگذار بقیه به تو شک کنند!"
    : "تو جاسوس نیستی. با توضیح زیاد کلمه را لو نده!";
  window.showScreen("netrole");
}

function openNetPlay() {
  $n("netHostControls").style.display = N.isHost ? "" : "none";
  $n("netPlayHint").textContent = N.isHost
    ? "شما میزبانید؛ گفت‌وگو را شروع کنید."
    : "حرف بزنید و صف‌بندی کنید؛ جاسوس نباید لو برود.";
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
    const p = seats.find((x) => x.i === i);
    return p ? p.name : "بازیکن " + window.SPY_FA(i + 1);
  });
  $n("revealList").innerHTML =
    N.spyIdx.map((i) => {
      const p = seats.find((x) => x.i === i);
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
  $n("againBtn").style.display = N.isHost ? "" : "none";
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

/* ---------------- اتصال رویدادها ---------------- */

function initOnline() {
  if (!$n("brokerInput")) return;
  if (!$n("brokerInput").value) $n("brokerInput").value = NET_BROKERS[0];
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

  $n("netRoleChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-asplayer]");
    if (!c || N.phase !== "lobby") return;
    N.asPlayer = c.dataset.asplayer === "true";
    N.myIndex = N.asPlayer ? 0 : -1;
    N.role = null;
    renderNetChips();
    renderLobby();
    syncHostState();
  });
  $n("netMaxChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-max]");
    if (!c) return;
    N.max = Math.max(3, +c.dataset.max);
    renderNetChips();
    syncHostState();
  });
  $n("netSpyChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-nspies]");
    if (!c) return;
    N.spies = +c.dataset.nspies;
    renderNetChips();
    syncHostState();
  });
  $n("netTimeChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-nseconds]");
    if (!c) return;
    N.seconds = +c.dataset.nseconds;
    renderNetChips();
    syncHostState();
  });

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
  $n("joinPane").style.display = join ? "" : "none";
  $n("createPane").style.display = join ? "none" : "";
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
