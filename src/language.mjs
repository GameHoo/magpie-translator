// 原文已经是目标语言时，默认不送去翻译。认不出来就照常翻译，避免把该译的句子漏掉。

const SIMPLIFIED = new Set("国说这来个们为对时会过发后经现开实门问题样从动长头机无书见种气业线读释体汉广万与东车贝龙马鸟鱼页风飞齐丽丰产亲仅众优价余体仓仪".split(""))
const TRADITIONAL = new Set("國說這來個們為對時會過發後經現開實門問題樣從動長頭機無書見種氣業線讀釋體漢廣萬與東車貝龍馬鳥魚頁風飛齊麗豐產親僅眾優價餘體倉儀".split(""))

const ENGLISH_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "to", "of", "and", "in", "that", "it", "for", "with", "on", "this", "be"])

export function sameLanguage(text, language) {
  const kind = languageKind(language)
  if (!kind) return false
  const stats = countScripts(text)
  const letters = stats.han + stats.latin + stats.kana + stats.hangul + stats.cyrillic + stats.arabic + stats.thai + stats.devanagari
  if (letters < 4) return false
  if (kind === "zh-hans") return chinese(stats) && stats.traditional <= stats.simplified
  if (kind === "zh-hant") return chinese(stats) && stats.traditional > stats.simplified && stats.traditional >= 2
  if (kind === "ja") return stats.kana >= 6 || (stats.kana > 0 && stats.kana / (stats.kana + stats.han || 1) > 0.2)
  if (kind === "ko") return stats.hangul >= 4 && stats.hangul >= stats.han
  if (kind === "en") return stats.latin >= 8 && stats.han === 0 && stats.kana === 0 && stats.hangul === 0 && englishWords(text) >= 1
  if (kind === "ru") return stats.cyrillic >= 4 && stats.cyrillic > stats.latin
  if (kind === "ar") return stats.arabic >= 4
  if (kind === "th") return stats.thai >= 4
  if (kind === "hi") return stats.devanagari >= 4
  return false
}

export function languageKind(language) {
  const name = String(language || "").trim().toLowerCase()
  if (!name) return ""
  if (/繁|zh-hant|zh-tw|traditional/.test(name)) return "zh-hant"
  if (/简|中文|chinese|zh-hans|zh-cn|^zh$/.test(name)) return "zh-hans"
  if (/日本|日本語|japanese|^ja$/.test(name)) return "ja"
  if (/한국|조선|korean|^ko$/.test(name)) return "ko"
  if (/english|^en$|^en-/.test(name)) return "en"
  if (/рус|russian|^ru$/.test(name)) return "ru"
  if (/arab|العرب|^ar$/.test(name)) return "ar"
  if (/ไทย|thai|^th$/.test(name)) return "th"
  if (/हिंद|hindi|^hi$/.test(name)) return "hi"
  return ""
}

function chinese(stats) {
  if (stats.han < 2) return false
  if (stats.kana >= 6) return false
  if (stats.hangul >= 4 && stats.hangul >= stats.han) return false
  return stats.han >= stats.latin
}

function englishWords(text) {
  let n = 0
  for (const word of String(text).toLowerCase().match(/[a-z']+/g) || []) {
    if (ENGLISH_WORDS.has(word)) n += 1
  }
  return n
}

function countScripts(text) {
  const stats = {
    han: 0, latin: 0, kana: 0, hangul: 0, cyrillic: 0, arabic: 0, thai: 0, devanagari: 0,
    simplified: 0, traditional: 0,
  }
  for (const ch of String(text || "")) {
    const code = ch.codePointAt(0)
    if (isHan(code)) {
      stats.han += 1
      if (SIMPLIFIED.has(ch)) stats.simplified += 1
      if (TRADITIONAL.has(ch)) stats.traditional += 1
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) stats.latin += 1
    else if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff)) stats.kana += 1
    else if (code >= 0xac00 && code <= 0xd7af) stats.hangul += 1
    else if (code >= 0x0400 && code <= 0x04ff) stats.cyrillic += 1
    else if (code >= 0x0600 && code <= 0x06ff) stats.arabic += 1
    else if (code >= 0x0e00 && code <= 0x0e7f) stats.thai += 1
    else if (code >= 0x0900 && code <= 0x097f) stats.devanagari += 1
  }
  return stats
}

function isHan(code) {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
}
