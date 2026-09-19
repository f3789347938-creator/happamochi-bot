/** Pure text scoring; cooldown, reply bonuses and point writes belong to the caller. */
const MAX_TEXT_UNITS = 5000
const MAX_REPEAT_PERIOD = 128
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const IS_EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u

export interface PointTextAnalysis {
  /** Canonical duplicate key, not display text. Store this value for later comparisons. */
  normalizedText: string | null
  effectiveLength: number
  basePoints: number
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), entry => entry.segment)
}

/** Reduce an entirely repeated message, including phrases longer than our local window. */
function primitivePeriod(tokens: string[]): string[] {
  if (tokens.length < 3) return tokens
  const prefix = new Uint16Array(tokens.length)
  for (let i = 1; i < tokens.length; i++) {
    let matched = prefix[i - 1]
    while (matched > 0 && tokens[i] !== tokens[matched]) matched = prefix[matched - 1]
    if (tokens[i] === tokens[matched]) matched++
    prefix[i] = matched
  }
  const period = tokens.length - prefix[tokens.length - 1]
  const copies = tokens.length / period
  // Keep ordinary doubled letters; long runs and repeated words add no length bonus.
  return Number.isInteger(copies) && (copies >= 3 || (period >= 2 && copies >= 2))
    ? tokens.slice(0, period) : tokens
}

/**
 * Collapse adjacent repeated characters/phrases. For each short period, scan
 * once backwards to locate equal runs: O(length * 128), O(length) memory.
 * This avoids regex backtracking, substring allocation and quadratic searches.
 */
function collapseLocalRepeats(tokens: string[]): string[] {
  const n = tokens.length
  if (n < 3) return tokens
  const lengths = new Uint16Array(n)
  const periods = new Uint16Array(n)
  for (let period = 1; period <= Math.min(MAX_REPEAT_PERIOD, Math.floor(n / 2)); period++) {
    let equalRun = 0
    for (let i = n - period - 1; i >= 0; i--) {
      equalRun = tokens[i] === tokens[i + period] ? equalRun + 1 : 0
      const copies = 1 + Math.floor(equalRun / period)
      const length = copies * period
      // Three copies are padding; two longer phrases are also discounted.
      // Short natural doubles such as おお or haha are left intact here.
      if (copies < 3 && !(copies >= 2 && period >= 3 && length >= 12)) continue
      if (length > lengths[i]) {
        lengths[i] = length
        periods[i] = period
      }
    }
  }
  const result: string[] = []
  for (let i = 0; i < n;) {
    if (!lengths[i]) {
      result.push(tokens[i++])
      continue
    }
    for (let j = 0; j < periods[i]; j++) result.push(tokens[i + j])
    i += lengths[i]
  }
  return result
}

function withoutPadding(tokens: string[]): string[] {
  // A second pass handles padding inside a retained phrase (e.g. aaaaab × 30).
  const primitive = primitivePeriod(tokens)
  const collapsed = collapseLocalRepeats(primitive)
  return collapsed.length < primitive.length ? collapseLocalRepeats(collapsed) : collapsed
}

export function analyzePointText(text?: string | null): PointTextAnalysis {
  if (!text) return { normalizedText: null, effectiveLength: 0, basePoints: 1 }
  const normalized = text.slice(0, MAX_TEXT_UNITS)
    .normalize('NFKC').toLowerCase()
    .replace(/[\p{Cc}\p{Cf}]/gu, character => /\s/u.test(character) ? ' ' : '')
    .replace(/\b(?:[a-z][a-z0-9+.-]{1,20}:\/\/|www\.)[^\s<>]+/giu, '')
    .replace(/[\p{White_Space}\p{P}]/gu, '')
    .slice(0, MAX_TEXT_UNITS)
  const tokens = graphemes(normalized)
  // Use the SAME meaningful content for scoring and duplicate detection: adding
  // different emoji/symbol padding must not make a rewarded message look new.
  const meaningful = tokens.filter(token => HAS_LETTER_OR_NUMBER.test(token) && !IS_EMOJI.test(token))
  const effective = withoutPadding(meaningful)
  const effectiveLength = effective.length
  // Emoji-only text still has a duplicate key, while keeping the base 1 point.
  const canonical = meaningful.length ? effective : withoutPadding(tokens)
  const basePoints = effectiveLength >= 150 ? 8
    : effectiveLength >= 80 ? 5
      : effectiveLength >= 30 ? 3
        : effectiveLength >= 10 ? 2 : 1
  return { normalizedText: canonical.join('') || null, effectiveLength, basePoints }
}

/**
 * Both inputs must be analyzePointText(...).normalizedText, not raw messages.
 * Empty/media values never duplicate one another. Exact canonical duplicates
 * match at every length. Near duplicates require both sides >= 20 graphemes
 * and <= 8% edits, capped at 12; short everyday replies remain distinct.
 */
export function areSimilarPointTexts(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const left = graphemes(a.slice(0, MAX_TEXT_UNITS))
  const right = graphemes(b.slice(0, MAX_TEXT_UNITS))
  if (Math.min(left.length, right.length) < 20) return false
  const limit = Math.min(12, Math.floor(Math.max(left.length, right.length) * 0.08))
  if (Math.abs(left.length - right.length) > limit) return false

  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let leftEnd = left.length, rightEnd = right.length
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--
    rightEnd--
  }
  const n = leftEnd - start, m = rightEnd - start
  if (!n || !m) return Math.max(n, m) <= limit

  // Banded Levenshtein distance: at most 25 cells per input grapheme.
  const unreachable = limit + 1
  let previous = new Uint16Array(m + 1).fill(unreachable)
  let current = new Uint16Array(m + 1).fill(unreachable)
  for (let j = 0; j <= Math.min(m, limit); j++) previous[j] = j
  for (let i = 1; i <= n; i++) {
    const first = Math.max(1, i - limit), last = Math.min(m, i + limit)
    current[0] = i <= limit ? i : unreachable
    if (first > 1) current[first - 1] = unreachable
    let rowBest = unreachable
    for (let j = first; j <= last; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[start + i - 1] === right[start + j - 1] ? 0 : 1),
      )
      rowBest = Math.min(rowBest, current[j])
    }
    if (last < m) current[last + 1] = unreachable
    if (rowBest > limit) return false
    ;[previous, current] = [current, previous]
  }
  return previous[m] <= limit
}
