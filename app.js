// ---------------------------
// Storage
// ---------------------------
const PAIR_KEY = "ig_pair_v1"; // { deviceLabel, saltB64, ivB64, ctB64 } ct = encrypted PAT

let sessionToken = null;       // unlocked token kept only in memory (per tab)
let lastContext = null;        // { host, projectPath, kind, iid, webUrl }
let lastImages = [];           // image URLs for current item only (replaced each build)

// ---------------------------
// DOM
// ---------------------------
const elUrl = document.getElementById("issueUrl");
const elBuild = document.getElementById("buildBtn");
const elCopy = document.getElementById("copyBtn");
const elOpenChatgpt = document.getElementById("openChatgptBtn");
const elPrompt = document.getElementById("promptOut");

const elIncludeSystem = document.getElementById("includeSystemNotes");

const elPairPill = document.getElementById("pairPill");
const elItemPill = document.getElementById("itemPill");
const elImgPill = document.getElementById("imgPill");

const elDownloadImages = document.getElementById("downloadImagesBtn");
const elCopyImageLinks = document.getElementById("copyImageLinksBtn");
const elImgNote = document.getElementById("imgNote");
const elStatusNote = document.getElementById("statusNote");

const elResetPair = document.getElementById("resetPairBtn");
const elLockBtn = document.getElementById("lockBtn");

// Modal
const authBackdrop = document.getElementById("authBackdrop");
const closeAuthBtn = document.getElementById("closeAuthBtn");
const tabUnlock = document.getElementById("tabUnlock");
const tabPair = document.getElementById("tabPair");
const paneUnlock = document.getElementById("paneUnlock");
const panePair = document.getElementById("panePair");

const unlockDeviceLabel = document.getElementById("unlockDeviceLabel");
const unlockPass = document.getElementById("unlockPass");
const unlockBtn = document.getElementById("unlockBtn");
const unlockNote = document.getElementById("unlockNote");

const pairDeviceLabel = document.getElementById("pairDeviceLabel");
const pairToken = document.getElementById("pairToken");
const pairPass = document.getElementById("pairPass");
const pairBtn = document.getElementById("pairBtn");
const pairNote = document.getElementById("pairNote");

// ---------------------------
// Utilities
// ---------------------------
function setNote(el, msg, kind = "") {
  el.textContent = msg || "";
  el.classList.remove("warn", "good");
  if (kind) el.classList.add(kind);
}

