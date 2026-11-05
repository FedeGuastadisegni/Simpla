export const THEME_KEY = "simpla-theme";

export function readTheme(storage) {
  try {
    const value = storage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
  } catch (error) {
    return "auto";
  }
  return "auto";
}

export function applyTheme(choice, root) {
  if (choice === "light" || choice === "dark") root.dataset.theme = choice;
  else delete root.dataset.theme;
}

export function saveTheme(choice, storage) {
  if (choice === "light" || choice === "dark") storage.setItem(THEME_KEY, choice);
  else storage.removeItem(THEME_KEY);
}
