(() => {
  "use strict";

  const HISTORY_KEY = "produceScanHistory";
  const EXPIRY_KEY = "produceScanExpiryDates";
  const MAX_HISTORY = 12;

  const els = {
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    reader: document.getElementById("reader"),
    scanStatus: document.getElementById("scanStatus"),
    manualInput: document.getElementById("manualInput"),
    lookupBtn: document.getElementById("lookupBtn"),
    searchResults: document.getElementById("searchResults"),
    result: document.getElementById("result"),
    history: document.getElementById("history"),
    historyList: document.getElementById("historyList"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
    expiryPanel: document.getElementById("expiryPanel"),
    expiryProduct: document.getElementById("expiryProduct"),
    expiryDate: document.getElementById("expiryDate"),
    checkExpiryBtn: document.getElementById("checkExpiryBtn"),
    expiryResult: document.getElementById("expiryResult"),
  };

  let html5QrCode = null;
  let scanning = false;
  let lastScanAt = 0;
  let noScanHintTimer = null;

  const NO_SCAN_HINT =
    "Still nothing? Fruit stickers are hard to scan even when they do have a real barcode - the " +
    "sticker is often creased or curved around the produce, which bends the bars enough that no " +
    "scanner (including in-store ones) can read it. It's usually faster to just type the printed " +
    "number into the box below.";

  // ---------- Scanning ----------

  function supportedFormats() {
    const F = Html5QrcodeSupportedFormats;
    return [
      F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
      F.CODE_128, F.CODE_39, F.ITF, F.CODABAR, F.QR_CODE,
    ];
  }

  // Sized from the actual camera viewfinder at runtime instead of fixed
  // pixels, so it never overflows a narrow phone screen in portrait mode.
  function qrboxFunction(viewfinderWidth, viewfinderHeight) {
    const width = Math.max(180, Math.floor(Math.min(viewfinderWidth * 0.85, 320)));
    const height = Math.max(100, Math.floor(Math.min(viewfinderHeight * 0.45, 180)));
    return { width, height };
  }

  function cameraErrorMessage(err) {
    // html5-qrcode wraps the original DOMException in a new Error, so the
    // useful "NotAllowedError"/"NotFoundError" name only survives inside the
    // message text - match on that instead of err.name.
    const text = ((err && err.name) || "") + " " + ((err && err.message) || String(err));
    if (/NotAllowedError|PermissionDeniedError/.test(text)) {
      return "Camera permission was denied. In Chrome, tap the lock/info icon in the " +
        "address bar → Permissions → Camera → Allow, then reload the page.";
    }
    if (/NotFoundError|DevicesNotFoundError/.test(text)) {
      return "No camera was found on this device.";
    }
    if (/NotReadableError|TrackStartError/.test(text)) {
      return "The camera is already in use by another app. Close it and try again.";
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      return "Camera access needs HTTPS. Open this page over https:// (or localhost) to use the camera.";
    }
    return "Couldn't start the camera (" + (err && err.message ? err.message : err) + ").";
  }

  async function startScanning() {
    if (scanning) return;
    els.scanStatus.textContent = "Starting camera...";
    els.startBtn.disabled = true;

    try {
      html5QrCode = new Html5Qrcode("reader", {
        formatsToSupport: supportedFormats(),
        verbose: false,
      });

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrboxFunction },
        onScanSuccess,
        () => {} // ignore the constant per-frame "not found" callback
      );

      scanning = true;
      els.scanStatus.textContent = "Point the camera at a striped barcode on packaging.";
      els.stopBtn.hidden = false;
      armNoScanHint();
    } catch (err) {
      console.error(err);
      els.scanStatus.textContent = cameraErrorMessage(err) + " You can still type a code below.";
      els.startBtn.disabled = false;
    }
  }

  function armNoScanHint() {
    clearTimeout(noScanHintTimer);
    noScanHintTimer = setTimeout(() => {
      if (scanning) els.scanStatus.textContent = NO_SCAN_HINT;
    }, 8000);
  }

  async function stopScanning() {
    if (!scanning || !html5QrCode) return;
    clearTimeout(noScanHintTimer);
    try {
      await html5QrCode.stop();
      await html5QrCode.clear();
    } catch (err) {
      console.warn("Error stopping scanner", err);
    }
    scanning = false;
    els.startBtn.disabled = false;
    els.stopBtn.hidden = true;
    els.scanStatus.textContent = "Camera stopped.";
  }

  function onScanSuccess(decodedText) {
    const now = Date.now();
    if (now - lastScanAt < 1500) return; // debounce repeated frames
    lastScanAt = now;
    els.scanStatus.textContent = "Point the camera at a striped barcode on packaging.";
    armNoScanHint(); // re-arm in case the next thing they scan is a bare PLU sticker
    els.manualInput.value = decodedText;
    handleCode(decodedText);
  }

  // ---------- Code classification & lookup ----------

  function classify(raw) {
    const digits = String(raw).trim().replace(/\s+/g, "");
    if (/^\d{4}$/.test(digits)) return { type: "plu", code: digits };
    if (/^\d{5}$/.test(digits) && (digits[0] === "9" || digits[0] === "8")) {
      return { type: "plu", code: digits };
    }
    if (/^\d{5}$/.test(digits)) return { type: "plu", code: digits };
    if (/^\d{8}$/.test(digits) || /^\d{12,14}$/.test(digits)) {
      return { type: "upc", code: digits };
    }
    return { type: "unknown", code: digits };
  }

  // EWG's 2026 Shopper's Guide to Pesticides ("Dirty Dozen" / "Clean
  // Fifteen") - a commodity-level guideline from US produce testing, not a
  // lab result for the specific item scanned. See PLU_DATABASE's `ewg` field.
  function pesticideNote(ewg, isOrganic) {
    if (!ewg) return null;
    if (isOrganic) {
      return ewg === "dirty"
        ? { tone: "dirty", text: "This commodity is on EWG's 2026 “Dirty Dozen” - among conventionally-grown produce it's one of the most likely to test positive for pesticide residue in US sampling, which is presumably part of why you might be buying the organic version." }
        : { tone: "clean", text: "This commodity is on EWG's 2026 “Clean Fifteen” - even conventionally-grown, it typically tests with little to no detectable pesticide residue." };
    }
    return ewg === "dirty"
      ? { tone: "dirty", text: "Heads up: this commodity is on EWG's 2026 “Dirty Dozen” - among conventionally-grown produce it's one of the most likely to test positive for pesticide residue in US sampling. Washing helps but doesn't remove everything; the organic version (a 5-digit code starting with 9) is the lower-residue option if that matters to you." }
      : { tone: "clean", text: "Good news: this commodity is on EWG's 2026 “Clean Fifteen” - even conventionally-grown, it typically tests with little to no detectable pesticide residue." };
  }

  function lookupPLU(code) {
    if (code.length === 5) {
      const prefix = code[0];
      const base = code.slice(1);
      const entry = PLU_DATABASE[base];
      if (prefix === "9") {
        return {
          found: !!entry,
          name: entry ? entry.name : "Unrecognized produce (organic)",
          emoji: entry ? entry.emoji : "\u{1F331}",
          category: entry ? entry.category : null,
          tip: entry ? entry.tip : null,
          label: "Organic",
          note: "5-digit code starting with 9 = certified organic. Organic doesn't automatically mean " +
                "pesticide-free - certified growers may still use certain approved non-synthetic " +
                "substances - but synthetic pesticides are restricted. In Canada, look for the " +
                "\"Canada Organic\" logo on packaging/signage to confirm certification.",
          pesticide: entry ? pesticideNote(entry.ewg, true) : null,
        };
      }
      if (prefix === "8") {
        return {
          found: !!entry,
          name: entry ? entry.name : "Unrecognized produce (legacy GMO flag)",
          emoji: entry ? entry.emoji : "\u{1F331}",
          category: entry ? entry.category : null,
          tip: entry ? entry.tip : null,
          label: "Bioengineered (legacy code)",
          note: "5-digit code starting with 8 was an optional \"bioengineered\" flag. " +
                "It was made voluntary industry-wide around 2015 and is rarely used today - " +
                "its absence does not mean an item isn't genetically modified.",
          pesticide: entry ? pesticideNote(entry.ewg, false) : null,
        };
      }
    }
    if (code.length === 4) {
      const entry = PLU_DATABASE[code];
      if (!entry) return null;
      return {
        found: true,
        name: entry.name,
        emoji: entry.emoji,
        category: entry.category,
        tip: entry.tip,
        label: "Conventionally grown",
        note: "4-digit PLU code = conventionally grown produce.",
        pesticide: pesticideNote(entry.ewg, false),
      };
    }
    return null;
  }

  async function lookupUPC(code) {
    const url = "https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(code) +
      ".json?fields=product_name,brands,image_front_small_url,quantity,categories_tags,ingredients_text," +
      "countries_tags,nutriscore_grade,labels_tags,nutriments";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Network error (" + res.status + ")");
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    return data.product;
  }

  // ---------- Rendering ----------

  function emptyResult(message) {
    els.result.innerHTML = '<p class="placeholder">' + escapeHtml(message) + "</p>";
  }

  function renderPLUResult(code, info) {
    if (!info) {
      els.result.innerHTML =
        '<div class="card unknown">' +
        '<div class="card-emoji">❓</div>' +
        "<h3>Code " + escapeHtml(code) + " not in the local reference list</h3>" +
        "<p>This looks like a PLU sticker code, but it isn't in this app's small sample database. " +
        "The digit count still tells you something: 4 digits = conventionally grown, " +
        "a leading 9 (5 digits) = organic, a leading 8 (5 digits) = a legacy bioengineered flag.</p>" +
        "</div>";
      addHistory(code, "PLU", "Unknown code");
      return;
    }

    const catLine = info.category ? escapeHtml(info.category) + " &middot; " : "";
    const badgeClass =
      info.label === "Organic" ? " badge-organic" :
      /^Bioengineered/.test(info.label) ? " badge-legacy" : "";
    const badgeIcon =
      info.label === "Organic" ? "\u{1F331} " :
      /^Bioengineered/.test(info.label) ? "\u{26A0}\u{FE0F} " :
      info.label === "Conventionally grown" ? "\u{1F69C} " : "";
    const pesticideHtml = info.pesticide
      ? '<p class="note note-' + info.pesticide.tone + '">' +
        (info.pesticide.tone === "dirty" ? "\u{1F9EA} " : "\u{2705} ") +
        escapeHtml(info.pesticide.text) + "</p>"
      : "";
    els.result.innerHTML =
      '<div class="card' + (info.found ? "" : " unknown") + '">' +
      '<div class="card-emoji">' + info.emoji + "</div>" +
      "<h3>" + escapeHtml(info.name) + "</h3>" +
      '<div class="badges"><span class="badge' + badgeClass + '">' + badgeIcon + escapeHtml(info.label) + "</span>" +
      '<span class="badge code">PLU ' + escapeHtml(code) + "</span></div>" +
      "<p>" + catLine + escapeHtml(info.note) + "</p>" +
      (info.tip ? '<p class="tip">\u{1F4A1} ' + escapeHtml(info.tip) + "</p>" : "") +
      pesticideHtml +
      "</div>";
    addHistory(code, "PLU", info.name);
  }

  function renderUPCResult(code, product) {
    if (!product) {
      els.result.innerHTML =
        '<div class="card unknown">' +
        '<div class="card-emoji">❓</div>' +
        "<h3>Barcode " + escapeHtml(code) + " not found</h3>" +
        "<p>This looks like a standard UPC/EAN barcode (used on packaged produce, e.g. bagged apples). " +
        "It wasn't found in Open Food Facts, a free crowd-sourced product database - coverage of " +
        "Canadian packaged produce can be spotty. You can look up the code on " +
        "openfoodfacts.org directly, or check the package label.</p>" +
        "</div>";
      addHistory(code, "UPC", "Not found");
      showExpiryChecker(code, "Packaged product");
      return;
    }

    const name = product.product_name || "Unnamed product";
    const brand = product.brands ? escapeHtml(product.brands) : null;
    const qty = product.quantity ? escapeHtml(product.quantity) : null;
    const img = product.image_front_small_url;
    const categories = (product.categories_tags || [])
      .slice(0, 3)
      .map((t) => t.replace(/^\w+:/, "").replace(/-/g, " "))
      .join(", ");
    const nutriscore = product.nutriscore_grade
      ? product.nutriscore_grade.toUpperCase()
      : null;

    // Surface any notable certifications OFF has on file (this is real,
    // per-product data when present - e.g. a packaged item can be
    // independently certified organic even though PLU-style codes don't
    // apply to packaged/branded products).
    const notableLabels = { organic: "Organic", "fair-trade": "Fair Trade", "non-gmo-project-verified": "Non-GMO Project Verified", vegan: "Vegan", vegetarian: "Vegetarian", kosher: "Kosher", halal: "Halal" };
    const labels = (product.labels_tags || [])
      .map((t) => t.replace(/^\w+:/, ""))
      .filter((t) => notableLabels[t])
      .map((t) => notableLabels[t]);

    const n = product.nutriments || {};
    const nutritionBits = [];
    if (typeof n["energy-kcal_100g"] === "number") nutritionBits.push(Math.round(n["energy-kcal_100g"]) + " kcal");
    if (typeof n.sugars_100g === "number") nutritionBits.push(n.sugars_100g + " g sugar");
    if (typeof n.fiber_100g === "number") nutritionBits.push(n.fiber_100g + " g fibre");
    const nutritionLine = nutritionBits.length ? nutritionBits.join(", ") + " (per 100g)" : null;

    els.result.innerHTML =
      '<div class="card">' +
      (img ? '<img class="card-img" src="' + escapeHtml(img) + '" alt="">' : '<div class="card-emoji">\u{1F4E6}</div>') +
      "<h3>" + escapeHtml(name) + "</h3>" +
      '<div class="badges"><span class="badge code">' + escapeHtml(code) + "</span>" +
      (nutriscore ? '<span class="badge">Nutri-Score ' + escapeHtml(nutriscore) + "</span>" : "") +
      labels.map((l) => '<span class="badge badge-organic">' + escapeHtml(l) + "</span>").join("") +
      "</div>" +
      (brand ? "<p><strong>Brand:</strong> " + brand + "</p>" : "") +
      (qty ? "<p><strong>Quantity:</strong> " + qty + "</p>" : "") +
      (categories ? "<p><strong>Categories:</strong> " + escapeHtml(categories) + "</p>" : "") +
      (nutritionLine ? "<p><strong>Nutrition:</strong> " + escapeHtml(nutritionLine) + "</p>" : "") +
      (product.ingredients_text ? "<p><strong>Ingredients:</strong> " + escapeHtml(product.ingredients_text) + "</p>" : "") +
      '<p class="tip">Data from <a href="https://world.openfoodfacts.org/product/' + escapeHtml(code) +
      '" target="_blank" rel="noopener">Open Food Facts</a>, a free crowd-sourced database.</p>' +
      "</div>";
    addHistory(code, "UPC", name);
    showExpiryChecker(code, name);
  }

  async function handleCode(raw) {
    const classified = classify(raw);
    els.searchResults.innerHTML = "";

    if (classified.type === "plu") {
      emptyResult("Looking up PLU " + classified.code + "...");
      const info = lookupPLU(classified.code);
      renderPLUResult(classified.code, info);
      return;
    }

    if (classified.type === "upc") {
      emptyResult("Looking up barcode " + classified.code + "...");
      try {
        const product = await lookupUPC(classified.code);
        renderUPCResult(classified.code, product);
      } catch (err) {
        console.error(err);
        emptyResult("Couldn't reach the product database (" + err.message + "). Check your connection and try again.");
      }
      return;
    }

    emptyResult(
      "\"" + raw + "\" doesn't look like a PLU code (4-5 digits) or a barcode (8-14 digits)."
    );
  }

  // ---------- Search by name ----------

  function searchByName(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      els.searchResults.innerHTML = "";
      return;
    }
    const matches = Object.entries(PLU_DATABASE).filter(([, v]) =>
      v.name.toLowerCase().includes(q)
    );
    if (matches.length === 0) {
      els.searchResults.innerHTML = '<p class="placeholder">No local matches for "' + escapeHtml(query) + '".</p>';
      return;
    }
    els.searchResults.innerHTML = matches
      .slice(0, 8)
      .map(
        ([code, v]) =>
          '<button class="search-hit" data-code="' + code + '">' +
          v.emoji + " " + escapeHtml(v.name) + ' <span class="dim">PLU ' + code + "</span></button>"
      )
      .join("");
  }


  // ---------- Expiry checking ----------

  function loadExpiries() {
    try { return JSON.parse(localStorage.getItem(EXPIRY_KEY) || "{}"); }
    catch { return {}; }
  }

  function saveExpiry(code, date, label) {
    const saved = loadExpiries();
    saved[code] = { date, label, updatedAt: Date.now() };
    localStorage.setItem(EXPIRY_KEY, JSON.stringify(saved));
  }

  function renderExpiryStatus(dateString) {
    if (!dateString) {
      els.expiryResult.className = "";
      els.expiryResult.textContent = "Enter the date printed on the package.";
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(dateString + "T00:00:00");
    const days = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
    let tone, text;
    if (days < 0) {
      tone = "expiry-expired";
      text = "Expired " + Math.abs(days) + " day" + (Math.abs(days) === 1 ? "" : "s") + " ago — do not use it.";
    } else if (days === 0) {
      tone = "expiry-soon";
      text = "Expires today — use it now if it is still safe and properly stored.";
    } else if (days <= 7) {
      tone = "expiry-soon";
      text = "Expires in " + days + " day" + (days === 1 ? "" : "s") + " — use it soon.";
    } else {
      tone = "expiry-good";
      text = "Good for " + days + " more days.";
    }
    els.expiryResult.className = "expiry-result " + tone;
    els.expiryResult.textContent = text;
  }

  function showExpiryChecker(code, label) {
    els.expiryPanel.hidden = false;
    els.expiryPanel.dataset.code = code;
    els.expiryProduct.textContent = label + " · " + code;
    const saved = loadExpiries()[code];
    els.expiryDate.value = saved ? saved.date : "";
    renderExpiryStatus(saved ? saved.date : "");
    els.expiryPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- History ----------

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  function addHistory(code, type, label) {
    const list = loadHistory().filter((h) => h.code !== code);
    list.unshift({ code, type, label, at: Date.now() });
    saveHistory(list.slice(0, MAX_HISTORY));
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    if (list.length === 0) {
      els.history.hidden = true;
      return;
    }
    els.history.hidden = false;
    els.historyList.innerHTML = list
      .map(
        (h) =>
          '<button class="history-item" data-code="' + escapeHtml(h.code) + '">' +
          "<span class=\"history-type\">" + h.type + "</span> " +
          escapeHtml(h.label) + ' <span class="dim">' + escapeHtml(h.code) + "</span></button>"
      )
      .join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Wiring ----------

  els.startBtn.addEventListener("click", startScanning);
  els.stopBtn.addEventListener("click", stopScanning);

  els.lookupBtn.addEventListener("click", () => {
    const val = els.manualInput.value.trim();
    if (val) handleCode(val);
  });

  els.manualInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      els.lookupBtn.click();
    }
  });

  els.manualInput.addEventListener("input", () => {
    const val = els.manualInput.value;
    if (val.trim() && !/^\d+$/.test(val.trim())) {
      searchByName(val);
    } else {
      els.searchResults.innerHTML = "";
    }
  });

  els.searchResults.addEventListener("click", (e) => {
    const btn = e.target.closest(".search-hit");
    if (!btn) return;
    els.manualInput.value = btn.dataset.code;
    els.searchResults.innerHTML = "";
    handleCode(btn.dataset.code);
  });

  els.historyList.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-item");
    if (!btn) return;
    els.manualInput.value = btn.dataset.code;
    handleCode(btn.dataset.code);
  });

  els.checkExpiryBtn.addEventListener("click", () => {
    const code = els.expiryPanel.dataset.code;
    const date = els.expiryDate.value;
    if (!date) return renderExpiryStatus("");
    saveExpiry(code, date, els.expiryProduct.textContent);
    renderExpiryStatus(date);
  });

  els.expiryDate.addEventListener("change", () => {
    els.expiryResult.className = "";
    els.expiryResult.textContent = "";
  });

  els.clearHistoryBtn.addEventListener("click", () => {
    saveHistory([]);
    renderHistory();
  });

  // Release the camera when the tab is backgrounded or closed, so it
  // doesn't keep running (and draining battery) on a phone.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scanning) stopScanning();
  });
  window.addEventListener("pagehide", () => {
    if (scanning) stopScanning();
  });

  renderHistory();
})();