function getPairing(){
  try{
    const raw = localStorage.getItem(PAIR_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function setPairing(obj){
  localStorage.setItem(PAIR_KEY, JSON.stringify(obj));
}
function clearPairing(){
  localStorage.removeItem(PAIR_KEY);
  sessionToken = null;
}

function resetWorkingState(){
  // Replace previous URL state entirely (your requirement)
  lastContext = null;
  lastImages = [];
  elPrompt.value = "";
  elItemPill.textContent = "No item";
  elImgPill.textContent = "0 images";
  elDownloadImages.disabled = true;
  elCopyImageLinks.disabled = true;
  setNote(elImgNote, "");
  setNote(elStatusNote, "");
}

function updatePairPill(){
  elPairPill.textContent = getPairing() ? "Paired" : "Unpaired";
}

function looksLikeCorsFailure(err){
  // Browser CORS failures typically surface as TypeError: Failed to fetch
  return err && (String(err.message || err).toLowerCase().includes("failed to fetch")
    || String(err).toLowerCase().includes("failed to fetch"));
}

// ---------------------------
// Crypto (PBKDF2 + AES-GCM) - same approach as your reference
// ---------------------------
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64FromBytes(bytes){
  let bin = "";
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function bytesFromB64(b64){
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, saltBytes){
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 150000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptToken(passphrase, token){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(token)
  );
  return {
    saltB64: b64FromBytes(salt),
    ivB64: b64FromBytes(iv),
    ctB64: b64FromBytes(new Uint8Array(ct))
  };
}

async function decryptToken(passphrase, { saltB64, ivB64, ctB64 }){
  const salt = bytesFromB64(saltB64);
  const iv = bytesFromB64(ivB64);
  const ct = bytesFromB64(ctB64);
  const key = await deriveKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct
  );
  return dec.decode(pt);
}

// ---------------------------
// Auth modal (same pattern as your reference)
// ---------------------------
function openAuth(mode = "unlock"){
  authBackdrop.classList.add("open");
  authBackdrop.setAttribute("aria-hidden", "false");

  unlockNote.textContent = "";
  pairNote.textContent = "";

  const pairing = getPairing();
  unlockDeviceLabel.value = pairing ? (pairing.deviceLabel || "") : "";

  if(mode === "pair") setTab("pair");
  else setTab("unlock");
}

function closeAuth(){
  authBackdrop.classList.remove("open");
  authBackdrop.setAttribute("aria-hidden", "true");
}

function setTab(which){
  if(which === "pair"){
    tabPair.classList.add("active");
    tabUnlock.classList.remove("active");
    panePair.classList.remove("hidden");
    paneUnlock.classList.add("hidden");
  } else {
    tabUnlock.classList.add("active");
    tabPair.classList.remove("active");
    paneUnlock.classList.remove("hidden");
    panePair.classList.add("hidden");
  }
}

function requireUnlocked(){
  if(sessionToken) return true;

  const pairing = getPairing();
  if(!pairing){
    openAuth("pair");
    return false;
  }
  openAuth("unlock");
  return false;
}

async function doPair(){
  const deviceLabel = pairDeviceLabel.value.trim();
  const token = pairToken.value.trim();
  const pass = pairPass.value;

  if(!deviceLabel){ pairNote.textContent = "Please set a device label."; return; }
  if(!token){ pairNote.textContent = "Please paste a GitLab PAT."; return; }
  if(!pass || pass.length < 8){ pairNote.textContent = "Passphrase must be at least 8 characters."; return; }

  try{
    const encObj = await encryptToken(pass, token);
    setPairing({ deviceLabel, ...encObj });
    sessionToken = token;

    pairToken.value = "";
    pairPass.value = "";
    pairNote.textContent = "";

    updatePairPill();
    closeAuth();
  } catch (e){
    pairNote.textContent = `Pairing failed: ${String(e.message || e)}`;
  }
}

async function doUnlock(){
  const pairing = getPairing();
  if(!pairing){
    unlockNote.textContent = "This browser is not paired yet.";
    setTab("pair");
    return;
  }

  const pass = unlockPass.value;
  if(!pass){ unlockNote.textContent = "Enter your pairing passphrase."; return; }

  try{
    const token = await decryptToken(pass, pairing);
    sessionToken = token;
    unlockPass.value = "";
    unlockNote.textContent = "";
    updatePairPill();
    closeAuth();
  } catch {
    sessionToken = null;
    unlockNote.textContent = "Invalid passphrase.";
  }
}

function doLock(){
  sessionToken = null;
  updatePairPill();
  openAuth("unlock");
}

function doResetPairing(){
  if(!confirm("Reset pairing? This will forget the stored token on this PC/browser profile.")) return;
  clearPairing();
  updatePairPill();
  resetWorkingState();
  openAuth("pair");
}

// ---------------------------
// GitLab URL parsing + API fetch (issues + work_items)
// ---------------------------
function parseGitLabUrl(urlStr){
  let u;
  try { u = new URL(urlStr); }
  catch { throw new Error("Invalid URL."); }

  const host = u.origin;
  const path = u.pathname.replace(/\/+$/, "");

  // Accept both:
  // .../-/issues/<iid>
  // .../-/work_items/<iid>
  const m = path.match(/^(\/.+?)\/-\/(issues|work_items)\/(\d+)$/);
  if(!m) throw new Error("URL must look like: https://host/<group>/<project>/-/(issues|work_items)/<iid>");

  const projectPath = m[1].replace(/^\//, "");
  const kind = m[2];   // "issues" or "work_items"
  const iid = m[3];

  return { host, projectPath, kind, iid, webUrl: u.href };
}

async function gitlabFetchItemAndNotes(ctx, token){
  const encodedProject = encodeURIComponent(ctx.projectPath);
  const baseUrl = `${ctx.host}/api/v4/projects/${encodedProject}/${ctx.kind}/${encodeURIComponent(ctx.iid)}`;

  const headers = {
    "PRIVATE-TOKEN": token,
    "Authorization": `Bearer ${token}`
  };

  const resItem = await fetch(baseUrl, { method: "GET", headers });
  if(!resItem.ok){
    const t = await resItem.text().catch(() => "");
    throw new Error(`GitLab API ${resItem.status}: ${t || resItem.statusText}`);
  }
  const item = await resItem.json();

  // Notes endpoint should work for both issues and work_items if supported by your instance.
  const resNotes = await fetch(`${baseUrl}/notes?per_page=100`, { method: "GET", headers });
  if(!resNotes.ok){
    const t = await resNotes.text().catch(() => "");
    throw new Error(`GitLab notes ${resNotes.status}: ${t || resNotes.statusText}`);
  }
  const notes = await resNotes.json();

  return { item, notes };
}

// ---------------------------
// Image extraction + download (best effort)
// ---------------------------
function normalizeImageUrl(raw, host){
  let url = (raw || "").trim();
  if(!url) return null;

  // Strip surrounding quotes (common in markdown)
  url = url.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

  if(url.startsWith("data:")) return null;

  // Absolute
  if(/^https?:\/\//i.test(url)) return url;

  // Common GitLab upload forms:
  // uploads/xxx.png
  // /uploads/xxx.png
  // /-/uploads/xxx.png
  // -/uploads/xxx.png
  const cleaned = url.replace(/^\/+/, "");
  if(cleaned.startsWith("uploads/")) return `${host}/${cleaned}`;
  if(cleaned.startsWith("-/uploads/")) return `${host}/${cleaned}`;
  if(cleaned.startsWith("%2Fuploads%2F")) return `${host}/${decodeURIComponent(cleaned)}`;

  // If it's a plain relative path, anchor it to host
  return `${host}/${cleaned}`;
}

function extractImagesFromMarkdown(md, host){
  if(!md) return [];
  const found = new Set();

  // Markdown images: ![alt](url)
  const reMd = /!\[[^\]]*]\(([^)]+)\)/g;
  let m;
  while((m = reMd.exec(md)) !== null){
    const u = normalizeImageUrl(m[1], host);
    if(u) found.add(u);
  }

  // HTML images: <img src="url">
  const reHtml = /<img[^>]+src=["']([^"']+)["']/gi;
  while((m = reHtml.exec(md)) !== null){
    const u = normalizeImageUrl(m[1], host);
    if(u) found.add(u);
  }

  return Array.from(found);
}

function collectAllImages(item, notes, host){
  const set = new Set();
  extractImagesFromMarkdown(item.description || "", host).forEach(u => set.add(u));
  (notes || []).forEach(n => extractImagesFromMarkdown(n.body || "", host).forEach(u => set.add(u)));
  return Array.from(set);
}

async function downloadAllImages(imageUrls, filenamePrefix){
  if(!imageUrls.length) return { ok: 0, fail: 0 };

  // Many browsers block multiple automatic downloads unless initiated from a user click.
  // This function is always called from a button click in our UI.
  let ok = 0, fail = 0;

  for(const url of imageUrls){
    try{
      const res = await fetch(url, { method: "GET", credentials: "include" });
      // NOTE: For private images, this may require GitLab cookies; PAT headers are not accepted on regular /uploads URLs.
      if(!res.ok) { fail++; continue; }

      const blob = await res.blob();
      const name = (url.split("/").pop() || "image").split("?")[0];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${filenamePrefix}-${name}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

// ---------------------------
// Prompt builder
// ---------------------------
function buildPrompt({ ctx, item, notes, includeSystemNotes }){
  const title = item.title || item.name || "(No title)";
  const state = item.state || "(unknown)";
  const labels = Array.isArray(item.labels) ? item.labels.join(", ") : "";
  const assignees = Array.isArray(item.assignees) ? item.assignees.map(a => a.name).join(", ") : "";

  const filteredNotes = (notes || [])
    .filter(n => includeSystemNotes ? true : !n.system)
    .map(n => `- ${n.author?.name || "Unknown"} (${n.created_at || ""}): ${n.body || ""}`)
    .join("\n");

  const desc = item.description || "";

  return `
You are my Product Owner assistant.

IMPORTANT:
I will upload screenshots/images manually after sending this message. Use them as supporting evidence when I provide them.

OUTPUT FORMAT (use these headings exactly):
1) Executive summary (5–10 bullets)
2) Timeline of key events (date — actor — event)
3) Current state (what is true now)
4) Open questions / missing info
5) Risks / blockers / dependencies
6) Recommended next steps (max 10; each item: Action, Owner (suggested), Why, Priority P0/P1/P2)
7) Draft message I can post as a GitLab comment (concise, professional)

CONSTRAINTS:
- Base your output only on the content below.
- If information is missing, ask explicit questions instead of guessing.
- Separate facts from inferences.

GITLAB ITEM START
URL: ${ctx.webUrl}
Type: ${ctx.kind}
Project: ${ctx.projectPath}
IID: ${ctx.iid}
Title: ${title}
State: ${state}
Labels: ${labels}
Assignees: ${assignees}

Description:
${desc}

Comments/Notes (newest last):
${filteredNotes}
GITLAB ITEM END
`.trim();
}

// ---------------------------
// Build flow (handles CORS failures cleanly)
// ---------------------------
async function buildFromUrl(){
  if(!requireUnlocked()) return;

  resetWorkingState();

  const url = elUrl.value.trim();
  if(!url) return;

  let ctx;
  try{
    ctx = parseGitLabUrl(url);
  } catch (e){
    setNote(elStatusNote, String(e.message || e), "warn");
    return;
  }

  lastContext = ctx;
  elItemPill.textContent = `Loading ${ctx.kind} #${ctx.iid}…`;
  setNote(elStatusNote, "");

  try{
    const { item, notes } = await gitlabFetchItemAndNotes(ctx, sessionToken);

    const prompt = buildPrompt({
      ctx,
      item,
      notes,
      includeSystemNotes: !!elIncludeSystem.checked
    });
    elPrompt.value = prompt;

    // Images
    lastImages = collectAllImages(item, notes, ctx.host);
    elImgPill.textContent = `${lastImages.length} images`;
    elItemPill.textContent = `${(item.title || item.name || "Loaded")} (#${ctx.iid})`;

    elDownloadImages.disabled = lastImages.length === 0;
    elCopyImageLinks.disabled = lastImages.length === 0;

    if(lastImages.length > 0){
      setNote(elImgNote, "Images extracted. Click “Download images” (best-effort). If downloads fail, use “Copy image links” and open them manually.", "");
    } else {
      setNote(elImgNote, "No images found in description/comments.", "");
    }

    setNote(elStatusNote, "Ready.", "good");
  } catch (e){
    // Most common: CORS blocked
    if(looksLikeCorsFailure(e)){
      setNote(elStatusNote,
`CORS blocked the GitLab API request.

This cannot be fixed in front-end code. Choose one:
1) Host this page under the SAME origin as GitLab (recommended), e.g. https://issues.markify.com/… so requests are same-origin.
2) Enable CORS headers on the GitLab reverse proxy for your app origin.

Technical note: the browser blocked cross-origin requests to ${ctx.host}/api/v4/…`,
        "warn"
      );
      elItemPill.textContent = "CORS blocked";
      return;
    }

    setNote(elStatusNote, String(e.message || e), "warn");
    elItemPill.textContent = "Fetch failed";
  }
}

// ---------------------------
// Image actions
// ---------------------------
async function onDownloadImages(){
  if(!lastContext || !lastImages.length){
    setNote(elImgNote, "No images available for download.", "warn");
    return;
  }

  setNote(elImgNote, "Downloading… (your browser may prompt or block multiple downloads)", "");

  // Best-effort: many /uploads URLs require GitLab cookies rather than PAT.
  const prefix = `${lastContext.kind}-${lastContext.iid}`;
  const { ok, fail } = await downloadAllImages(lastImages, prefix);

  if(ok > 0 && fail === 0){
    setNote(elImgNote, `Downloaded ${ok} image(s).`, "good");
  } else if(ok > 0 && fail > 0){
    setNote(elImgNote, `Downloaded ${ok} image(s); ${fail} failed. If failures persist, click “Copy image links” and open/save manually.`, "warn");
  } else {
    setNote(elImgNote, `All downloads failed. Likely private images require GitLab session cookies. Use “Copy image links” and open/save manually.`, "warn");
  }
}

async function onCopyImageLinks(){
  if(!lastImages.length) return;
  await navigator.clipboard.writeText(lastImages.join("\n"));
  setNote(elImgNote, "Image links copied to clipboard.", "good");
}

// ---------------------------
// Copy/Open actions
// ---------------------------
async function onCopyPrompt(){
  const txt = elPrompt.value.trim();
  if(!txt){
    setNote(elStatusNote, "Nothing to copy yet.", "warn");
    return;
  }
  await navigator.clipboard.writeText(txt);
  setNote(elStatusNote, "Prompt copied.", "good");
}

function onOpenChatgpt(){
  window.open("https://chatgpt.com/", "_blank");
}

// ---------------------------
// Wiring + Startup
// ---------------------------
(function wireAndInit(){
  updatePairPill();
  resetWorkingState();

  // Main
  elBuild.addEventListener("click", buildFromUrl);
  elUrl.addEventListener("keydown", (e) => { if(e.key === "Enter") buildFromUrl(); });

  elCopy.addEventListener("click", onCopyPrompt);
  elOpenChatgpt.addEventListener("click", onOpenChatgpt);

  elDownloadImages.addEventListener("click", onDownloadImages);
  elCopyImageLinks.addEventListener("click", onCopyImageLinks);

  // Pairing controls (Fix: reset button is wired and present)
  elResetPair.addEventListener("click", doResetPairing);
  elLockBtn.addEventListener("click", doLock);

  // Modal controls
  closeAuthBtn.addEventListener("click", closeAuth);
  authBackdrop.addEventListener("click", (e) => { if(e.target === authBackdrop) closeAuth(); });

  tabUnlock.addEventListener("click", () => setTab("unlock"));
  tabPair.addEventListener("click", () => setTab("pair"));

  pairBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    pairNote.textContent = "";
    doPair();
  });

  unlockBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    unlockNote.textContent = "";
    doUnlock();
  });

  unlockPass.addEventListener("keydown", (e) => { if(e.key === "Enter") doUnlock(); });
  pairPass.addEventListener("keydown", (e) => { if(e.key === "Enter") doPair(); });

  // Startup: same behavior as your backlog tool
  const pairing = getPairing();
  if(!pairing) openAuth("pair");
  else openAuth("unlock");
})();

// Cleanup on tab close/refresh (keeps pairing)
window.addEventListener("pagehide", () => { sessionToken = null; });
