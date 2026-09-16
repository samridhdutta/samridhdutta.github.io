const COLORS = ["red", "green", "yellow", "blue"];
const COLOR_HEX = { red: "#ef4b5b", green: "#2eb67d", yellow: "#f5bc2e", blue: "#3984e6" };
const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

const PATH = [
  [6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],
  [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],
  [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0]
];

const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE_INDEXES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const HOME_LANES = {
  red: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  green: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
  blue: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
};
const YARDS = {
  red: [[1,1],[1,4],[4,1],[4,4]],
  green: [[1,10],[1,13],[4,10],[4,13]],
  yellow: [[10,10],[10,13],[13,10],[13,13]],
  blue: [[10,1],[10,4],[13,1],[13,4]]
};

const board = document.querySelector("#board");
const setupCard = document.querySelector("#setup-card");
const playCard = document.querySelector("#play-card");
const nameFields = document.querySelector("#name-fields");
const diceEl = document.querySelector("#dice");
const rollButton = document.querySelector("#roll-dice");
const statusText = document.querySelector("#status-text");
const turnName = document.querySelector("#turn-name");
const turnDot = document.querySelector("#turn-dot");
const playerList = document.querySelector("#player-list");
const celebration = document.querySelector("#celebration");
const lobbyCard = document.querySelector("#lobby-card");
const lobbyPlayersEl = document.querySelector("#lobby-players");
const lobbyStatus = document.querySelector("#lobby-status");
const onlineStart = document.querySelector("#online-start");
const connectionError = document.querySelector("#connection-error");

let selectedCount = 4;
let players = [];
let currentPlayer = 0;
let rolled = null;
let gameActive = false;
let busy = false;
let lastDice = null;
let networkMode = false;
let isHost = false;
let myNetworkId = null;
let peer = null;
let hostConnection = null;
let connections = [];
let lobbyPlayers = [];
let roomCode = "";
let maxOnlinePlayers = 3;
let sharedStatus = "Roll the dice to begin.";

function key(row, col) { return `${row}-${col}`; }

function buildBoard() {
  const pathKeys = new Set(PATH.map(([r,c]) => key(r,c)));
  const safeKeys = new Set([...SAFE_INDEXES].map(i => key(...PATH[i])));
  const laneMap = new Map();
  COLORS.forEach(color => HOME_LANES[color].forEach(pos => laneMap.set(key(...pos), color)));
  const yardKeys = new Set(Object.values(YARDS).flat().map(pos => key(...pos)));

  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.cell = key(row, col);
      cell.setAttribute("role", "gridcell");

      if (row < 6 && col < 6) cell.classList.add("quad-red");
      if (row < 6 && col > 8) cell.classList.add("quad-green");
      if (row > 8 && col > 8) cell.classList.add("quad-yellow");
      if (row > 8 && col < 6) cell.classList.add("quad-blue");
      if (pathKeys.has(key(row,col))) cell.classList.add("track");
      if (safeKeys.has(key(row,col))) cell.classList.add("safe");
      if (yardKeys.has(key(row,col))) cell.classList.add("yard-spot");
      if (laneMap.has(key(row,col))) cell.classList.add(`lane-${laneMap.get(key(row,col))}`);

      for (const color of COLORS) {
        if (key(row,col) === key(...PATH[START_INDEX[color]])) cell.classList.add(`start-${color}`);
      }

      if (row >= 6 && row <= 8 && col >= 6 && col <= 8) {
        cell.classList.add("center");
        if (row === 7 && col === 7) cell.classList.add("goal");
        else if (row === 6) cell.classList.add("green");
        else if (row === 8) cell.classList.add("blue");
        else if (col === 6) cell.classList.add("red");
        else cell.classList.add("yellow");
      }
      board.appendChild(cell);
    }
  }
}

