import { ALLOWED_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";
import { buildExport, planImport, TABLES } from "./backup.js";
import { listRows, queueChange, startData, useLocalDemoStore } from "./db.js";
import { renderPlanes, seedPlansIfEmpty, setPlanUser, watchPlans } from "./planes.js";
import { renderProyeccion, watchProyeccion } from "./proyeccion.js";
import { setStatementUser } from "./resumen.js";
import { DEMO_USER, isLocalDemo, renderTarjeta, seedExampleIfEmpty, setCardUser, watchCardData } from "./tarjeta.js";

const SECTIONS = {
  inicio: "Simpla",
  tarjeta: "Tarjeta",
  prestamos: "Préstamos",
  servicios: "Servicios",
  suscripciones: "Suscripciones",
  proyeccion: "Proyección",
};

const links = document.querySelectorAll(".nav a");
const title = document.getElementById("section-title");
const login = document.getElementById("login");
const frame = document.querySelector(".frame");
const loginError = document.getElementById("login-error");
const loginOffline = document.getElementById("login-offline");
const signInButton = document.getElementById("google-sign-in");

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

let privateApp = false;
let started = false;
let backupUserId = null;
let pendingImport = null;

function currentId() {
  const id = location.hash.replace(/^#/, "");
  return Object.prototype.hasOwnProperty.call(SECTIONS, id) ? id : "inicio";
}

function syncNav() {
  const id = currentId();
  for (const link of links) {
    if (link.getAttribute("href") === "#" + id) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
  title.textContent = SECTIONS[id];
  document.title = id === "inicio" ? "Simpla" : "Simpla · " + SECTIONS[id];
}

function capitalize(value) {
  return value.charAt(0).toLocaleUpperCase("es-AR") + value.slice(1);
}

function fillCalendar() {
  const now = new Date();
  const longMonth = new Intl.DateTimeFormat("es-AR", { month: "long" }).format(now);
  const label = capitalize(longMonth);
  for (const node of document.querySelectorAll("[data-month]")) {
    node.textContent = label;
  }

  const shortMonth = new Intl.DateTimeFormat("es-AR", { month: "short" });
  const items = document.querySelectorAll("#month-rail li");
  items.forEach((item, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
    const name = shortMonth.format(date).replace(".", "").toLocaleUpperCase("es-AR");
    const railLabel = item.querySelector(".rail-label");
    if (railLabel) railLabel.textContent = name;
    item.classList.toggle("is-now", index === 0);
  });
}

function redirectTo() {
  return new URL("./", window.location.href).href;
}

function updateLoginOffline() {
  const offline = !navigator.onLine;
  loginOffline.hidden = !offline;
  signInButton.disabled = offline;
}

function showLogin() {
  frame.hidden = true;
  login.hidden = false;
  loginError.hidden = !privateApp;
  updateLoginOffline();
  document.title = "Simpla";
}

function showApp() {
  login.hidden = true;
  loginError.hidden = true;
  frame.hidden = false;
  syncNav();
  fillCalendar();
  renderTarjeta();
  renderPlanes();
  renderProyeccion();
  if (!started && !isLocalDemo()) {
    started = true;
    startData(client);
  }
}

async function acceptSession(session) {
  const email = (session?.user?.email || "").toLowerCase();
  if (!session) {
    showLogin();
    return;
  }
  if (email !== ALLOWED_EMAIL) {
    privateApp = true;
    await client.auth.signOut();
    return;
  }
  privateApp = false;
  showApp();
}

signInButton.addEventListener("click", async () => {
  privateApp = false;
  loginError.hidden = true;
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo() },
  });
  if (error) updateLoginOffline();
});

document.getElementById("sign-out").addEventListener("click", () => {
  if (isLocalDemo()) {
    location.assign(new URL("./", location.href).href);
    return;
  }
  privateApp = false;
  client.auth.signOut();
});

window.addEventListener("hashchange", () => {
  if (!frame.hidden) syncNav();
});

window.addEventListener("online", updateLoginOffline);
window.addEventListener("offline", updateLoginOffline);

watchCardData();
watchPlans();
watchProyeccion();

function setBackupUser(id) {
  backupUserId = id;
}

async function exportJson() {
  const tables = {};
  for (const table of TABLES) tables[table] = await listRows(table);
  const payload = buildExport(tables, new Date().toISOString());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "simpla.json";
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById("export-json").addEventListener("click", () => {
  exportJson();
});

const importFile = document.getElementById("import-file");
const importDialog = document.getElementById("import-dialog");
const importSummary = document.getElementById("import-summary");
const importError = document.getElementById("import-error");

document.getElementById("import-json").addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = "";
  pendingImport = null;
  importError.textContent = "";
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    importError.textContent = "Ese archivo no es JSON.";
    importSummary.textContent = "";
    importDialog.showModal();
    return;
  }
  const existing = {};
  for (const table of TABLES) existing[table] = await listRows(table);
  const plan = planImport(payload, existing);
  if (!plan.ok) {
    importError.textContent = plan.error;
    importSummary.textContent = "";
    importDialog.showModal();
    return;
  }
  pendingImport = plan;
  importSummary.textContent = plan.summary ? `${plan.summary}.` : "El archivo no trae datos.";
  importDialog.showModal();
});

document.getElementById("import-cancel").addEventListener("click", () => {
  pendingImport = null;
  importDialog.close();
});

document.getElementById("import-confirm").addEventListener("click", async () => {
  const plan = pendingImport;
  pendingImport = null;
  importDialog.close();
  if (!plan || !backupUserId) return;
  for (const op of plan.ops) {
    await queueChange(op.table, op.op, { ...op.row, user_id: backupUserId });
  }
});

if (isLocalDemo()) {
  useLocalDemoStore();
  setCardUser(DEMO_USER);
  setStatementUser(DEMO_USER);
  setPlanUser(DEMO_USER);
  setBackupUser(DEMO_USER);
  const flag = document.getElementById("demo-flag");
  if (flag) flag.hidden = false;
  seedExampleIfEmpty()
    .then(() => seedPlansIfEmpty())
    .then(() => {
      showApp();
      if (!location.hash) location.hash = "#tarjeta";
    });
} else {
  client.auth.onAuthStateChange((_event, session) => {
    // signOut adentro del callback traba el lock de supabase-js.
    setTimeout(() => {
      if (session?.user?.id) {
        setCardUser(session.user.id);
        setStatementUser(session.user.id);
        setPlanUser(session.user.id);
        setBackupUser(session.user.id);
      }
      acceptSession(session);
    }, 0);
  });
}

updateLoginOffline();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((error) => {
    console.error("No se pudo registrar el service worker", error);
  });
}
