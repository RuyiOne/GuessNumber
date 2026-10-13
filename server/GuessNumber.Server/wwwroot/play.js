const statusEl = document.querySelector("#status");
const accountEl = document.querySelector("#account");
const lobbyEl = document.querySelector("#lobby");
const secretPanel = document.querySelector("#secret-panel");
const boardEl = document.querySelector("#board");
const guessInput = document.querySelector("#guess");
let token = sessionStorage.getItem("gn-token") || "";
let displayName = sessionStorage.getItem("gn-name") || "";
let connection = null;
let shownResultFor = "";
let opponentKey = "";
let confettiFrame = 0;
let ownSecret = sessionStorage.getItem("gn-own-secret") || "";
let yourScore = 0;
let yourTurn = false;
let changeUsed = false;
let playing = false;

function say(message) {
  statusEl.textContent = message;
}

function show(element, visible) {
  element.classList.toggle("hidden", !visible);
}

function hubMessage(error) {
  const text = error?.message || String(error);
  const split = text.split(":");
  return split.length > 1 ? split.slice(1).join(":").trim() : text;
}

function codeProblem(value) {
  if (!value) return "";
  if (/[^0-9]/.test(value)) return "Use digits only.";
  if (value.includes("0")) return "0 is not allowed. Use digits from 1 to 9.";
  if (value.length < 4) return "Enter all four digits.";
  if (new Set(value).size < 4) return "That number repeats a digit. Each digit must be different.";
  return "";
}

function validCode(value) {
  return codeProblem(value) === "" && value.length === 4;
}

function showNote(element, message, kind) {
  element.textContent = message;
  element.classList.toggle("reject", kind === "reject");
  element.classList.toggle("ok", kind === "ok");
}

function rememberSecret(code) {
  ownSecret = code;
  sessionStorage.setItem("gn-own-secret", code);
  paintSecret();
}

function forgetSecret() {
  ownSecret = "";
  sessionStorage.removeItem("gn-own-secret");
  paintSecret();
}

function paintSecret(changing) {
  const holder = document.querySelector("#current-secret");
  holder.replaceChildren();
  const marked = new Set(changing || []);
  if (!ownSecret) {
    holder.textContent = "will appear here once you set it";
    return;
  }
  for (let index = 0; index < ownSecret.length; index += 1) {
    const cell = document.createElement("span");
    cell.textContent = ownSecret[index];
    if (marked.has(index)) cell.className = "changing";
    holder.append(cell);
  }
}

function describeChange(next) {
  const problem = codeProblem(next);
  if (!next)
    return { ok: false, message: "Type the new secret. Digits must be from 1 to 9, all different, and exactly two positions must change." };
  if (problem) return { ok: false, message: problem };
  if (!ownSecret)
    return { ok: false, message: "Your current secret is not on this page, so the two changed positions cannot be checked." };
  const positions = [];
  for (let index = 0; index < 4; index += 1) {
    if (ownSecret[index] !== next[index]) positions.push(index);
  }
  if (positions.length !== 2) {
    const count = positions.length === 1 ? "1 position" : `${positions.length} positions`;
    return { ok: false, message: `That changes ${count}. Change exactly two positions of ${ownSecret}.`, positions };
  }
  const labels = positions.map((index) => index + 1).join(" and ");
  return {
    ok: true,
    positions,
    message: `Positions ${labels} will change, from ${ownSecret} to ${next}. This costs 25 points and uses your turn.`
  };
}

function reviewChange() {
  const next = document.querySelector("#new-secret").value.trim();
  const verdict = describeChange(next);
  const blocks = [];
  if (playing && changeUsed) blocks.push("You have already changed your number in this game.");
  else if (playing && yourScore < 25) blocks.push(`Your score is ${yourScore}, which is below 25, so the number cannot be changed.`);
  if (!verdict.ok && (next || blocks.length === 0)) blocks.push(verdict.message);
  const ok = verdict.ok && blocks.length === 0;
  const refused = Boolean(next) || (playing && (changeUsed || yourScore < 25));
  showNote(document.querySelector("#change-note"), blocks.join(" ") || verdict.message, ok ? "ok" : refused ? "reject" : "");
  paintSecret(verdict.positions || []);
  document.querySelector("#change-submit").disabled = !ok || !yourTurn;
  return ok ? verdict : null;
}