function renderNameFields() {
  nameFields.innerHTML = "";
  COLORS.slice(0, selectedCount).forEach((color, index) => {
    const label = document.createElement("label");
    label.className = "name-field";
    label.style.setProperty("--player-color", COLOR_HEX[color]);
    label.innerHTML = `<span></span><input maxlength="14" aria-label="${color} player name" value="${color[0].toUpperCase() + color.slice(1)} Player ${index + 1}">`;
    nameFields.appendChild(label);
  });
}

function startGame() {
  const names = [...nameFields.querySelectorAll("input")].map(input => input.value.trim());
  players = COLORS.slice(0, selectedCount).map((color, i) => ({
    color,
    name: names[i] || `${color[0].toUpperCase() + color.slice(1)} Player`,
    id: `local-${i}`,
    tokens: [-1, -1, -1, -1]
  }));
  currentPlayer = 0;
  rolled = null;
  busy = false;
  lastDice = null;
  networkMode = false;
  gameActive = true;
  setupCard.classList.add("hidden");
  playCard.classList.remove("hidden");
  celebration.classList.add("hidden");
  rollButton.disabled = false;
  diceEl.textContent = "●";
  setStatus("Roll the dice to begin.");
  render();
}

function tokenPosition(player, tokenIndex) {
  const progress = player.tokens[tokenIndex];
  if (progress === -1) return YARDS[player.color][tokenIndex];
  if (progress >= 52) return progress === 58 ? [7,7] : HOME_LANES[player.color][progress - 52];
  return PATH[(START_INDEX[player.color] + progress) % 52];
}

function movableTokens(player, value) {
  return player.tokens.map((progress, index) => {
    if (progress === 58) return null;
    if (progress === -1) return value === 6 ? index : null;
    return progress + value <= 58 ? index : null;
  }).filter(index => index !== null);
}

function render() {
  board.querySelectorAll(".token").forEach(token => token.remove());
  board.querySelectorAll(".stacked").forEach(cell => cell.classList.remove("stacked"));
  const valid = rolled ? movableTokens(players[currentPlayer], rolled) : [];

  players.forEach((player, playerIndex) => {
    player.tokens.forEach((_, tokenIndex) => {
      const [row, col] = tokenPosition(player, tokenIndex);
      const cell = board.querySelector(`[data-cell="${key(row,col)}"]`);
      const token = document.createElement("button");
      token.type = "button";
      token.className = `token ${player.color}`;
      token.dataset.player = playerIndex;
      token.dataset.token = tokenIndex;
      token.setAttribute("aria-label", `${player.name} piece ${tokenIndex + 1}`);
      const ownsTurn = !networkMode || player.id === myNetworkId;
      if (playerIndex === currentPlayer && ownsTurn && valid.includes(tokenIndex) && !busy) {
        token.classList.add("selectable");
        token.addEventListener("click", () => moveToken(tokenIndex));
      } else token.disabled = true;
      cell.appendChild(token);
      if (cell.querySelectorAll(".token").length > 1) cell.classList.add("stacked");
    });
  });

  if (players.length) {
    const player = players[currentPlayer];
    turnName.textContent = player.name;
    turnDot.style.setProperty("--player-color", COLOR_HEX[player.color]);
    turnDot.style.background = COLOR_HEX[player.color];
    playerList.innerHTML = players.map((p, i) => {
      const home = p.tokens.filter(position => position === 58).length;
      return `<div class="player-row ${i === currentPlayer ? "current" : ""}" style="--player-color:${COLOR_HEX[p.color]}"><span class="mini-dot"></span><span>${escapeHtml(p.name)}</span><strong>${home}/4 home</strong></div>`;
    }).join("");
    const myTurn = !networkMode || player.id === myNetworkId;
    rollButton.disabled = busy || rolled !== null || !myTurn || !gameActive;
  }
}

