"use strict";

const STORAGE_KEY = "zampar-v1";
const BACKUP_KEY = "zampar-v1-copia";
const TABS = { zaragoza: "Zaragoza", espana: "España", mundo: "Mundo" };
const TIPOS = { formal: "Formal", informal: "Informal", tapeo: "Tapeo", investigar: "Investigar" };
const PLACEHOLDER_UBICACION = {
  zaragoza: "Barrio o zona (opcional)",
  espana: "Ciudad o provincia",
  mundo: "Ciudad, país",
};
const DELETE_WIDTH = 84;
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

const list = document.getElementById("list");
const count = document.getElementById("count");
const filterTipo = document.getElementById("filterTipo");
const filterUbicacion = document.getElementById("filterUbicacion");
const ficha = document.getElementById("ficha");
const form = document.getElementById("fichaForm");
const fichaTitle = document.getElementById("fichaTitle");
const fDelete = document.getElementById("fDelete");

let restaurants = load();
let currentTab = "zaragoza";
let editingId = null;
let openId = null;
let swipedId = null;
const filters = {
  zaragoza: { tipo: "", ubicacion: "" },
  espana: { tipo: "", ubicacion: "" },
  mundo: { tipo: "", ubicacion: "" },
};

// Datos

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("Formato no válido");
    return data;
  } catch (err) {
    // No perder nada en silencio: se guarda una copia antes de empezar de cero.
    localStorage.setItem(BACKUP_KEY, raw);
    alert("No se han podido leer los datos guardados. Se ha creado una copia de seguridad.");
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(restaurants));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function findRestaurant(id) {
  return restaurants.find((r) => r.id === id);
}

function removeRestaurant(id) {
  const r = findRestaurant(id);
  if (!r || !confirm(`¿Borrar «${r.nombre}»?`)) return;
  restaurants = restaurants.filter((item) => item.id !== id);
  if (openId === id) openId = null;
  if (swipedId === id) swipedId = null;
  save();
  render();
}

function toggleVisited(id) {
  const r = findRestaurant(id);
  r.visitado = !r.visitado;
  save();
  render();
}

// Orden: Zaragoza por nombre; España y Mundo por ubicación (y luego por nombre).
function compare(a, b) {
  if (currentTab === "zaragoza") return collator.compare(a.nombre, b.nombre);
  return collator.compare(a.ubicacion, b.ubicacion) || collator.compare(a.nombre, b.nombre);
}

function visibleRestaurants() {
  const f = filters[currentTab];
  return restaurants
    .filter((r) => r.tab === currentTab)
    .filter((r) => !f.tipo || r.tipo === f.tipo)
    .filter((r) => currentTab === "zaragoza" || !f.ubicacion || r.ubicacion === f.ubicacion)
    .sort(compare);
}

// Renderizado

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function option(value, label) {
  const o = el("option", "", label);
  o.value = value;
  return o;
}

function render() {
  renderFilters();
  const items = visibleRestaurants();
  list.dataset.tab = currentTab;
  list.replaceChildren(...items.map(renderRow));
  if (!items.length) {
    list.append(el("p", "empty", "Aún no hay restaurantes aquí. Pulsa + para añadir uno."));
  }
  count.textContent = `${items.length} ${items.length === 1 ? "restaurante" : "restaurantes"}`;
}

function renderFilters() {
  const f = filters[currentTab];
  filterTipo.replaceChildren(
    option("", "Todos los tipos"),
    ...Object.entries(TIPOS).map(([value, label]) => option(value, label))
  );
  filterTipo.value = f.tipo;

  if (currentTab === "zaragoza") {
    filterUbicacion.hidden = true;
    f.ubicacion = "";
    return;
  }

  const ubicaciones = [
    ...new Set(restaurants.filter((r) => r.tab === currentTab && r.ubicacion).map((r) => r.ubicacion)),
  ].sort(collator.compare);
  if (!ubicaciones.includes(f.ubicacion)) f.ubicacion = "";

  filterUbicacion.hidden = false;
  filterUbicacion.replaceChildren(
    option("", "Todas las ubicaciones"),
    ...ubicaciones.map((u) => option(u, u))
  );
  filterUbicacion.value = f.ubicacion;
}

