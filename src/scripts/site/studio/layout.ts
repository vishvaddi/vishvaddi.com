import { el, btn, help } from "./helpers";
import type { Shell } from "./shell";

export interface LayoutParts { mpcPanel: HTMLElement; chop: HTMLElement; scratchPanel: HTMLElement; rack: HTMLElement; beat: HTMLElement; synthPanel: HTMLElement; song: HTMLElement; mixer: HTMLElement; devicePanel: HTMLElement; exp: HTMLElement; selectedPadLabel: HTMLElement; selectedSampleEditor: HTMLElement }

export function buildLayout(root: HTMLElement, shell: Shell, parts: LayoutParts): void {
  const hint = (title: string, text: string): HTMLElement => { const box = el("div", "wa-hint"); box.append(el("strong", "", title), document.createTextNode(` ${text}`)); return box; };
  const section = (title: string, content: HTMLElement): HTMLElement => { const host = el("section", "wa-workspace-section"); help(host, title); host.append(el("h2", "wa-section-title", title), content); return host; };
  const drawer = el("aside", "wa-drawer"), overlay = el("div", "wa-drawer-overlay"), close = btn("✕ Close", "wa-btn-sm"), head = el("div", "wa-drawer-head");
  head.append(el("span", "wa-drawer-title", "SAMPLE RACK"), close); drawer.append(head, parts.rack);
  const closeDrawer = (): void => { drawer.classList.remove("open"); overlay.classList.remove("open"); }; close.addEventListener("click", closeDrawer); overlay.addEventListener("click", closeDrawer);
  const open = btn("⊞ Sample Rack", "wa-btn-sm"); open.addEventListener("click", () => { drawer.classList.add("open"); overlay.classList.add("open"); });
  const createBar = el("div", "wa-mpc-toolbar"); createBar.append(open);
  const create = el("div", "wa-workspace"), sequence = el("div", "wa-workspace"), arrange = el("div", "wa-workspace"), mix = el("div", "wa-workspace");
  create.append(hint("Start here.", "Drop audio onto a pad, or load a break in Chop."), createBar, section("Pads", parts.mpcPanel), section("Chop", parts.chop), section("Scratch", parts.scratchPanel));
  sequence.append(hint("Build the loop.", "Paint drum and pad hits, then add synth notes."), section("Drum Sequence", parts.beat), section("Synth + Piano Roll", parts.synthPanel));
  arrange.append(hint("Turn loops into a track.", "Launch clips, then chain scenes and enable Song mode."), section("Session + Song", parts.song));
  mix.append(hint("Finish and preserve it.", "Balance, save, then export."), section("Mixer", parts.mixer), section("Devices", parts.devicePanel), section("Project + Export", parts.exp));
  shell.panelEls.push(create, sequence, arrange, mix); shell.panels.append(create, sequence, arrange, mix);
  const inspector = el("aside", "wa-inspector"); inspector.append(el("div", "wa-inspector-title", "SELECTED PAD"), parts.selectedPadLabel, parts.selectedSampleEditor);
  const workarea = el("div", "wa-workarea"); workarea.append(shell.panels, inspector); shell.win.append(shell.titleBar, shell.lcd, shell.tabbar, shell.transportBar, workarea, overlay, drawer); root.append(shell.win); shell.paintTabs();
}
