/* bycarlo.es — chat de AiCarlo
   - Las sugerencias tienen respuesta ya escrita (CANNED): instantáneas y sin coste.
   - El texto libre va a la función /api/chat, que habla con el modelo.
   - "Sí, mándamelo" envía correo + conversación al formulario "resumen" de Netlify.
   - "Lo quiero" (paquetes y tarjetas del chat) abre la ventana de pedido: formulario "pedido" de Netlify. */

(() => {
  "use strict";

  // Correo de contacto (provisional hasta tener uno del dominio). Se usa en los avisos del chat y en el botón "Escríbeme".
  const EMAIL = "carloby@gmail.com";
  const MAX_USER_TURNS = 12;

  // Paquetes que el chat puede enseñar como tarjeta. Si cambias un precio aquí,
  // cámbialo también en index.html y en netlify/functions/chat/instrucciones.mts.
  const PACKS = {
    web: {
      kind: "Paquete", name: "Web que vende", short: "Landing en una semana",
      desc: "Landing en Framer con textos, formulario y analítica. Entregada en una semana.",
      price: "desde 900 €", cta: "Lo quiero",
    },
    tienda: {
      kind: "Paquete", name: "Tienda online", short: "Catálogo, pagos y envíos",
      desc: "Tienda en Shopify o WooCommerce con catálogo, pagos, envíos y textos de producto.",
      price: "desde 2.500 €", cta: "Lo quiero",
    },
    mensual: {
      kind: "Paquete", name: "Plan mensual", short: "Contenido, email y web al día",
      desc: "Blog, newsletter, piezas para redes y la web siempre actualizada.",
      price: "desde 450 €/mes", cta: "Lo quiero",
    },
    auditoria: {
      kind: "Servicio", name: "Auditoría exprés", short: "Diez mejoras en vídeo",
      desc: "Carlo revisa tu web a fondo y te manda un vídeo con diez mejoras concretas.",
      price: "150 €", cta: "La quiero",
    },
    auto: {
      kind: "Servicio", name: "Automatización a medida", short: "Un flujo funcionando",
      desc: "Un flujo en Make funcionando y documentado para que lo entiendas.",
      price: "desde 300 €", cta: "Lo quiero",
    },
  };

  // Respuestas ya escritas para las sugerencias. Edítalas con tu voz.
  const CANNED = {
    web: {
      q: "Quiero una web que venda",
      a: "Una web bonita que no vende es un cuadro caro. Te hace falta una página con un mensaje claro, una sola acción y un formulario que te avise cuando alguien escribe. Justo esto:",
      cards: ["web"], offer: true,
    },
    auto: {
      q: "Automatiza mi negocio",
      a: "Si copias datos a mano de un sitio a otro, estás regalando horas. Empiezo por lo que más se repite: bienvenida a contactos nuevos, seguimiento de interesados y petición de reseñas.",
      cards: ["auto"], offer: true,
    },
    revisa: {
      q: "¿Por qué mi web no vende?",
      a: "Pégame aquí el enlace de tu web y te digo tres cosas que cambiaría. Gratis y sin anestesia.",
      cards: [], offer: false, focus: true,
    },
    horoscopo: {
      q: "Mi horóscopo web",
      a: "Dime tu signo y te leo lo que dicen los astros de tu web. Aviso: la culpa casi nunca es de Plutón.",
      cards: [], offer: false, focus: true,
    },
    precio: {
      q: "¿Cuánto cuesta?",
      a: "Al grano, que me gusta. Estas son las formas de trabajar conmigo. Si no sabes cuál es la tuya, dime a qué te dedicas y te lo digo yo.",
      cards: ["web", "tienda", "mensual"], offer: false,
    },
  };

  const thread = document.getElementById("thread");
  const composer = document.getElementById("composer");
  const input = document.getElementById("msg");
  const sendBtn = composer.querySelector(".send");
  const chips = Array.from(document.querySelectorAll(".chip"));

  const history = []; // { role: "user" | "assistant", content }
  let userTurns = 0;
  let busy = false;
  let leadSent = false;

  document.querySelectorAll("[data-email-link]").forEach((a) => { a.href = "mailto:" + EMAIL; });

  /* ---------- pintar ---------- */

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function keepInView() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    composer.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }

  function add(node) {
    thread.appendChild(node);
    keepInView();
    return node;
  }

  const addUser = (text) => add(el("div", "bubble bubble-user", text));
  const addBot = (text) => add(el("div", "bubble bubble-bot", text));

  function addCard(key) {
    const p = PACKS[key];
    if (!p) return;
    const card = el("div", "card");
    const main = el("div", "card-main");
    main.append(el("div", "card-kind", p.kind), el("div", "card-name", p.name), el("div", "card-desc", p.desc));
    const side = el("div", "card-side");
    const link = el("a", "btn btn-light", p.cta);
    link.href = "#pedido";
    link.dataset.pedido = key;
    side.append(el("div", "card-price", p.price), link);
    card.append(main, side);
    add(card);
  }

  function addCardsRow(keys) {
    const row = el("div", "cards-row");
    keys.forEach((key) => {
      const p = PACKS[key];
      if (!p) return;
      const a = el("a", "mini");
      a.href = p.href;
      a.append(el("span", "mini-name", p.name), el("span", "mini-desc", p.short), el("span", "mini-price", p.price));
      row.appendChild(a);
    });
    add(row);
  }

  function addCards(keys) {
    if (!keys || !keys.length) return;
    if (keys.length === 1) addCard(keys[0]);
    else addCardsRow(keys);
  }

  function showTyping() {
    const b = el("div", "bubble bubble-bot typing");
    b.setAttribute("aria-label", "AiCarlo está escribiendo");
    b.append(el("i"), el("i"), el("i"));
    return add(b);
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state;
    chips.forEach((c) => { c.disabled = state; });
  }

  /* ---------- "te lo mando al correo" ---------- */

  function offerSummary() {
    if (leadSent) return;
    thread.querySelectorAll(".cta").forEach((n) => n.remove());

    const box = el("div", "bubble bubble-bot cta");
    box.appendChild(el("div", "", "¿Te lo mando resumido al correo? Por escrito queda todo más claro."));
    const yes = el("button", "btn btn-accent", "Sí, mándamelo");
    yes.type = "button";
    box.appendChild(yes);
    add(box);

    yes.addEventListener("click", () => {
      yes.remove();
      const form = el("form", "lead-form");
      const label = el("label", "sr-only", "Tu correo");
      label.htmlFor = "lead-email";
      const mail = el("input");
      mail.type = "email";
      mail.id = "lead-email";
      mail.required = true;
      mail.placeholder = "tu@correo.com";
      mail.autocomplete = "email";
      const go = el("button", "btn btn-accent", "Enviar");
      go.type = "submit";
      form.append(label, mail, go);

      const note = el("p", "lead-note");
      note.append("Guardo tu correo y esta conversación solo para contestarte. ");
      const priv = el("a", "", "Política de privacidad");
      priv.href = "/privacidad.html";
      note.append(priv, ".");

      box.append(form, note);
      mail.focus();
      keepInView();

      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        if (!mail.checkValidity()) { mail.reportValidity(); return; }
        go.disabled = true;
        go.textContent = "Enviando…";
        const ok = await sendLead(mail.value.trim());
        box.remove();
        if (ok) {
          leadSent = true;
          addBot("Hecho. Te escribo yo, la de carne y hueso, en cuanto lo lea.");
        } else {
          addBot("No he podido enviarlo. Escríbeme directamente a " + EMAIL + " y te contesto igual.");
        }
      });
    });
  }

  async function sendLead(email) {
    const transcript = history
      .map((m) => (m.role === "user" ? "Visitante: " : "AiCarlo: ") + m.content)
      .join("\n\n");
    try {
      const res = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ "form-name": "resumen", email, apodo: "", conversacion: transcript }).toString(),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  /* ---------- pedido ---------- */

  const pedido = document.getElementById("pedido");
  const pedidoForm = document.getElementById("pedido-form");
  const pedidoDone = document.getElementById("pedido-done");

  function addPedidoBubble(text) {
    const box = el("div", "bubble bubble-bot cta");
    box.appendChild(el("div", "", text));
    const go = el("a", "btn btn-accent", "Pedir mi paquete");
    go.href = "#pedido";
    go.dataset.pedido = "";
    box.appendChild(go);
    add(box);
  }

  function openPedido(key) {
    if (!pedido || typeof pedido.showModal !== "function") return false;
    pedidoForm.hidden = false;
    pedidoDone.hidden = true;
    if (key && pedidoForm.paquete.querySelector('option[value="' + key + '"]')) pedidoForm.paquete.value = key;
    pedido.showModal();
    pedidoForm.querySelector("input, select, textarea").focus();
    return true;
  }

  document.addEventListener("click", (ev) => {
    const trigger = ev.target.closest("[data-pedido]");
    if (trigger && openPedido(trigger.dataset.pedido)) ev.preventDefault();
  });

  if (pedido) {
    pedido.querySelector(".pedido-close").addEventListener("click", () => pedido.close());
    pedido.querySelector(".pedido-back").addEventListener("click", () => pedido.close());
    pedido.addEventListener("click", (ev) => { if (ev.target === pedido) pedido.close(); });

    pedidoForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!pedidoForm.checkValidity()) { pedidoForm.reportValidity(); return; }
      const send = pedidoForm.querySelector('button[type="submit"]');
      const error = pedidoForm.querySelector(".pedido-error");
      send.disabled = true;
      send.textContent = "Enviando…";
      error.hidden = true;
      const fields = new URLSearchParams(new FormData(pedidoForm));
      fields.set("form-name", "pedido");
      fields.set("conversacion", history.map((m) => (m.role === "user" ? "Visitante: " : "AiCarlo: ") + m.content).join("\n\n"));
      let ok = false;
      try {
        const res = await fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: fields.toString() });
        ok = res.ok;
      } catch (err) {
        ok = false;
      }
      send.disabled = false;
      send.textContent = "Enviar pedido";
      if (ok) {
        pedidoForm.reset();
        pedidoForm.hidden = true;
        pedidoDone.hidden = false;
        pedidoDone.querySelector("button").focus();
      } else {
        error.hidden = false;
      }
    });
  }

  /* ---------- conversación ---------- */

  function limitReached() {
    if (userTurns < MAX_USER_TURNS) return false;
    addPedidoBubble("Hasta aquí llego yo. Si ya sabes lo que quieres, pídelo aquí y Carlo te manda la propuesta con precio cerrado.");
    return true;
  }

  function runCanned(key) {
    const c = CANNED[key];
    if (!c || busy || limitReached()) return;
    userTurns += 1;
    addUser(c.q);
    history.push({ role: "user", content: c.q });
    addBot(c.a);
    history.push({ role: "assistant", content: c.a });
    addCards(c.cards);
    if (c.offer) offerSummary();
    if (c.focus) input.focus({ preventScroll: true });
  }

  async function runFree(text) {
    if (busy || limitReached()) return;
    userTurns += 1;
    addUser(text);
    history.push({ role: "user", content: text });
    setBusy(true);
    const typing = showTyping();

    let data = null;
    let status = 0;
    // Si falla o se atasca, se reintenta una vez pidiendo el modelo rápido.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.slice(-20), rapido: attempt > 0 }),
        });
        status = res.status;
        data = await res.json().catch(() => null);
      } catch (err) {
        status = 0;
        data = null;
      }
      if ((data && data.reply) || (status >= 400 && status < 500)) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }

    typing.remove();
    setBusy(false);

    if (data && typeof data.reply === "string" && data.reply) {
      addBot(data.reply);
      history.push({ role: "assistant", content: data.reply });
      const cards = Array.isArray(data.cards) ? data.cards.filter((k) => PACKS[k]) : [];
      addCards(cards);
      if (cards.length === 1) offerSummary();
      if (data.limit) userTurns = MAX_USER_TURNS;
    } else {
      history.pop();
      userTurns -= 1;
      if (status === 429) {
        addBot("Vas más rápido que yo. Dame un minuto y vuelve a preguntarme.");
      } else {
        addPedidoBubble("Se me ha atascado la respuesta. Pregúntamelo otra vez en un momento o, si ya sabes lo que quieres, pídelo aquí.");
      }
    }
    input.focus({ preventScroll: true });
  }

  composer.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    runFree(text);
  });

  chips.forEach((chip) => {
    chip.addEventListener("click", () => runCanned(chip.dataset.canned));
  });
})();
