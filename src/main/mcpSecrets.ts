export const SECRET_PLACEHOLDER = "[REDACTED_SECRET]";
export type McpRecord = Record<string, any>;
const secretKey = /token|secret|password|authorization|api[-_]?key|credential/i;

export function redactMcp(value: unknown, parent = ""): any {
  if (Array.isArray(value)) return value.map((item, index) => {
    if (parent === "args" && typeof item === "string" && (/(?:token|secret|password|api[-_]?key|credential)[=:]/i.test(item) || (index > 0 && /^--?/.test(String(value[index-1])) && secretKey.test(String(value[index-1])) && !String(value[index-1]).includes("=")))) return SECRET_PLACEHOLDER;
    return redactMcp(item, parent);
  });
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try { const url = new URL(value); if (url.username || url.password || [...url.searchParams.keys()].some(key => secretKey.test(key))) return SECRET_PLACEHOLDER; } catch { return SECRET_PLACEHOLDER; }
  }
  if (!value || typeof value !== "object") return value;
  const out: McpRecord = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (
      ["env", "http_headers", "headers"].includes(parent) ||
      (secretKey.test(key) && !key.endsWith("_env_var"))
    )
      out[key] = SECRET_PLACEHOLDER;
    else out[key] = redactMcp(item, key);
  }
  return out;
}

// A masked field means “keep its current value”, never write the mask as a credential.
export function restoreMcpSecrets(value: unknown, previous: any): any {
  if (value === SECRET_PLACEHOLDER) {
    if (previous === undefined)
      throw new Error("导入包含脱敏字段，请填写实际值或从当前配置编辑");
    return previous;
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      restoreMcpSecrets(item, previous?.[index]),
    );
  if (!value || typeof value !== "object") return value;
  const out: McpRecord = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("配置字段无效");
    out[key] = restoreMcpSecrets(item, previous?.[key]);
  }
  return out;
}
