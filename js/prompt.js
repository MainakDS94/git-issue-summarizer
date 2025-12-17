function buildPrompt(issue, notes) {
  const comments = notes
    .filter(n => !n.system)
    .map(n => `- ${n.author.name} (${n.created_at}): ${n.body}`)
    .join("\n");

  return `
You are my Product Owner assistant.

IMPORTANT:
I will upload screenshots and images related to this issue after sending this message.

OUTPUT FORMAT:
1) Executive summary
2) Timeline
3) Current state
4) Open questions
5) Risks / blockers
6) Recommended next steps
7) Draft comment I can post

GITLAB ISSUE DATA START
Title: ${issue.title}
State: ${issue.state}
Labels: ${issue.labels.join(", ")}
Assignees: ${issue.assignees.map(a => a.name).join(", ")}

Description:
${issue.description}

Comments:
${comments}
GITLAB ISSUE DATA END
`.trim();
}
