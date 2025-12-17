/**
 * Parse a GitLab Issue or Work Item URL.
 *
 * Supported formats:
 * - https://gitlab.example.com/group/project/-/issues/123
 * - https://gitlab.example.com/group/subgroup/project/-/issues/123
 * - https://gitlab.example.com/group/project/-/work_items/456
 *
 * Returns:
 * {
 *   host,
 *   projectPath,
 *   iid,
 *   type: "issues" | "work_items"
 * }
 */
function parseGitLabIssueUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  const host = `${parsed.protocol}//${parsed.host}`;

  // Split on "/-/" (GitLab routing separator)
  const split = parsed.pathname.split("/-/");
  if (split.length !== 2) {
    throw new Error("Not a valid GitLab issue or work item URL");
  }

  const projectPath = split[0].replace(/^\/|\/$/g, "");
  const itemPart = split[1]; // e.g. "issues/123" or "work_items/456"

  const segments = itemPart.split("/");
  const type = segments[0];
  const iid = segments[1];

  if (!projectPath || !iid) {
    throw new Error("Invalid GitLab URL structure");
  }

  if (type !== "issues" && type !== "work_items") {
    throw new Error("Unsupported GitLab item type");
  }

  return {
    host,
    projectPath,
    iid,
    type
  };
}

/**
 * Fetch a GitLab Issue or Work Item and its notes.
 *
 * Params:
 * {
 *   host,
 *   projectPath,
 *   iid,
 *   type,        // "issues" | "work_items"
 *   pat
 * }
 *
 * Returns:
 * {
 *   issue,  // issue or work item object
 *   notes   // array of notes/comments
 * }
 */
async function gitlabFetchIssue({ host, projectPath, iid, type, pat }) {
  const encodedProject = encodeURIComponent(projectPath);

  const baseUrl =
    type === "issues"
      ? `${host}/api/v4/projects/${encodedProject}/issues/${iid}`
      : `${host}/api/v4/projects/${encodedProject}/work_items/${iid}`;

  const headers = {
    "PRIVATE-TOKEN": pat
  };

  const issueRes = await fetch(baseUrl, { headers });
  if (!issueRes.ok) {
    throw new Error(`Failed to fetch ${type.slice(0, -1)} (${issueRes.status})`);
  }

  const issue = await issueRes.json();

  const notesRes = await fetch(`${baseUrl}/notes?per_page=100`, { headers });
  if (!notesRes.ok) {
    throw new Error(`Failed to fetch notes (${notesRes.status})`);
  }

  const notes = await notesRes.json();

  return { issue, notes };
}
