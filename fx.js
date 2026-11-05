// Cotización para mostrar pesos al lado de un monto en dólares.
// El monto guardado sigue en USD. Bolsa es el MEP visible.
// Tarjeta se muestra aparte, al pasar el mouse o al tocar.

export const BOLSA_URL = "https://dolarapi.com/v1/dolares/bolsa";
export const TARJETA_URL = "https://dolarapi.com/v1/dolares/tarjeta";
export const FX_KEY = "simpla-fx";

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function arsFor(usd, venta) {
  const amount = Number(usd);
  const rate = Number(venta);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return null;
  return roundMoney(amount * rate);
}

export function normalizeQuote(payload) {
  const venta = Number(payload?.venta);
  if (!Number.isFinite(venta) || venta <= 0) return null;
  const fecha = payload.fechaActualizacion || payload.fecha || null;
  return { venta, fecha };
}

export function readFxCache(storage) {
  try {
    const raw = storage.getItem(FX_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.bolsa?.venta || !data?.tarjeta?.venta) return null;
    return data;
  } catch (error) {
    return null;
  }
}

export function writeFxCache(data, storage) {
  storage.setItem(FX_KEY, JSON.stringify({
    bolsa: data.bolsa,
    tarjeta: data.tarjeta,
    fetchedAt: data.fetchedAt,
  }));
}

export function fxParts(usd, quotes) {
  if (!quotes?.bolsa?.venta || !quotes?.tarjeta?.venta) return null;
  return {
    mep: arsFor(usd, quotes.bolsa.venta),
    tarjeta: arsFor(usd, quotes.tarjeta.venta),
    fecha: quotes.bolsa.fecha || quotes.fetchedAt || null,
  };
}

export function formatQuoteDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" }).format(date).replace(".", "");
}

let state = { bolsa: null, tarjeta: null, fetchedAt: null, fresh: false };
const listeners = new Set();

export function fxSnapshot() {
  return state;
}

export function onFx(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next) {
  state = next;
  for (const listener of listeners) listener(state);
}

export async function refreshFx(fetchImpl = globalThis.fetch, storage = globalThis.localStorage) {
  const cached = storage ? readFxCache(storage) : null;
  if (cached && !state.bolsa) publish({ ...cached, fresh: false });
  try {
    const [bolsaResponse, tarjetaResponse] = await Promise.all([
      fetchImpl(BOLSA_URL),
      fetchImpl(TARJETA_URL),
    ]);
    if (!bolsaResponse.ok || !tarjetaResponse.ok) throw new Error("cotizacion");
    const bolsa = normalizeQuote(await bolsaResponse.json());
    const tarjeta = normalizeQuote(await tarjetaResponse.json());
    if (!bolsa || !tarjeta) throw new Error("cotizacion");
    const next = { bolsa, tarjeta, fetchedAt: new Date().toISOString(), fresh: true };
    if (storage) writeFxCache(next, storage);
    publish(next);
  } catch (error) {
    if (cached) publish({ ...cached, fresh: false });
    else publish({ ...state, fresh: false });
  }
  return state;
}
