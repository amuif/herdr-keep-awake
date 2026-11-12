import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { terminals, theme, exec, appHome, window, shared, setShared, openOverlay, closeOverlay, props, notify, nextCommand } from "herdr";

// One mod, two copies: the status bar item (which also does the work) and, with
// props {menu: true}, the dropdown it opens. They meet in this shared value.
const MODE = "keep-awake";
const MODES = [
  { id: "always", label: "Always", short: "always", hint: "while Herdr is open" },
  { id: "agents", label: "When agents run", short: "agents", hint: "an agent here is working" },
  { id: "off", label: "Off", short: "off", hint: "sleeps as normal" },
];
// Agents pause between steps: stay awake this long after the last one stopped working.
const LINGER_MS = 60 * 1000;
const CHECK_MS = 3000;
const RETRY_MS = 60 * 1000;
const MENU_W = 240;
const MENU_H = 186;

function mode() {
  const m = shared(MODE);
  return MODES.some((x) => x.id === m) ? m : "off";
}

// The helper holds the computer awake while it lives: hold.ps1 on Windows, hold.sh on macOS and Linux.
function helper(stop = false) {
  const dir = `${appHome()}/mods/keep-awake`;
  const [cmd, args] = window()?.platform === "windows"
    ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${dir}/hold.ps1`, ...(stop ? ["-Stop"] : [])]]
    : ["sh", [`${dir}/hold.sh`, ...(stop ? ["--stop"] : [])]];
  return exec(cmd, args, { timeout: 600000 });
}

export default class KeepAwake extends View {
  init(_props, cx) {
    this.menu = Boolean(props()?.menu);
    if (this.menu) return;
    this.holding = false;
    this.stopping = false;
    this.stoppedAt = 0;
    this.retryAt = 0;
    this.lastWorking = 0;
    cx.timer.every(CHECK_MS, (cx) => this.sync(cx));
    this.sync(cx);
    // Keys: "keep-awake.menu" opens the menu, "keep-awake.always" / ".agents" / ".off" pick a mode.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "menu" && this.supported()) this.openMenu();
        else if (MODES.some((m) => m.id === c)) setShared(MODE, c);
        cx.notify();
      }
    });
  }

  // A click carries no position, the press before it does: open the menu clear above the bar.
  openMenu(p) {
    openOverlay({ mod: "keep-awake", kind: "popup", width: MENU_W, height: MENU_H, props: { menu: true },
      at: p ? { x: p.x - MENU_W / 2, y: p.y - MENU_H - 22 } : "pointer" });
  }

  // Asked each time, not once in init: at app start the window isn't known yet.
  supported() {
    return ["windows", "macos", "linux"].includes(window()?.platform);
  }

  want() {
    const m = mode();
    if (m === "always") return true;
    if (m !== "agents") return false;
    // terminals(), not agents(): sub-agents without a pane count too.
    // Only this computer's: another machine's terminals have a "machine/" address, and its own copy of the mod looks after it.
    if (terminals().some((t) => t.status === "working" && !String(t.address).includes("/"))) this.lastWorking = Date.now();
    return Date.now() - this.lastWorking < LINGER_MS;
  }

  sync(cx) {
    if (!this.supported()) return;
    const want = this.want();
    if (want && !this.holding && Date.now() >= this.retryAt) this.hold(cx);
    if (!want && this.holding && !this.stopping) this.stop(cx);
  }

  hold(cx) {
    this.holding = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        while (this.want()) {
          const started = Date.now();
          const r = await helper();
          // First thing after the wait: a reloaded mod's old loop ends here instead of fighting the new one.
          cx.notify();
          // A helper that dies at once (and wasn't stopped by us) would spin this loop.
          if (r.code !== 0 && Date.now() - started < 5000 && this.stoppedAt < started) throw new Error(r.stderr.trim() || `exit ${r.code}`);
        }
      } catch (e) {
        this.retryAt = Date.now() + RETRY_MS;
        notify({ title: "Keep awake isn't working", body: String(e?.message ?? e), level: "error" });
      } finally {
        this.holding = false;
        cx.notify();
      }
    });
  }

  stop(cx) {
    this.stopping = true;
    this.stoppedAt = Date.now();
    cx.spawn(async (cx) => {
      try { await helper(true); } catch { /* nothing was holding */ } finally { this.stopping = false; cx.notify(); }
    });
  }

  async close() {
    if (!this.menu && this.holding) await helper(true);
  }

  renderMenu(t) {
    const current = mode();
    return v_flex().id("keep-awake-menu").size_full().bg(t.popover).p(5).text_size(14).text_color(t.foreground)
      .child(div().px(9).pt(5).pb(6).text_size(12).text_color(t.dim).child("Keep this computer awake"))
      .children(MODES.map((m) =>
        h_flex().id(m.id).h(48).px(9).gap(10).rounded(7).items_center().flex_none().hover((s) => s.bg(t.selected))
          .on_click(() => { setShared(MODE, m.id); closeOverlay(props().overlay); })
          .child(div().w(14).when(m.id === current, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14))))
          .child(v_flex().flex_1().gap(1)
            .child(div().child(m.label))
            .child(div().text_size(12).text_color(t.dim).child(m.hint)))));
  }

  render() {
    const t = theme();
    if (this.menu) return this.renderMenu(t);
    const m = MODES.find((x) => x.id === mode());
    const active = this.holding && !this.stopping;
    return h_flex().size_full().px(8).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(h_flex().id("keep-awake").gap(6).px(6).rounded(4).items_center().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (e) => { this.pressed = e.position; })
        .on_click(() => { if (this.supported()) this.openMenu(this.pressed); })
        .child(svg("mods/keep-awake/coffee.svg").size(13).text_color(active ? t.working : m.id === "off" ? t.dim : t.muted))
        .child(div().text_color(m.id === "off" ? t.dim : t.muted).child(this.supported() ? `Awake: ${m.short}` : "Awake: n/a"))
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(11).text_color(t.dim)));
  }
}
