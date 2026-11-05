import { ALLOWED_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";
import { startData, useLocalDemoStore } from "./db.js";
import { renderPlanes, seedPlansIfEmpty, setPlanUser, watchPlans } from "./planes.js";
import { DEMO_USER, isLocalDemo, renderTarjeta, seedExampleIfEmpty, setCardUser, watchCardData } from "./tarjeta.js";

const SECTIONS = {
  inicio: "Simpla",
  tarjeta: "Tarjeta",
  prestamos: "Préstamos",
  servicios: "Servicios",
  suscripciones: "Suscripciones",
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

if (isLocalDemo()) {
  useLocalDemoStore();
  setCardUser(DEMO_USER);
  setPlanUser(DEMO_USER);
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
        setPlanUser(session.user.id);
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
