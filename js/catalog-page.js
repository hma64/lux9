import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { sanitizeProduct, getPriceData, isOutOfStockGlobally, formatPrice } from "./product-model.js";
import { getCart, setCart, cartLineTotal, cartCount } from "./cart.js";
import { escapeHtml } from "./utils.js";
import { getLang, setLang, i18n } from "./i18n.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const urlCat = new URLSearchParams(location.search).get("category");
let currentFilter = urlCat || "all";
let allProducts = [];
let currentSearch = "";
let previewVertical = false;

const productsContainer = document.getElementById("productsContainer");
const stateBox = document.getElementById("stateBox");
const filterBar = document.getElementById("filterBar");
const searchInput = document.getElementById("searchInput");
const layoutKebab = document.getElementById("layoutKebab");
const loopTrack = document.getElementById("loopTrack");
const cartDrawer = document.getElementById("cartDrawer");
const cartDim = document.getElementById("cartDim");
const closeCartBtn = document.getElementById("closeCartBtn");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");
const cartCountEl = document.getElementById("cartCount");
const checkoutBtn = document.getElementById("checkoutBtn");

// ── Cart ──────────────────────────────────────────────────────────────────────
function openCart() {
  cartDrawer.classList.add("open");
  cartDim.classList.add("show");
  cartDrawer.setAttribute("aria-hidden", "false");
}
function closeCart() {
  cartDrawer.classList.remove("open");
  cartDim.classList.remove("show");
  cartDrawer.setAttribute("aria-hidden", "true");
}

setTimeout(() => {
  const openCartBtn = document.getElementById("openCartBtn");
  if (openCartBtn) openCartBtn.addEventListener("click", openCart);
}, 0);

closeCartBtn?.addEventListener("click", closeCart);
cartDim?.addEventListener("click", closeCart);

function renderCart() {
  const lang = getLang();
  const cart = getCart();
  cartItems.innerHTML = "";
  if (!cart.length) {
    cartItems.innerHTML = `<div class="state-box">${i18n[lang].cartEmpty || "Votre panier est vide"}</div>`;
  } else {
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-row";
      row.innerHTML = `
        <img src="${escapeHtml(item.image)}" alt="" />
        <div>
          <div style="font-weight:700;">${escapeHtml(item.name)}</div>
          <div style="font-size:0.86rem;color:#666;">${escapeHtml(item.color)} · USA ${escapeHtml(item.tailleUSA || "-")} / EUR ${escapeHtml(item.tailleEUR || "-")}</div>
          <div style="font-weight:700;">${formatPrice(item.unitPrice * item.qty)}</div>
          <div class="qty-wrap">
            <button class="qty-btn" type="button" data-action="minus" data-id="${escapeHtml(item.cartId)}">-</button>
            <span class="qty-num">${item.qty}</span>
            <button class="qty-btn" type="button" data-action="plus" data-id="${escapeHtml(item.cartId)}">+</button>
            <button class="remove-btn" type="button" data-action="remove" data-id="${escapeHtml(item.cartId)}">${i18n[lang].remove || "Supprimer"}</button>
          </div>
        </div>
      `;
      cartItems.appendChild(row);
    });
  }
  cartTotal.textContent = formatPrice(cartLineTotal(cart));
  const count = cartCount(cart);
  if (cartCountEl) {
    cartCountEl.textContent = String(count);
    cartCountEl.style.display = count > 0 ? "inline-block" : "none";
  }
  const smCount = document.getElementById("slideMenuCartCount");
  if (smCount) smCount.textContent = String(count);
}

cartItems?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const cart = getCart();
  const itemIndex = cart.findIndex((x) => x.cartId === id);
  if (itemIndex === -1) return;
  if (action === "plus") cart[itemIndex].qty = Number(cart[itemIndex].qty || 0) + 1;
  if (action === "minus") cart[itemIndex].qty = Math.max(1, Number(cart[itemIndex].qty || 0) - 1);
  if (action === "remove") cart.splice(itemIndex, 1);
  setCart(cart);
  renderCart();
});

checkoutBtn?.addEventListener("click", () => {
  if (!getCart().length) return;
  window.location.href = "checkout.html";
});

