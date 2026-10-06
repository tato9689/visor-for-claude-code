// Visor grande (pestaña del editor): imagen con zoom, antes/después y variantes en cuadrícula.
(function () {
  const vscode = acquireVsCodeApi();
  const viewerBar = document.getElementById("viewer-bar");
  const viewerBody = document.getElementById("viewer-body");
  const PIXEL_MAX = 256; // imágenes de este tamaño o menos se tratan como pixel art

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


  // ---------- visor ----------

  let redraw = null; // repinta al cambiar el tamaño de la pestaña
  function showViewer(bar, body) {
    viewerBar.replaceChildren(...bar);
    viewerBody.replaceChildren(body);
  }

  /** Imagen ampliada con zoom y modo píxel. */
  function openImage(item) {
    const wrap = el("div", "zoom");
    const img = el("img", "checker");
    img.src = item.src;
    wrap.append(img);
    let scale = 0; // 0 = ajustar a la pantalla
    let pixel = false;
    const label = el("span", "zoomlabel");
    const apply = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w) return;
      const fit = Math.min((window.innerWidth - 24) / w, (window.innerHeight - 70) / h);
      // Pixel art: ajustar a un múltiplo entero, que es lo único que se ve nítido.
      const s = scale || (pixel && fit >= 1 ? Math.floor(fit) : Math.min(fit, pixel ? fit : 1));
      img.style.width = w * s + "px";
      img.style.height = h * s + "px";
      img.classList.toggle("pixel", pixel);
      label.textContent = Math.round(s * 100) + "% · " + w + "×" + h;
      pixBtn.classList.toggle("on", pixel);
    };
    const zoom = (f) => () => {
      const cur = parseFloat(img.style.width) / img.naturalWidth || 1;
      scale = Math.max(0.1, Math.min(64, pixel ? Math.max(1, Math.round(cur * f)) : cur * f));
      apply();
    };
    const pixBtn = button("primitive-square", "Píxeles nítidos", "Ver el pixel art sin suavizar", () => {
      pixel = !pixel;
      apply();
    });
    img.onload = () => {
      pixel = img.naturalWidth <= PIXEL_MAX && img.naturalHeight <= PIXEL_MAX;
      apply();
    };
    redraw = apply;
    showViewer(
      [
        button("zoom-out", "", "Alejar", zoom(0.5)),
        button("zoom-in", "", "Acercar", zoom(2)),
        button("screen-full", "Ajustar", "Ajustar a la pantalla", () => {
          scale = 0;
          apply();
        }),
        pixBtn,
        label,
      ],
      wrap,
    );
  }

  /** Antes / después: barra deslizante sobre las dos versiones, o lado a lado. */
  function openCompare(item) {
    const versions = item.versions;
    let before = versions.length - 2;
    let mode = "slider";
    const pixel = { on: false };

    const select = el("select");
    versions.slice(0, -1).forEach((v, i) => {
      const o = el("option", "", "v" + (i + 1) + (v.timestamp ? " · " + time(v.timestamp) : ""));
      o.value = String(i);
      select.append(o);
    });
    select.value = String(before);
    select.title = "Versión con la que comparar";
    select.onchange = () => {
      before = Number(select.value);
      render();
    };

    const modeBtn = button("split-horizontal", "Lado a lado", "Cambiar entre barra deslizante y lado a lado", () => {
      mode = mode === "slider" ? "side" : "slider";
      modeBtn.replaceChildren(icon(mode === "slider" ? "split-horizontal" : "diff"), document.createTextNode(mode === "slider" ? " Lado a lado" : " Deslizar"));
      render();
    });

    const body = el("div", "compare");
    function render() {
      body.replaceChildren();
      let stage = null; // solo en modo deslizante
      const a = versions[before];
      const b = versions[versions.length - 1];
      const imgA = el("img", "checker");
      const imgB = el("img", "checker");
      imgA.src = a.src;
      imgB.src = b.src;
      const labelA = "v" + (before + 1) + " (antes)";
      const labelB = "v" + versions.length + " (ahora)";
      imgB.onload = () => {
        pixel.on = imgB.naturalWidth <= PIXEL_MAX && imgB.naturalHeight <= PIXEL_MAX;
        body.classList.toggle("pixel-mode", pixel.on);
        sizeStage();
      };
      if (mode === "side") {
        body.className = "compare side";
        for (const [img, label] of [[imgA, labelA], [imgB, labelB]]) {
          const fig = el("figure");
          fig.append(img, el("figcaption", "", label));
          body.append(fig);
        }
        return;
      }
      body.className = "compare slider";
      stage = el("div", "stage");
      imgB.classList.add("after");
      stage.append(imgA, imgB, el("span", "tag left", labelA), el("span", "tag right", labelB));
      const line = el("div", "line");
      stage.append(line);
      const range = el("input");
      range.type = "range";
      range.min = "0";
      range.max = "100";
      range.value = "50";
      range.title = "Arrastra para comparar";
      const set = () => {
        imgB.style.clipPath = "inset(0 0 0 " + range.value + "%)";
        line.style.left = range.value + "%";
      };
      range.oninput = set;
      // Arrastrar directamente sobre la imagen también mueve la barra.
      stage.onpointerdown = (ev) => {
        const move = (e) => {
          const r = stage.getBoundingClientRect();
          range.value = String(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
          set();
        };
        move(ev);
        stage.setPointerCapture(ev.pointerId);
        stage.onpointermove = move;
        stage.onpointerup = () => (stage.onpointermove = null);
      };
      set();
      body.append(stage, range);
      function sizeStage() {
        if (!stage) return;
        const w = imgB.naturalWidth;
        const h = imgB.naturalHeight;
        if (!w) return;
        let s = Math.min((window.innerWidth - 24) / w, (window.innerHeight - 110) / h);
        if (pixel.on && s >= 1) s = Math.floor(s);
        else s = Math.min(s, 1);
        stage.style.width = w * s + "px";
        stage.style.height = h * s + "px";
      }
    }
    render();
    redraw = render;
    showViewer([select, modeBtn], body);
  }

  /** Variantes en cuadrícula: se elige una y se le dice a Claude. */
  function openGrid(items) {
    const grid = el("div", "grid");
    for (const it of items) {
      const fig = el("figure");
      const img = el("img", "checker");
      img.src = it.src;
      img.onload = () => {
        if (img.naturalWidth <= PIXEL_MAX && img.naturalHeight <= PIXEL_MAX) img.classList.add("pixel");
      };
      img.onclick = () => openImage(it);
      fig.append(img, el("figcaption", "", it.name));
      fig.append(button("check", "Me quedo con esta", "Se lo escribe a Claude (tú le das a Enter)", () => {
        vscode.postMessage({ type: "pick", path: it.path });
      }, "primary"));
      grid.append(fig);
    }
    grid.style.setProperty("--cols", String(Math.min(items.length, items.length === 4 ? 2 : 3)));
    showViewer([el("span", "zoomlabel", items.length + " variantes · clic en una para ampliarla")], grid);
  }

  window.addEventListener("resize", () => redraw && redraw());

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    redraw = null;
    if (m.type === "image") openImage(m.item);
    else if (m.type === "compare") openCompare(m.item);
    else if (m.type === "grid") openGrid(m.items);
  });
  vscode.postMessage({ type: "viewerReady" });
})();