const newSecretInput = document.querySelector("#new-secret");
const keys = document.querySelector("#keys");
for (const digit of "123456789") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = digit;
  button.addEventListener("click", () => {
    const target = document.activeElement === newSecretInput ? newSecretInput : guessInput;
    if (target.disabled || target.value.length >= 4) return;
    target.value += digit;
    target.dispatchEvent(new Event("input"));
  });
  keys.append(button);
}

function render(snapshot) {
  const state = snapshot.state;
  const byTurn = new Map();
  for (const move of state.moves) {
    if (!byTurn.has(move.turn)) byTurn.set(move.turn, [{}, {}]);
    byTurn.get(move.turn)[move.player] = move;
  }
  const body = document.querySelector("#rows");
  body.replaceChildren();
  for (const [, cells] of byTurn) {
    const row = document.createElement("tr");
    for (const cell of cells) {
      const item = document.createElement("td");
      if (cell.kind === "guess") {
        item.innerHTML = `<div>${cell.guess}</div><div class="muted">${cell.dead} dead, ${cell.wounded} wounded</div>`;
      } else if (cell.kind === "change") {
        item.textContent = "−25";
      } else if (cell.kind === "resign") {
        item.textContent = "Resigned";
      }
      row.append(item);
    }
    body.append(row);
  }
  document.querySelector("#score-you").textContent = state.scores[0];
  document.querySelector("#score-computer").textContent = state.scores[1];

  const playingNow = state.phase === "InProgress" || state.phase === "FinalTurn";
  playing = playingNow;
  yourScore = state.scores[0];
  yourTurn = state.currentPlayer === 0 && playingNow;
  changeUsed = state.moves.some((move) => move.kind === "change" && move.player === 0);
  show(secretPanel, state.phase === "AwaitingSecrets");
  show(boardEl, playingNow || state.phase === "Finished");
  show(document.querySelector("#change-form"), playingNow);
  show(lobbyEl, false);
  document.querySelector("#guess-form").querySelectorAll("button, input").forEach((control) => {
    control.disabled = !yourTurn;
  });
  document.querySelector("#new-secret").disabled = !yourTurn;
  reviewChange();

  if (state.phase === "AwaitingSecrets") say("Choose a secret of four different digits from 1 to 9.");
  else if (state.phase === "Finished") say(outcomeTitle(state) + ".");
  else if (yourTurn) say("Your turn.");
  else say("The computer is thinking.");
  if (state.phase !== "Finished" && state.announcedChangeTurns?.length) {
    const turn = state.announcedChangeTurns.at(-1);
    if (state.moves.some((move) => move.kind === "change" && move.player === 1 && move.turn === turn))
      say(`The computer changed its number on turn ${turn}.`);
  }
  presentResult(snapshot);
}

function outcomeTitle(state) {
  const last = state.moves.at(-1);
  if (last && last.kind === "resign")
    return state.winner === 0 ? "The computer resigned" : "You resigned";
  return state.winner === 0 ? "You solved it first" : "The computer solved it first";
}

function presentResult(snapshot) {
  const state = snapshot.state;
  if (state.phase !== "Finished" || shownResultFor === snapshot.gameId) return;
  shownResultFor = snapshot.gameId;
  document.querySelector("#result-title").textContent = outcomeTitle(state);
  document.querySelector("#result-copy").textContent = "Would you like to continue, or exit and see your record?";
  show(document.querySelector("#result"), true);
  document.querySelector("#continue").focus();
  if (state.winner === 0) celebrate();
}

