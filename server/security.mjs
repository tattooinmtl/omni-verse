// What the world must never show: secret files are left out of buildings and
// refused by the file viewer, and any known provider key is scrubbed from text.

export const SECRET_FILE =
  /^(\.env(\..*)?|.*\.env|\.envrc|.*\.tfstate(\.backup)?|.*\.tfvars|kubeconfig|\.dockercfg|.*\.(pem|key|p12|pfx|keystore|jks|db|sqlite|sqlite3|db-wal|db-shm|kdbx)|secrets?(\..*)?|settings\.(json|old|tmp)(\..*)?|credentials.*|id_(rsa|ed25519|ecdsa).*|.*token.*|\.npmrc|\.pypirc|\.netrc|\.git-credentials)$/i;

export const SECRET_DIR = new Set([".git", ".ssh", ".gnupg", "sessions"]);

export function isSecretPath(rel) {
  const parts = String(rel).split(/[\\/]+/).filter(Boolean);
  // Windows paths are case-insensitive: .SSH and .Git are the same folders.
  if (parts.some((p) => SECRET_DIR.has(p.toLowerCase()))) return true;
  // ~/.kube/config and ~/.docker/config.json hold cluster and registry credentials.
  const dir = (parts.at(-2) || "").toLowerCase(), file = (parts.at(-1) || "").toLowerCase();
  if ((dir === ".kube" && file === "config") || (dir === ".docker" && file === "config.json")) return true;
  return SECRET_FILE.test(parts.at(-1) || "");
}

// Text people type: known keys plus anything shaped like a key, token or password.
const SECRET_SHAPES = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\b(ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
];
export function scrubSecrets(text, secrets = []) {
  let out = redact(text, secrets);
  for (const re of SECRET_SHAPES) out = out.replace(re, "‹redacted›");
  return out;
}

export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("‹redacted›");
  return out;
}
