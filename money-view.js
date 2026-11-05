import { formatQuoteDate, fxParts, fxSnapshot } from "./fx.js";

export function formatAmount(amount, currency) {
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return currency === "USD" ? `USD ${formatted}` : `$${formatted}`;
}

export function amountNode(amount, currency) {
  if (currency !== "USD") {
    const plain = document.createElement("span");
    plain.textContent = formatAmount(amount, "ARS");
    return plain;
  }
  const wrap = document.createElement("span");
  wrap.className = "fx-usd";
  const usd = document.createElement("span");
  usd.textContent = formatAmount(amount, "USD");
  const mep = document.createElement("span");
  mep.className = "fx-mep";
  const tip = document.createElement("span");
  tip.className = "fx-tip";
  const quotes = fxSnapshot();
  const parts = fxParts(amount, quotes);
  if (!parts) {
    mep.textContent = "";
    tip.textContent = "Sin cotización";
  } else {
    const when = formatQuoteDate(parts.fecha);
    mep.textContent = quotes.fresh || !when ? ` ≈ ${formatAmount(parts.mep, "ARS")}` : ` ≈ ${formatAmount(parts.mep, "ARS")} · ${when}`;
    tip.textContent = when
      ? `Tarjeta ${formatAmount(parts.tarjeta, "ARS")} · ${when}`
      : `Tarjeta ${formatAmount(parts.tarjeta, "ARS")}`;
  }
  wrap.append(usd, mep, tip);
  wrap.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    wrap.classList.toggle("is-open");
  });
  return wrap;
}

export function putAmount(parent, amount, currency) {
  parent.replaceChildren(amountNode(amount, currency));
}