function celebrate() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.querySelector("#confetti");
  const context = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  show(canvas, true);
  const colours = ["#8c3a2f", "#c4a574", "#e8c872", "#2f6b4f", "#d4762c", "#efe4d2"];
  const pieces = [];
  for (let index = 0; index < 140; index += 1) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: -24 - Math.random() * canvas.height * 0.45,
      w: 6 + Math.random() * 7,
      h: 9 + Math.random() * 8,
      vx: -2.4 + Math.random() * 4.8,
      vy: 2 + Math.random() * 3.5,
      spin: Math.random() * Math.PI,
      spinV: -0.18 + Math.random() * 0.36,
      colour: colours[index % colours.length]
    });
  }
  cancelAnimationFrame(confettiFrame);
  const started = performance.now();
  function frame(now) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    let falling = false;
    for (const piece of pieces) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vy += 0.045;
      piece.spin += piece.spinV;
      if (piece.y < canvas.height + 24) falling = true;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.spin);
      context.fillStyle = piece.colour;
      context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      context.restore();
    }
    if (falling && now - started < 4200) confettiFrame = requestAnimationFrame(frame);
    else {
      context.clearRect(0, 0, canvas.width, canvas.height);
      show(canvas, false);
    }
  }
  confettiFrame = requestAnimationFrame(frame);
}

function stopCelebration() {
  cancelAnimationFrame(confettiFrame);
  const canvas = document.querySelector("#confetti");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  show(canvas, false);
}

function leaveGame() {
  stopCelebration();
  show(document.querySelector("#result"), false);
  show(boardEl, false);
  show(secretPanel, false);
  guessInput.value = "";
  newSecretInput.value = "";
  forgetSecret();
}

async function showRecord() {
  const lead = document.querySelector("#record-lead");
  const body = document.querySelector("#record-rows");
  show(document.querySelector("#record"), true);
  body.replaceChildren();
  lead.textContent = "Loading your record…";
  let opponents = [];
  try {
    const response = await fetch("/api/record", { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("record");
    opponents = (await response.json()).opponents || [];
  } catch {
    lead.textContent = "Your record could not be loaded.";
    say("Your record could not be loaded.");
    return;
  }

  const current = opponents.find((row) => row.key === opponentKey);
  if (current)
    lead.textContent = `Against ${current.name} you have won ${current.won} and lost ${current.lost}.`;
  else if (opponents.length === 0)
    lead.textContent = "No finished games are recorded yet.";
  else
    lead.textContent = "Finished games against each opponent.";

  for (const row of opponents) {
    const line = document.createElement("tr");
    if (row.key === opponentKey) line.className = "current";
    for (const value of [row.name, row.won, row.lost]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      line.append(cell);
    }
    body.append(line);
  }
  say("Your record.");
}

async function connect() {
  if (!window.signalR) {
    say("The game script did not load. Restart the server and refresh this page.");
    return;
  }
  connection = new signalR.HubConnectionBuilder()
    .withUrl("/hubs/game", { accessTokenFactory: () => token })
    .withAutomaticReconnect()
    .build();
  connection.on("OpponentChangedSecret", (turn) => say(`Your opponent changed their number on turn ${turn}.`));
  await connection.start();
  show(accountEl, false);
  show(lobbyEl, true);
  document.querySelector("#who").textContent = displayName;
  say("Ready to play.");
}

async function signedIn(payload, name) {
  token = payload.token;
  displayName = name;
  sessionStorage.setItem("gn-token", token);
  sessionStorage.setItem("gn-name", displayName);
  await connect();
}

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    say("That email or password was not recognised.");
    return;
  }
  await signedIn(await response.json(), document.querySelector("#display-name").value.trim() || email);
});

document.querySelector("#register").addEventListener("click", async () => {
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const name = document.querySelector("#display-name").value.trim();
  if (!email || !name || password.length < 8) {
    say("Enter a name, an email and a password of at least 8 characters.");
    return;
  }
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: name })
  });
  if (!response.ok) {
    say("That account could not be created. Try another email.");
    return;
  }
  const login = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  await signedIn(await login.json(), name);
});

const agentSelect = document.querySelector("#agent");
const perBox = document.querySelector("#per");
agentSelect.addEventListener("change", () => {
  const sampling = agentSelect.value === "swor";
  perBox.disabled = sampling;
  if (sampling) perBox.checked = false;
});