function renderRow(r) {
  const row = el("div", "row");
  row.dataset.id = r.id;
  row.classList.toggle("swiped", swipedId === r.id);
  row.classList.toggle("open", openId === r.id);

  const del = el("button", "row-delete", "Borrar");
  del.type = "button";
  del.addEventListener("click", () => removeRestaurant(r.id));

  const content = el("div", "row-content");

  const check = el("button", "check" + (r.visitado ? " done" : ""));
  check.type = "button";
  check.setAttribute("aria-pressed", String(r.visitado));
  check.setAttribute("aria-label", r.visitado ? "Visitado" : "Sin visitar");
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVisited(r.id);
  });

  const line1 = el("div", "line1");
  line1.append(check, el("span", "name", r.nombre), el("span", "tipo", TIPOS[r.tipo] || ""));
  if (currentTab !== "mundo") line1.append(el("span", "ubic", r.ubicacion || ""));
  content.append(line1);

  if (currentTab === "mundo") content.append(el("div", "line2 ubic", r.ubicacion || ""));
  content.append(el("div", "line2 notes", r.notas || ""));

  if (openId === r.id) {
    const edit = el("button", "edit", "Editar ficha");
    edit.type = "button";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      openFicha(findRestaurant(r.id));
    });
    content.append(edit);
  }

  attachRowGestures(content, row, r.id);
  row.append(del, content);
  return row;
}

// Gestos: tocar despliega la fila; deslizar a la izquierda muestra «Borrar».

function attachRowGestures(content, row, id) {
  let startX = 0;
  let offset = 0;
  let dragging = false;
  let moved = false;

  content.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    startX = e.clientX;
    offset = 0;
    dragging = true;
    moved = false;
    content.setPointerCapture(e.pointerId);
  });

  content.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 8) return;
    moved = true;
    const base = swipedId === id ? -DELETE_WIDTH : 0;
    offset = Math.min(0, Math.max(-DELETE_WIDTH, base + dx));
    content.classList.add("dragging");
    content.style.transform = `translateX(${offset}px)`;
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    content.classList.remove("dragging");
    content.style.transform = "";
    if (!moved) return;
    const opened = offset < -DELETE_WIDTH / 2;
    setSwiped(opened ? id : null);
    row.classList.toggle("swiped", opened);
  };
  content.addEventListener("pointerup", endDrag);
  content.addEventListener("pointercancel", endDrag);

  content.addEventListener("click", () => {
    if (moved) {
      moved = false;
      return;
    }
    // Con una fila deslizada, tocar cierra el deslizamiento en lugar de desplegar.
    if (swipedId) {
      setSwiped(null);
      return;
    }
    openId = openId === id ? null : id;
    render();
  });
}

function setSwiped(id) {
  const previous = [...list.children].find((row) => row.dataset.id === swipedId);
  if (previous) previous.classList.remove("swiped");
  swipedId = id;
}

// Ficha

function openFicha(r) {
  editingId = r ? r.id : null;
  fichaTitle.textContent = r ? "Editar restaurante" : `Nuevo restaurante · ${TABS[currentTab]}`;
  fDelete.hidden = !r;
  form.reset();
  form.nombre.value = r ? r.nombre : "";
  form.querySelectorAll('input[name="tipo"]').forEach((input) => {
    input.checked = r ? input.value === r.tipo : false;
  });
  form.ubicacion.value = r ? r.ubicacion : "";
  form.ubicacion.placeholder = PLACEHOLDER_UBICACION[currentTab];
  form.ubicacion.required = currentTab !== "zaragoza";
  form.visitado.checked = Boolean(r && r.visitado);
  form.notas.value = r ? r.notas : "";
  ficha.showModal();
  form.nombre.focus();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    nombre: form.nombre.value.trim(),
    tipo: form.tipo.value,
    ubicacion: form.ubicacion.value.trim(),
    visitado: form.visitado.checked,
    notas: form.notas.value.trim(),
  };
  if (editingId) {
    Object.assign(findRestaurant(editingId), data);
  } else {
    restaurants.push({ id: newId(), tab: currentTab, ...data });
  }
  save();
  ficha.close();
  render();
});

fDelete.addEventListener("click", () => {
  const id = editingId;
  ficha.close();
  removeRestaurant(id);
});

document.getElementById("fCancel").addEventListener("click", () => ficha.close());

document.getElementById("addBtn").addEventListener("click", () => openFicha(null));

// Pestañas y filtros

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    openId = null;
    swipedId = null;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
    render();
  });
});

filterTipo.addEventListener("change", () => {
  filters[currentTab].tipo = filterTipo.value;
  render();
});

filterUbicacion.addEventListener("change", () => {
  filters[currentTab].ubicacion = filterUbicacion.value;
  render();
});

// Copia de seguridad

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(restaurants, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `zampar-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const valid = Array.isArray(data) && data.every((r) => r && typeof r.nombre === "string" && TABS[r.tab]);
    if (!valid) throw new Error("Formato no válido");
    if (!confirm(`Se sustituirán los ${restaurants.length} restaurantes actuales por los ${data.length} del archivo. ¿Continuar?`)) return;
    restaurants = data;
    save();
    render();
  } catch (err) {
    alert("No se ha podido importar el archivo: " + err.message);
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

render();
