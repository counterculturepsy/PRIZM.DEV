type Rule = Readonly<{ allow: boolean; pattern: string }>;
type Group = Readonly<{ agents: readonly string[]; rules: readonly Rule[] }>;

function parseGroups(text: string): Group[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | undefined;
  let rulesStarted = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || rulesStarted) {
        current = { agents: [], rules: [] };
        groups.push(current);
        rulesStarted = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current) {
      rulesStarted = true;
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    }
  }
  return groups;
}

/**
 * Robots pattern matching: `*` matches any run of characters, a trailing `$` anchors the end, otherwise it is a prefix
 * match. Implemented without regular expressions because the pattern comes from the audited site, and a pattern with
 * many wildcards makes a backtracking regex take exponential time.
 */
function ruleMatches(path: string, pattern: string): boolean {
  const endAnchored = pattern.endsWith("$");
  const parts = (endAnchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = parts[0] ?? "";
  if (!path.startsWith(first)) return false;
  if (parts.length === 1) return endAnchored ? path.length === first.length : true;

  let position = first.length;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const found = path.indexOf(parts[index] ?? "", position);
    if (found < 0) return false;
    position = found + (parts[index] ?? "").length;
  }
  const last = parts[parts.length - 1] ?? "";
  return endAnchored ? path.length - last.length >= position && path.endsWith(last) : path.indexOf(last, position) >= 0;
}

export function isRobotsAllowed(text: string, target: URL, productToken = "prizmdev"): boolean {
  const groups = parseGroups(text);
  const token = productToken.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && token.startsWith(agent)));
  const selected = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  const path = `${target.pathname}${target.search}` || "/";
  const matches = selected.flatMap((group) => group.rules).filter((rule) => ruleMatches(path, rule.pattern));
  if (matches.length === 0) return true;
  matches.sort((left, right) => right.pattern.length - left.pattern.length || Number(right.allow) - Number(left.allow));
  return matches[0]?.allow ?? true;
}