function rollDice() {
  if (!gameActive || rolled !== null || busy) return;
  if (networkMode) {
    if (players[currentPlayer].id !== myNetworkId) return;
    if (!isHost) {
      busy = true;
      rollButton.disabled = true;
      setStatus("Asking the host to roll…");
      hostConnection.send({ type: "roll" });
      return;
    }
    performRoll(myNetworkId);
    return;
  }
  performRoll(players[currentPlayer].id);
}

function performRoll(requesterId) {
  if (!gameActive || rolled !== null || busy || players[currentPlayer].id !== requesterId) return;
  busy = true;
  rollButton.disabled = true;
  diceEl.classList.remove("rolling");
  void diceEl.offsetWidth;
  diceEl.classList.add("rolling");
  setStatus("Rolling…");

  setTimeout(() => {
    rolled = Math.floor(Math.random() * 6) + 1;
    lastDice = rolled;
    diceEl.textContent = DICE_FACES[rolled - 1];
    diceEl.setAttribute("aria-label", `Rolled ${rolled}`);
    busy = false;
    const valid = movableTokens(players[currentPlayer], rolled);
    if (!valid.length) {
      setStatus(`Rolled ${rolled}. No piece can move.`);
      render();
      syncState();
      setTimeout(() => endTurn(false), 900);
    } else {
      setStatus(`Rolled ${rolled}. Choose a glowing piece.`);
      render();
      syncState();
    }
  }, 480);
}

function moveToken(tokenIndex) {
  if (rolled === null || busy) return;
  if (networkMode) {
    if (players[currentPlayer].id !== myNetworkId) return;
    if (!isHost) {
      busy = true;
      render();
      hostConnection.send({ type: "move", tokenIndex });
      return;
    }
    performMove(tokenIndex, myNetworkId);
    return;
  }
  performMove(tokenIndex, players[currentPlayer].id);
}

function performMove(tokenIndex, requesterId) {
  if (rolled === null || busy || players[currentPlayer].id !== requesterId) return;
  if (!movableTokens(players[currentPlayer], rolled).includes(tokenIndex)) return;
  busy = true;
  const player = players[currentPlayer];
  const value = rolled;
  player.tokens[tokenIndex] = player.tokens[tokenIndex] === -1 ? 0 : player.tokens[tokenIndex] + value;
  let captured = false;

  if (player.tokens[tokenIndex] < 52) {
    const landingIndex = (START_INDEX[player.color] + player.tokens[tokenIndex]) % 52;
    if (!SAFE_INDEXES.has(landingIndex)) {
      players.forEach((opponent, opponentIndex) => {
        if (opponentIndex === currentPlayer) return;
        opponent.tokens.forEach((progress, index) => {
          if (progress >= 0 && progress < 52 && (START_INDEX[opponent.color] + progress) % 52 === landingIndex) {
            opponent.tokens[index] = -1;
            captured = true;
          }
        });
      });
    }
  }

  rolled = null;
  render();
  const winner = player.tokens.every(position => position === 58);
  if (winner) return showWinner(player);

  const bonus = value === 6 || captured;
  setStatus(captured ? "Great capture! Roll again." : bonus ? "You rolled a 6—go again!" : "Nice move!");
  syncState();
  setTimeout(() => endTurn(bonus), 600);
}

function endTurn(bonus) {
  if (!bonus) currentPlayer = (currentPlayer + 1) % players.length;
  rolled = null;
  busy = false;
  rollButton.disabled = false;
  if (!bonus) setStatus("Your turn—roll the dice.");
  render();
  syncState();
}

function showWinner(player) {
  gameActive = false;
  busy = false;
  document.querySelector("#winner-title").textContent = `${player.name} wins!`;
  celebration.classList.remove("hidden");
  if (networkMode && isHost) broadcast({ type: "winner", playerName: player.name, state: getState() });
}

function resetToSetup() {
  closeNetwork();
  gameActive = false;
  players = [];
  setupCard.classList.remove("hidden");
  playCard.classList.add("hidden");
  lobbyCard.classList.add("hidden");
  celebration.classList.add("hidden");
  renderNameFields();
  board.querySelectorAll(".token").forEach(token => token.remove());
}