// ── Dynamic filter bar ────────────────────────────────────────────────────────
function buildFilterBar(products) {
  if (!filterBar) return;
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  filterBar.innerHTML = `<button type="button" class="filter-btn${currentFilter === "all" ? " active" : ""}" data-category="all">Tout</button>` +
    cats.map(c => `<button type="button" class="filter-btn${currentFilter === c ? " active" : ""}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
  filterBar.addEventListener("click", (event) => {
    const btn = event.target.closest(".filter-btn");
    if (!btn) return;
    currentFilter = btn.dataset.category;
    const u = new URL(location.href);
    u.searchParams.set("category", currentFilter);
    history.replaceState({}, "", u);
    applyFilter();
  });
}

// ── Loop gallery ──────────────────────────────────────────────────────────────
function renderLoopGallery() {
  if (!loopTrack) return;
  if (!allProducts.length) { loopTrack.innerHTML = ""; return; }
  const chunk = allProducts.map(product => `
    <div class="loop-item">
      <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />
      <span>${escapeHtml(product.name)}</span>
    </div>
  `).join("");
  loopTrack.innerHTML = chunk + chunk;
}

// ── Product cards ─────────────────────────────────────────────────────────────
function getTagMeta(tag = "") {
  if (!tag) return { cardClass: "", text: "" };
  if (tag.match(/-?\s*(\d{1,2})\s*%/)) return { cardClass: "promo", text: tag };
  if (tag.toLowerCase().includes("out of stock") || tag.toLowerCase().includes("rupture")) return { cardClass: "stock", text: tag };
  return { cardClass: "", text: tag };
}

function renderProducts(list) {
  const lang = getLang();
  productsContainer.innerHTML = "";
  if (!list.length) {
    showState(i18n[lang].noProducts || "Aucun produit trouvé.");
    return;
  }
  hideState();
  list.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = `product-card ${isOutOfStockGlobally(product) ? "is-out" : ""}`;
    card.style.animationDelay = `${index * 60}ms`;
    const pd = getPriceData(product);
    const tagM = getTagMeta(product.tag);
    const href = `product.html?id=${encodeURIComponent(product.id)}`;
    const sizesLabel = product.tailleUSA && product.tailleUSA.length ? `Tailles: ${product.tailleUSA.join(", ")}` : "";
    card.innerHTML = `
      <a class="product-image-wrap" href="${href}">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" />
        ${tagM.cardClass ? `<span class="product-tag ${tagM.cardClass}">${escapeHtml(product.tag)}</span>` : ""}
      </a>
      <div class="product-info">
        <span class="badge">${escapeHtml(product.category)}</span>
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <div class="price-wrap">
          <span class="price">${formatPrice(pd.finalPrice)}</span>
          ${pd.oldPrice ? `<span class="old-price">${formatPrice(pd.oldPrice)}</span>` : ""}
        </div>
        ${sizesLabel ? `<div class="product-sizes-line">${escapeHtml(sizesLabel)}</div>` : ""}
        <div class="product-actions">
          <a class="mini-btn" href="${href}">Choisir taille</a>
          <a class="mini-btn btn-primary" href="${href}">Aperçu</a>
        </div>
      </div>
    `;
    productsContainer.appendChild(card);
  });
}

function showState(msg) { if(stateBox){ stateBox.style.display = "block"; stateBox.textContent = msg; } }
function hideState() { if(stateBox){ stateBox.style.display = "none"; stateBox.textContent = ""; } }

function getCategoryProducts() {
  return currentFilter === "all" ? allProducts : allProducts.filter(item => item.category === currentFilter);
}

function setActiveFilterButton(category) {
  if (!filterBar) return;
  filterBar.querySelectorAll(".filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.category === category));
}

function applyFilter() {
  const filtered = getCategoryProducts().filter(item => {
    const text = `${item.name} ${item.category}`.toLowerCase();
    return text.includes(currentSearch.toLowerCase());
  });
  renderProducts(filtered);
  setActiveFilterButton(currentFilter);
}

if (searchInput) {
  searchInput.addEventListener("input", () => { currentSearch = searchInput.value.trim(); applyFilter(); });
}

if (layoutKebab) {
  layoutKebab.addEventListener("click", () => {
    previewVertical = !previewVertical;
    productsContainer.classList.toggle("vertical", previewVertical);
    layoutKebab.classList.toggle("is-vertical", previewVertical);
    layoutKebab.setAttribute("aria-pressed", previewVertical ? "true" : "false");
  });
}

// ── Load products ──────────────────────────────────────────────────────────────
function loadProducts() {
  const lang = getLang();
  showState(i18n[lang].loading || "Chargement…");
  onSnapshot(
    collection(db, "products"),
    (snapshot) => {
      const fetched = [];
      snapshot.forEach(docSnap => fetched.push(sanitizeProduct(docSnap.id, docSnap.data())));
      allProducts = fetched;
      buildFilterBar(allProducts);
      if (!allProducts.length) {
        showState(i18n[lang].noFirestore || "Aucun produit.");
        productsContainer.innerHTML = "";
        if (loopTrack) loopTrack.innerHTML = "";
        return;
      }
      hideState();
      renderLoopGallery();
      applyFilter();
    },
    () => showState(i18n[getLang()].loadError || "Erreur de chargement.")
  );
}

// ── i18n ──────────────────────────────────────────────────────────────────────
function applyI18n() {
  const lang = getLang();
  document.documentElement.lang = lang === "ar" ? "ar" : "fr";
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  const map = [
    ["pageCatalogTitle", "catalogPageTitle", true],
    ["cartHeadLabel", "cartTitle"],
    ["cartTotalLabel", "total"],
    ["checkoutBtn", "validatePurchases"],
    ["footerNote", "footer"],
  ];
  for (const [id, key, html] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    const val = (i18n[lang] && i18n[lang][key]) || (i18n.fr && i18n.fr[key]) || "";
    if (html) el.innerHTML = val; else el.textContent = val;
  }
  if (searchInput) searchInput.placeholder = (i18n[lang] && i18n[lang].searchPlaceholder) || "Rechercher un produit…";
  applyFilter();
}

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add("show"); });
});
document.querySelectorAll(".reveal").forEach(el => observer.observe(el));

document.getElementById("year").textContent = String(new Date().getFullYear());

applyI18n();
renderCart();
loadProducts();

if (sessionStorage.getItem("lux_open_cart")) {
  sessionStorage.removeItem("lux_open_cart");
  setTimeout(() => openCart(), 400);
}
