const SECTIONS = {
  inicio: "Simpla",
  tarjeta: "Tarjeta",
  prestamos: "Préstamos",
  servicios: "Servicios",
  suscripciones: "Suscripciones",
};

const links = document.querySelectorAll(".nav a");
const title = document.getElementById("section-title");

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

window.addEventListener("hashchange", syncNav);
syncNav();
fillCalendar();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((error) => {
    console.error("No se pudo registrar el service worker", error);
  });
}