function setStatus(message) { statusText.textContent = message; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]); }

document.querySelectorAll("[data-count]").forEach(button => button.addEventListener("click", () => {
  selectedCount = Number(button.dataset.count);
  document.querySelectorAll("[data-count]").forEach(item => item.classList.toggle("active", item === button));
  renderNameFields();
}));
document.querySelector("#start-game").addEventListener("click", startGame);
document.querySelector("#new-game").addEventListener("click", resetToSetup);
document.querySelector("#play-again").addEventListener("click", resetToSetup);
rollButton.addEventListener("click", rollDice);

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function onlineName() {
  return document.querySelector("#online-name").value.trim() || "Player";
}

function showLobby() {
  setupCard.classList.add("hidden");
  playCard.classList.add("hidden");
  lobbyCard.classList.remove("hidden");
  document.querySelector("#copy-room").textContent = roomCode;
  renderLobby();
}

function renderLobby() {
  lobbyPlayersEl.innerHTML = lobbyPlayers.map((p, index) => `<div class="lobby-player" style="--player-color:${COLOR_HEX[p.color]}"><span class="mini-dot"></span><span>${escapeHtml(p.name)}</span><small>${index === 0 ? "Host" : "Joined"}</small></div>`).join("");
  lobbyStatus.textContent = `${lobbyPlayers.length} of ${maxOnlinePlayers} devices connected`;
  onlineStart.classList.toggle("hidden", !isHost);
  onlineStart.disabled = lobbyPlayers.length < 2;
}

function createRoom() {
  connectionError.textContent = "";
  if (typeof Peer === "undefined") return connectionError.textContent = "Online service did not load. Check your internet and try again.";
  closeNetwork();
  networkMode = true;
  isHost = true;
  myNetworkId = "host";
  roomCode = randomRoomCode();
  maxOnlinePlayers = Number(document.querySelector("#online-count").value);
  lobbyPlayers = [{ id: "host", name: onlineName(), color: COLORS[0] }];
  peer = new Peer(`ludo-party-${roomCode}`);
  peer.on("open", showLobby);
  peer.on("connection", acceptConnection);
  peer.on("error", error => {
    if (error.type === "unavailable-id") return createRoom();
    connectionError.textContent = "Could not create the room. Please try again.";
    resetToSetup();
  });
}

function joinRoom() {
  connectionError.textContent = "";
  if (typeof Peer === "undefined") return connectionError.textContent = "Online service did not load. Check your internet and try again.";
  roomCode = document.querySelector("#room-code-input").value.trim().toUpperCase();
  if (roomCode.length !== 6) return connectionError.textContent = "Enter the 6-character room code.";
  closeNetwork();
  networkMode = true;
  isHost = false;
  peer = new Peer();
  peer.on("open", id => {
    myNetworkId = id;
    hostConnection = peer.connect(`ludo-party-${roomCode}`, { reliable: true });
    hostConnection.on("open", () => hostConnection.send({ type: "join", name: onlineName() }));
    hostConnection.on("data", handleGuestMessage);
    hostConnection.on("close", () => setStatus("The host disconnected."));
    setTimeout(() => {
      if (!hostConnection || !hostConnection.open) connectionError.textContent = "Room not found. Check the code and try again.";
    }, 7000);
  });
  lobbyPlayers = [{ id: myNetworkId, name: onlineName(), color: COLORS[0] }];
  showLobby();
  lobbyStatus.textContent = "Connecting to room…";
}

function acceptConnection(conn) {
  connections.push(conn);
  conn.on("data", data => handleHostMessage(conn, data));
  conn.on("close", () => {
    connections = connections.filter(item => item !== conn);
    const leaving = lobbyPlayers.find(p => p.id === conn.peer);
    lobbyPlayers = lobbyPlayers.filter(p => p.id !== conn.peer);
    if (!gameActive) broadcastLobby();
    else if (leaving) { setStatus(`${leaving.name} disconnected.`); syncState(); }
  });
}

