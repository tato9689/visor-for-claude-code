// Panel lateral: lista de lo que Claude ha leído o generado, lo más nuevo arriba.
(function () {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById("list");
  const status = document.getElementById("status");
  const viewer = document.getElementById("viewer");
  const viewerBody = document.getElementById("viewer-body");
  const seen = new Set();
  const byPath = new Map(); // ruta → tarjeta: si el mismo archivo vuelve a aparecer, sube arriba en vez de duplicarse

  const ICON = { image: "🖼️", svg: "✒️", html: "🌐", video: "🎬" };

  function time(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function card(item) {
    const c = el("div", "card");
    const head = el("div", "head");
    head.append(el("span", "icon", ICON[item.kind] || "📄"));
    const name = el("span", "name", item.name);
    name.title = item.path || "";
    head.append(name);
    head.append(el("span", "meta", (item.action === "write" ? "escrito" : "leído") + " · " + time(item.timestamp)));
    c.append(head);

    if (item.src && (item.kind === "image" || item.kind === "svg")) {
      const img = el("img", "thumb");
      img.src = item.src;
      img.alt = item.name;
      img.onclick = () => openViewer(item);
      c.append(img);
    } else if (item.src && item.kind === "video") {
      const v = el("video", "thumb");
      v.src = item.src;
      v.controls = true;
      v.muted = true;
      v.preload = "metadata";
      c.append(v);
    } else if (item.kind === "html") {
      const b = el("button", "wide", "Ver HTML renderizado");
      b.onclick = () => vscode.postMessage({ type: "openHtml", path: item.path });
      c.append(b);
    } else if (item.missing) {
      c.append(el("div", "missing", "El archivo ya no está en disco"));
    }

    if (item.path) {
      const actions = el("div", "actions");
      const btn = (label, type) => {
        const b = el("button", "", label);
        b.onclick = () => vscode.postMessage({ type, path: item.path });
        actions.append(b);
      };
      btn("Abrir", "open");
      btn("Copiar ruta", "copyPath");
      btn("Mostrar", "reveal");
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
    if (item.path) byPath.set(item.path, c);
    if (atTop) list.prepend(c);
    else list.append(c);
    status.textContent = "";
  }

  function openViewer(item) {
    viewerBody.replaceChildren();
    const img = el("img");
    img.src = item.src;
    viewerBody.append(img);
    viewer.hidden = false;
  }
  document.getElementById("close").onclick = () => (viewer.hidden = true);
  viewer.onclick = (e) => {
    if (e.target === viewer) viewer.hidden = true;
  };

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m.type === "reset") {
      list.replaceChildren();
      seen.clear();
      byPath.clear();
      for (const it of m.items.slice().reverse()) add(it, false);
      status.textContent = m.items.length ? "" : "Esperando a que Claude lea o genere algo…";
    } else if (m.type === "add") {
      add(m.item, true);
    } else if (m.type === "clear") {
      list.replaceChildren();
      seen.clear();
      byPath.clear();
      status.textContent = "Panel vaciado.";
    } else if (m.type === "paused") {
      status.textContent = m.value ? "⏸ En pausa" : "";
    } else if (m.type === "status") {
      status.textContent = m.text;
    }
  });
})();
