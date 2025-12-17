function extractImages(markdown, host) {
  if (!markdown) return [];
  const urls = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m;

  while ((m = re.exec(markdown)) !== null) {
    let url = m[1];
    if (url.startsWith("data:")) continue;
    if (url.startsWith("uploads") || url.startsWith("/uploads")) {
      url = `${host.replace(/\/$/, "")}/${url.replace(/^\/?/, "")}`;
    }
    urls.push(url);
  }
  return urls;
}

function collectAllImages(issue, notes, host) {
  const set = new Set();
  extractImages(issue.description, host).forEach(u => set.add(u));
  notes.forEach(n => extractImages(n.body, host).forEach(u => set.add(u)));
  return Array.from(set);
}

async function downloadImages(imageUrls, issueId) {
  if (!imageUrls.length) return;

  for (const url of imageUrls) {
    const res = await fetch(url);
    if (!res.ok) continue;

    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${issueId}-${url.split("/").pop()}`;
    a.click();
  }
}
