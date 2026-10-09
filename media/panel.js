// Panel lateral: lista de lo que Claude ha leído o generado, lo más nuevo arriba.
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const T = JSON.parse(document.body.dataset.i18n); // textos ya traducidos por la extensión
  const list = $("list");
  const status = $("status");
  const notice = $("notice");
  const seen = new Set();
  const byPath = new Map(); // ruta → tarjeta: si el mismo archivo vuelve a aparecer, sube arriba en vez de duplicarse
  const selected = new Map(); // ruta → item, para comparar variantes
  const filter = { kind: "all", text: "", today: false };

  const ICON = { image: "file-media", svg: "symbol-color", html: "globe", video: "device-camera-video" };
  const PIXEL_MAX = 256; // imágenes de este tamaño o menos se tratan como pixel art

  // ¿Este VS Code sabe reproducir el audio de un .mp4 normal (AAC)? Hoy no, pero si algún día sí, no hace falta ffmpeg.
  const probe = document.createElement("video");
  const canAac = !!probe.canPlayType('audio/mp4; codecs="mp4a.40.2"');
  vscode.postMessage({
    type: "caps",
    caps: { aac: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'), opus: probe.canPlayType('video/mp4; codecs="avc1.42E01E, opus"') },
  });

  // ---------- utilidades ----------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(name) {
    return el("i", "codicon codicon-" + name);
  }

  /** Botón con icono y, opcionalmente, texto. Sin texto, el título hace de etiqueta. */
  function button(iconName, label, title, onClick, cls) {
    const b = el("button", cls || "");
    if (iconName) b.append(icon(iconName));
    if (label) b.append(document.createTextNode(" " + label));
    b.title = title || label || "";
    if (!label) b.setAttribute("aria-label", b.title);
    b.onclick = (ev) => {
      ev.stopPropagation();
      onClick(ev);
    };
    return b;
  }

  function time(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function isToday(ts) {
    if (!ts) return false;
    const d = new Date(ts);
    return !isNaN(d) && d.toDateString() === new Date().toDateString();
  }

  const isPicture = (item) => item.kind === "image" || item.kind === "svg";

  /** Pixel art: nítido y ampliado a un múltiplo entero, que es como se ve bien. */
  function fitPixel(img, maxW, maxH) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h || w > PIXEL_MAX || h > PIXEL_MAX) return false;
    const scale = Math.max(1, Math.floor(Math.min(maxW / w, maxH / h)));
    img.classList.add("pixel");
    img.style.width = w * scale + "px";
    img.style.height = h * scale + "px";
    return true;
  }

  // ---------- tarjetas ----------

  function card(item) {
    const c = el("div", "card");
    c.dataset.kind = item.kind === "svg" ? "image" : item.kind;
    c.dataset.name = (item.name || "").toLowerCase();
    c.dataset.ts = item.timestamp || "";
    if (item.path) {
      // Menú de clic derecho (lo pinta VS Code; ver "webview/context" en package.json).
      c.dataset.vscodeContext = JSON.stringify({ cpHasPath: true, path: item.path, preventDefaultContextMenuItems: true });
    }

    const head = el("div", "head");
    if (isPicture(item) && item.src && item.path) {
      const sel = button(selected.has(item.path) ? "pass-filled" : "circle-large-outline", "", T.selectToCompare, () => toggleSelect(item, sel), "sel");
      head.append(sel);
    } else {
      head.append(icon(ICON[item.kind] || "file"));
    }
    const name = el("span", "name", item.name);
    name.title = item.path || "";
    head.append(name);
    if (item.sub) head.append(el("span", "badge", T.subagent));
    if (item.versions) head.append(el("span", "badge", "v" + item.versions.length));
    head.append(el("span", "meta", (item.action === "write" ? T.written : T.read) + " · " + time(item.timestamp)));
    c.append(head);

    if (item.src && isPicture(item)) {
      const img = el("img", "thumb");
      img.src = item.src;
      img.alt = item.name;
      img.onload = () => fitPixel(img, list.clientWidth - 16, 260);
      img.onerror = () => img.replaceWith(el("div", "missing", T.cantShow)); // formato que el webview no sabe pintar, o archivo dañado
      img.onclick = () => openImage(item);
      c.append(img);
    } else if (item.src && item.kind === "video") {
      const v = el("video", "thumb");
      v.src = item.src;
      v.controls = true;
      v.muted = true;
      v.preload = "metadata";
      v.onerror = () => {
        if (c.soundReady) return; // el error es de la versión con sonido: lo gestiona withSound
        v.replaceWith(el("div", "missing", T.cantShow));
        c.video = undefined;
        soundButton(c)?.remove();
      };
      c.append(v);
      c.video = v;
    } else if (item.kind === "html") {
      c.append(button("globe", T.viewHtml, "", () => vscode.postMessage({ type: "openHtml", path: item.path }), "wide"));
    } else if (item.missing) {
      c.append(el("div", "missing", item.missingText || T.fileGone));
    }

    if (item.path) {
      const actions = el("div", "actions");
      const post = (type) => () => vscode.postMessage({ type, path: item.path });
      actions.append(button("edit", T.change, T.changeTip, post("ask"), "primary"));
      if (item.versions) actions.append(button("diff", T.beforeAfter, T.beforeAfterTip, () => openCompare(item)));
      if (item.kind === "video" && item.src) {
        const snd = button("unmute", T.sound, T.soundTip, () => withSound(item, c, snd));
        actions.append(snd);
      }
      const tools = el("span", "tools");
      tools.append(
        button("go-to-file", "", T.open, post("open")),
        button("copy", "", T.copyPath, post("copyPath")),
        button("folder-opened", "", T.reveal, post("reveal")),
      );
      actions.append(tools);
      c.append(actions);
    }
    return c;
  }

  function add(item, atTop) {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const old = item.path && byPath.get(item.path);
    if (old) {
      if (!atTop) return; // al cargar el histórico (de nuevo a viejo) gana la primera, la más reciente
      old.remove();
    }
    const c = card(item);
    c.item = item;
    if (item.path) {
      byPath.set(item.path, c);
      if (selected.has(item.path)) selected.set(item.path, item);
    }
    if (atTop) list.prepend(c);
    else list.append(c);
    applyFilter(c);
    updateStatus();
  }

  function reset() {
    list.replaceChildren();
    seen.clear();
    byPath.clear();
    selected.clear();
    updateSelbar();
  }

  // ---------- filtros ----------

  function matches(c) {
    if (filter.kind !== "all" && c.dataset.kind !== filter.kind) return false;
    if (filter.text && !c.dataset.name.includes(filter.text)) return false;
    if (filter.today && !isToday(c.dataset.ts)) return false;
    return true;
  }

  function applyFilter(c) {
    c.hidden = !matches(c);
  }

  function applyAll() {
    for (const c of list.children) applyFilter(c);
    updateStatus();
  }

  function updateStatus() {
    if (!list.children.length) return;
    const visible = [...list.children].filter((c) => !c.hidden).length;
    status.textContent = visible ? "" : T.noMatch;
  }

  for (const b of $("kinds").children) {
    b.onclick = () => {
      filter.kind = b.dataset.kind;
      for (const o of $("kinds").children) o.classList.toggle("on", o === b);
      applyAll();
    };
  }
  $("search").oninput = (e) => {
    filter.text = e.target.value.trim().toLowerCase();
    applyAll();
  };
  $("today").onclick = () => {
    filter.today = !filter.today;
    $("today").classList.toggle("on", filter.today);
    applyAll();
  };

  // ---------- selección para comparar variantes ----------

  function toggleSelect(item, btn) {
    if (selected.has(item.path)) selected.delete(item.path);
    else selected.set(item.path, item);
    btn.replaceChildren(icon(selected.has(item.path) ? "pass-filled" : "circle-large-outline"));
    btn.closest(".card").classList.toggle("selected", selected.has(item.path));
    updateSelbar();
  }

  function updateSelbar() {
    const n = selected.size;
    $("selbar").hidden = n === 0;
    $("selcount").textContent = n === 1 ? T.oneSelected : T.nSelected.replace("{0}", n);
    $("compare").disabled = n < 2;
  }

  $("compare").onclick = () => openGrid([...selected.values()]);
  $("selclear").onclick = () => {
    selected.clear();
    for (const c of list.querySelectorAll(".card.selected")) {
      c.classList.remove("selected");
      const b = c.querySelector(".sel");
      if (b) b.replaceChildren(icon("circle-large-outline"));
    }
    updateSelbar();
  };

  // ---------- visor (pestaña aparte, más grande) ----------

  const openImage = (item) => vscode.postMessage({ type: "view", mode: "image", item });
  const openCompare = (item) => vscode.postMessage({ type: "view", mode: "compare", item });
  const openGrid = (items) => vscode.postMessage({ type: "view", mode: "grid", items });

  // ---------- vídeo con sonido ----------

  function withSound(item, c, btn) {
    const v = c.video;
    if (!v) return;
    if (canAac || c.soundReady) {
      v.muted = false;
      v.play();
      return;
    }
    btn.disabled = true;
    btn.replaceChildren(icon("loading"), document.createTextNode(" " + T.preparing));
    btn.querySelector(".codicon").classList.add("codicon-modifier-spin");
    vscode.postMessage({ type: "withSound", id: item.id, path: item.path });
  }

  function cardById(id) {
    for (const c of list.children) if (c.item && c.item.id === id) return c;
    return undefined;
  }

  function soundButton(c) {
    return [...c.querySelectorAll("button")].find((b) => b.querySelector(".codicon-unmute, .codicon-loading"));
  }

  // ---------- mensajes de la extensión ----------

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m.type === "reset") {
      reset();
      for (const it of m.items.slice().reverse()) add(it, false);
      status.textContent = m.items.length ? "" : T.waiting;
    } else if (m.type === "add") {
      add(m.item, true);
    } else if (m.type === "clear") {
      reset();
      status.textContent = T.cleared;
    } else if (m.type === "paused") {
      status.textContent = m.value ? T.paused : "";
    } else if (m.type === "status") {
      status.textContent = m.text;
    } else if (m.type === "notice") {
      notice.textContent = m.text;
      notice.hidden = !m.text;
    } else if (m.type === "videoSrc") {
      const c = cardById(m.id);
      if (!c || !c.video) return;
      c.soundReady = true;
      const t = c.video.currentTime;
      c.video.src = m.src;
      c.video.currentTime = t;
      c.video.muted = false;
      c.video.play();
      const b = soundButton(c);
      if (b) {
        b.disabled = false;
        b.replaceChildren(icon("unmute"), document.createTextNode(" " + T.withSound));
      }
    } else if (m.type === "debug") {
      // Solo lo usa la prueba automática para abrir el visor sin hacer clic.
      const c = byPath.get(m.path);
      if (m.action === "image" && c) openImage(c.item);
      if (m.action === "compare" && c && c.item.versions) openCompare(c.item);
      if (m.action === "select" && c) c.querySelector(".sel").click();
      if (m.action === "grid") $("compare").click();
      if (m.action === "sound" && c) soundButton(c).click();
      if (m.action === "soundForce" && c) vscode.postMessage({ type: "withSound", id: c.item.id, path: c.item.path });
      if (m.action === "html" && c) c.querySelector("button.wide").click();
      if (m.action === "kind") [...$("kinds").children].find((b) => b.dataset.kind === m.value).click();
    } else if (m.type === "soundFailed") {
      const c = cardById(m.id);
      const b = c && soundButton(c);
      if (b) {
        b.disabled = false;
        b.replaceChildren(icon("mute"), document.createTextNode(" " + T.noSound));
        b.title = m.text || T.soundFailed;
      }
    }
  });
  // Ya escucho: que la extensión mande el historial (lo enviado antes de este punto se habría perdido).
  vscode.postMessage({ type: "ready" });
})();