function handleHostMessage(conn, data) {
  if (!data || typeof data !== "object") return;
  if (data.type === "join") {
    if (gameActive || lobbyPlayers.length >= maxOnlinePlayers) return conn.send({ type: "rejected", reason: "This room is full or the game already started." });
    const player = { id: conn.peer, name: String(data.name || "Player").slice(0, 14), color: COLORS[lobbyPlayers.length] };
    lobbyPlayers.push(player);
    conn.send({ type: "accepted", id: conn.peer, roomCode, players: lobbyPlayers, maxOnlinePlayers });
    broadcastLobby();
  }
  if (data.type === "roll") performRoll(conn.peer);
  if (data.type === "move") performMove(Number(data.tokenIndex), conn.peer);
}

function handleGuestMessage(data) {
  if (!data || typeof data !== "object") return;
  if (data.type === "accepted") {
    myNetworkId = data.id;
    lobbyPlayers = data.players;
    maxOnlinePlayers = data.maxOnlinePlayers;
    roomCode = data.roomCode;
    showLobby();
  }
  if (data.type === "lobby") {
    lobbyPlayers = data.players;
    maxOnlinePlayers = data.maxOnlinePlayers;
    renderLobby();
  }
  if (data.type === "state") applyState(data.state);
  if (data.type === "winner") {
    applyState(data.state);
    gameActive = false;
    document.querySelector("#winner-title").textContent = `${data.playerName} wins!`;
    celebration.classList.remove("hidden");
  }
  if (data.type === "rejected") {
    lobbyStatus.textContent = data.reason;
  }
}

function broadcast(message) {
  connections.filter(conn => conn.open).forEach(conn => conn.send(message));
}

function broadcastLobby() {
  renderLobby();
  broadcast({ type: "lobby", players: lobbyPlayers, maxOnlinePlayers });
}

function startOnlineGame() {
  if (!isHost || lobbyPlayers.length < 2) return;
  players = lobbyPlayers.map(player => ({ ...player, tokens: [-1, -1, -1, -1] }));
  currentPlayer = 0;
  rolled = null;
  lastDice = null;
  busy = false;
  gameActive = true;
  sharedStatus = "Host goes first—roll the dice.";
  lobbyCard.classList.add("hidden");
  playCard.classList.remove("hidden");
  diceEl.textContent = "●";
  setStatus(sharedStatus);
  render();
  syncState();
}

function getState() {
  return { players, currentPlayer, rolled, lastDice, gameActive, busy, status: sharedStatus };
}

function syncState() {
  if (networkMode && isHost) {
    sharedStatus = statusText.textContent;
    broadcast({ type: "state", state: getState() });
  }
}

function applyState(state) {
  players = state.players;
  currentPlayer = state.currentPlayer;
  rolled = state.rolled;
  lastDice = state.lastDice;
  gameActive = state.gameActive;
  busy = false;
  sharedStatus = state.status;
  lobbyCard.classList.add("hidden");
  setupCard.classList.add("hidden");
  playCard.classList.remove("hidden");
  diceEl.textContent = lastDice ? DICE_FACES[lastDice - 1] : "●";
  setStatus(sharedStatus);
  render();
}

function closeNetwork() {
  if (peer) peer.destroy();
  peer = null;
  hostConnection = null;
  connections = [];
  lobbyPlayers = [];
  networkMode = false;
  isHost = false;
  myNetworkId = null;
}

document.querySelector("#create-room").addEventListener("click", createRoom);
document.querySelector("#join-room").addEventListener("click", joinRoom);
onlineStart.addEventListener("click", startOnlineGame);
document.querySelector("#copy-room").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    lobbyStatus.textContent = "Room code copied!";
  } catch { lobbyStatus.textContent = `Share this code: ${roomCode}`; }
});

buildBoard();
renderNameFields();
