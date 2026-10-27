// 规则按书写顺序，第一条命中的生效。
// agent、model、translator 都是字符串，对应 magpie 里任意已配置的 provider/model。
// agent 省略表示所有 agent。model 省略表示所有模型。
// model 写成 vendor/name 或 name 都认；带前缀的 id 用最后一段再比一次。
// * 可以出现在任意位置，大小写不敏感。末尾的 * 仍是前缀，中间的 * 匹配任意一段。
// 不带 * 时整段相等。问号保持字面量，不当作单字符通配。

export function matchRule(options, { agent = "", model = "" } = {}) {
  const rules = options?.rules
  if (!Array.isArray(rules)) return null
  for (const rule of rules) {
    if (!rule || typeof rule.translator !== "string" || !rule.translator.trim()) continue
    if (!agentOk(rule.agent, agent)) continue
    if (!modelOk(rule.model, model)) continue
    return { ...rule, translator: rule.translator.trim() }
  }
  return null
}

function asList(value) {
  if (value == null || value === "") return []
  return Array.isArray(value) ? value : [value]
}

function agentOk(pattern, agent) {
  const list = asList(pattern).filter((p) => typeof p === "string" && p.trim())
  if (!list.length) return true
  const got = String(agent || "").toLowerCase()
  return list.some((p) => p.toLowerCase() === got)
}

function modelOk(pattern, model) {
  const list = asList(pattern).filter((p) => typeof p === "string" && p.trim())
  if (!list.length) return true
  const id = String(model || "")
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id
  return list.some((raw) => {
    const p = raw.trim()
    return globHit(p, id) || globHit(p, bare)
  })
}

function globHit(pattern, value) {
  const body = pattern.split("*").map(escapeRegExp).join(".*")
  return new RegExp(`^${body}$`, "i").test(value)
}

function escapeRegExp(text) {
  return text.replace(/[\\^$+?.()|[\]{}]/g, "\\$&")
}
