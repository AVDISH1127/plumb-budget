import type { Entry } from './storage'

export interface DuplicateCandidate {
  incoming: Entry
  existing: Entry
  score: number
}

export function normalizeMerchant(value = ''): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, '')
}

export function findDuplicateCandidates(incoming: Entry[], existing: Entry[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = []
  for (const item of incoming) {
    for (const match of existing) {
      if (item.profileId !== match.profileId || item.type !== match.type || item.amount !== match.amount) continue
      const dayDistance = Math.abs((Date.parse(item.date) - Date.parse(match.date)) / 86_400_000)
      if (!Number.isFinite(dayDistance) || dayDistance > 3) continue
      const merchantA = normalizeMerchant(item.merchantVpa || item.note)
      const merchantB = normalizeMerchant(match.merchantVpa || match.note)
      const merchantMatch = Boolean(merchantA && merchantB && (merchantA.includes(merchantB) || merchantB.includes(merchantA)))
      const utrMatch = Boolean(item.utrNumber && match.utrNumber && item.utrNumber === match.utrNumber)
      if (utrMatch || merchantMatch || (dayDistance <= 1 && merchantA && merchantB && merchantA.slice(0, 4) === merchantB.slice(0, 4))) {
        candidates.push({ incoming: item, existing: match, score: utrMatch ? 100 : merchantMatch ? 85 : 55 })
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score)
}

export function suggestedMonthlyGoal(income: number, committedExpenses: number, targetMonths = 12): number {
  const available = Math.max(0, income - committedExpenses)
  return targetMonths > 0 ? Math.round((available / targetMonths) * 100) / 100 : available
}