document.querySelector("#play").addEventListener("click", async () => {
  try {
    forgetSecret();
    newSecretInput.value = "";
    const agent = agentSelect.value;
    const per = agent !== "swor" && perBox.checked;
    opponentKey = `computer:${agent}:${per}`;
    const snapshot = await connection.invoke("CreateGame", {
      ruleset: "classic4",
      numberChange: "once",
      changeCost: 25,
      changeDigits: 2,
      notifyOnChange: true,
      changeConsumesTurn: true,
      turnTimerSec: 0,
      equalTurns: false,
      opponent: {
        kind: "computer",
        agent,
        per,
        allowComputerChange: false,
        changePolicy: "never"
      }
    });
    render(snapshot);
  } catch (error) {
    say(hubMessage(error));
  }
});

document.querySelector("#secret").addEventListener("input", () => {
  const problem = codeProblem(document.querySelector("#secret").value.trim());
  showNote(document.querySelector("#secret-note"), problem, problem ? "reject" : "");
});

document.querySelector("#secret-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const secret = document.querySelector("#secret").value.trim();
  const problem = codeProblem(secret);
  if (problem || !validCode(secret)) {
    const message = problem || "Use four different digits from 1 to 9.";
    showNote(document.querySelector("#secret-note"), message, "reject");
    say(message);
    return;
  }
  try {
    rememberSecret(secret);
    render(await connection.invoke("SetSecret", secret));
  } catch (error) {
    forgetSecret();
    const message = hubMessage(error);
    showNote(document.querySelector("#secret-note"), message, "reject");
    say(message);
  }
});

guessInput.addEventListener("input", () => {
  const problem = codeProblem(guessInput.value.trim());
  showNote(document.querySelector("#guess-note"), problem, problem ? "reject" : "");
});

document.querySelector("#guess-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const guess = guessInput.value.trim();
  const problem = codeProblem(guess);
  if (problem || !validCode(guess)) {
    const message = problem || "Use four different digits from 1 to 9.";
    showNote(document.querySelector("#guess-note"), message, "reject");
    say(message);
    return;
  }
  try {
    render(await connection.invoke("SubmitGuess", guess));
    guessInput.value = "";
    showNote(document.querySelector("#guess-note"), "", "");
  } catch (error) {
    const message = hubMessage(error);
    showNote(document.querySelector("#guess-note"), message, "reject");
    say(message);
  }
});

document.querySelector("#clear").addEventListener("click", () => {
  guessInput.value = "";
  showNote(document.querySelector("#guess-note"), "", "");
});

document.querySelector("#resign").addEventListener("click", async () => {
  try {
    render(await connection.invoke("Resign"));
  } catch (error) {
    say(hubMessage(error));
  }
});

newSecretInput.addEventListener("input", () => reviewChange());

document.querySelector("#change-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const verdict = reviewChange();
  if (!verdict) return;
  const next = newSecretInput.value.trim();
  const digits = verdict.positions.map((index) => next[index]).join("");
  try {
    render(await connection.invoke("ChangeSecret", verdict.positions, digits));
    rememberSecret(next);
    newSecretInput.value = "";
    reviewChange();
    showNote(document.querySelector("#change-note"), `Your secret is now ${next}. That was the one change allowed in this game.`, "ok");
  } catch (error) {
    const message = hubMessage(error);
    showNote(document.querySelector("#change-note"), message, "reject");
    say(message);
  }
});

document.querySelector("#continue").addEventListener("click", () => {
  leaveGame();
  show(lobbyEl, true);
  say("Ready to play.");
});

document.querySelector("#exit").addEventListener("click", async () => {
  leaveGame();
  show(lobbyEl, false);
  await showRecord();
});

document.querySelector("#record-back").addEventListener("click", () => {
  show(document.querySelector("#record"), false);
  show(lobbyEl, true);
  say("Ready to play.");
});

reviewChange();

if (token && displayName) connect().catch((error) => say(hubMessage(error)));
