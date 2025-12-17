const el = id => document.getElementById(id);
let vault = null;

function show(id) { el(id).classList.remove("hidden"); }
function hide(id) { el(id).classList.add("hidden"); }

async function init() {
  localStorage.getItem("gl_pat_vault_v1")
    ? show("vault-unlock")
    : show("vault-setup");
}

el("saveVaultBtn").onclick = async () => {
  await vaultStorePat(
    { pat: el("patInput").value, host: el("hostInput").value },
    el("passphraseInput").value
  );
  location.reload();
};

el("unlockVaultBtn").onclick = async () => {
  vault = await vaultLoadPat(el("unlockPassphraseInput").value);
  hide("vault-unlock");
  show("app");
};

el("resetVaultBtn").onclick = () => {
  vaultClear();
  location.reload();
};

el("buildPromptBtn").onclick = async () => {
  el("promptOutput").value = "";

  const { projectPath, iid } = parseGitLabIssueUrl(el("issueUrlInput").value);
  const { issue, notes } = await gitlabFetchIssue({
    ...vault,
    projectPath,
    iid
  });

  const images = collectAllImages(issue, notes, vault.host);
  await downloadImages(images, iid);

  el("promptOutput").value = buildPrompt(issue, notes);
};

el("copyPromptBtn").onclick = async () => {
  await navigator.clipboard.writeText(el("promptOutput").value);
};

el("openChatgptBtn").onclick = () => {
  window.open("https://chatgpt.com/?temporary-chat=true", "_blank");
};

init();

