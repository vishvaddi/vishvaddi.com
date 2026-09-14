import { createStore, type Store } from "./store";
import { initialDoc, isKitchenDoc, KITCHEN_VERSION, type KitchenDoc } from "./kitchen-model";

// One document for recipes, plan, ticks and settings so a single sync toggle
// covers the whole kitchen on both pages.
export function openKitchenStore(): Store<KitchenDoc> {
  return createStore<KitchenDoc>({ key: "kitchen", version: KITCHEN_VERSION, initial: initialDoc, validate: isKitchenDoc });
}

export const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export const button = (label: string, cls = "btn btn-ghost btn-sm", onClick?: () => void): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
