import { TRACKS, TRACK_LABELS } from "./state";
import type { TrackId } from "./state";
import { el, btn, help } from "./helpers";
import type { Shell } from "./shell";
import { ctx } from "./ctx";

export interface LayoutParts { mpcPanel: HTMLElement; chop: HTMLElement; scratchPanel: HTMLElement; rack: HTMLElement; beat: HTMLElement; synthPanel: HTMLElement; song: HTMLElement; mixer: HTMLElement; devicePanel: HTMLElement; exp: HTMLElement; selectedPadLabel: HTMLElement; selectedSampleEditor: HTMLElement }

export function buildLayout(root: HTMLElement, shell: Shell, parts: LayoutParts): void {
  const section = (title: string, content: HTMLElement): HTMLElement => { const host = el("section", "wa-workspace-section"); help(host, title); host.append(el("h2", "wa-section-title", title), content); return host; };
  const drawer = el("aside", "wa-drawer"), overlay = el("div", "wa-drawer-overlay"), close = btn("✕ Close", "wa-btn-sm"), head = el("div", "wa-drawer-head");
  head.append(el("span", "wa-drawer-title", "SAMPLE RACK"), close); drawer.append(head, parts.rack);
  const closeDrawer = (): void => { drawer.classList.remove("open"); overlay.classList.remove("open"); }; close.addEventListener("click", closeDrawer); overlay.addEventListener("click", closeDrawer);
  const openRack = btn("⊞ Sample Rack", "wa-btn-sm"); openRack.addEventListener("click", () => { drawer.classList.add("open"); overlay.classList.add("open"); });

  const sessionWorkspace = el("div", "wa-workspace wa-session-workspace"), mixWorkspace = el("div", "wa-workspace");
  const sessionTop = el("div", "wa-session-top"); sessionTop.append(section("Session + Song", parts.song));
  const trackBar = el("div", "wa-track-tabs"), editor = el("div", "wa-context-editor"), trackButtons: HTMLButtonElement[] = [], trackPanels: HTMLElement[] = [];
  const drums = el("div", "wa-track-panel"); const drumTools = el("div", "wa-mpc-toolbar"); drumTools.append(openRack); drums.append(drumTools, section("Drums", parts.beat));
  const pads = el("div", "wa-track-panel"); const inspector = el("div", "wa-inline-inspector"); inspector.append(el("h2", "wa-section-title", "Selected pad"), parts.selectedPadLabel, parts.selectedSampleEditor); pads.append(section("Pads", parts.mpcPanel), inspector, section("Chop", parts.chop), section("Scratch", parts.scratchPanel));
  const synth = el("div", "wa-track-panel"); synth.append(section("Synth", parts.synthPanel)); trackPanels.push(drums, pads, synth); editor.append(drums, pads, synth);
  let activeTrack: TrackId = "drums"; try { const stored = JSON.parse(localStorage.getItem("vv_studio_workspace") || "{}"); if (TRACKS.includes(stored.track)) activeTrack = stored.track; } catch {}
  const paintTrack = (): void => { TRACKS.forEach((track, index) => { trackButtons[index].classList.toggle("active", track === activeTrack); trackPanels[index].hidden = track !== activeTrack; }); };
  ctx.selectTrack = (track): void => { activeTrack = track; shell.tabBtns[0].click(); let tab = 0; try { tab = JSON.parse(localStorage.getItem("vv_studio_workspace") || "{}").tab || 0; } catch {} localStorage.setItem("vv_studio_workspace", JSON.stringify({ tab, track })); paintTrack(); };
  ctx.currentTrack = () => activeTrack;
  TRACKS.forEach((track) => { const button = btn(TRACK_LABELS[track].toUpperCase(), "wa-track-tab"); button.addEventListener("click", () => ctx.selectTrack(track)); trackButtons.push(button); trackBar.append(button); }); paintTrack();
  sessionWorkspace.append(sessionTop, trackBar, editor);
  mixWorkspace.append(section("Mixer", parts.mixer), section("Master chain", parts.devicePanel), section("Project + Export", parts.exp));
  shell.panelEls.push(sessionWorkspace, mixWorkspace); shell.panels.append(sessionWorkspace, mixWorkspace);
  const workarea = el("div", "wa-workarea wa-workarea-single"); workarea.append(shell.panels); shell.win.append(shell.titleBar, shell.lcd, shell.tabbar, shell.transportBar, workarea, overlay, drawer); root.append(shell.win); shell.paintTabs();
}
