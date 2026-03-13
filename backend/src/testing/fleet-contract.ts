export interface ContractMismatch {
  path: string
  code: 'missing_field' | 'extra_field' | 'type_mismatch' | 'value_mismatch'
  expectedType?: string
  actualType?: string
  expected?: unknown
  actual?: unknown
}

export interface CompareOptions {
  allowExtraFields?: boolean
  checkValueEquality?: boolean
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function appendPath(base: string, key: string): string {
  if (!base) return key
  if (key.startsWith('[')) return `${base}${key}`
  return `${base}.${key}`
}

function compareNode(
  baseline: unknown,
  candidate: unknown,
  path: string,
  mismatches: ContractMismatch[],
  options: CompareOptions
): void {
  const expectedType = valueType(baseline)
  const actualType = valueType(candidate)

  if (expectedType !== actualType) {
    mismatches.push({
      path,
      code: 'type_mismatch',
      expectedType,
      actualType,
      expected: baseline,
      actual: candidate,
    })
    return
  }

  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    const minLen = Math.min(baseline.length, candidate.length)
    for (let i = 0; i < minLen; i += 1) {
      compareNode(baseline[i], candidate[i], appendPath(path, `[${i}]`), mismatches, options)
    }
    if (baseline.length > candidate.length) {
      for (let i = candidate.length; i < baseline.length; i += 1) {
        mismatches.push({
          path: appendPath(path, `[${i}]`),
          code: 'missing_field',
          expected: baseline[i],
        })
      }
    }
    if (!options.allowExtraFields && candidate.length > baseline.length) {
      for (let i = baseline.length; i < candidate.length; i += 1) {
        mismatches.push({
          path: appendPath(path, `[${i}]`),
          code: 'extra_field',
          actual: candidate[i],
        })
      }
    }
    return
  }

  if (isObject(baseline) && isObject(candidate)) {
    for (const [key, baselineValue] of Object.entries(baseline)) {
      const childPath = appendPath(path, key)
      if (!(key in candidate)) {
        mismatches.push({
          path: childPath,
          code: 'missing_field',
          expected: baselineValue,
        })
        continue
      }
      compareNode(baselineValue, candidate[key], childPath, mismatches, options)
    }

    if (!options.allowExtraFields) {
      for (const [key, candidateValue] of Object.entries(candidate)) {
        if (!(key in baseline)) {
          mismatches.push({
            path: appendPath(path, key),
            code: 'extra_field',
            actual: candidateValue,
          })
        }
      }
    }
    return
  }

  if (options.checkValueEquality && baseline !== candidate) {
    mismatches.push({
      path,
      code: 'value_mismatch',
      expected: baseline,
      actual: candidate,
    })
  }
}

export function compareFleetContract(
  baselinePayload: unknown,
  simulatorPayload: unknown,
  options: CompareOptions = {}
): ContractMismatch[] {
  const normalizedOptions: CompareOptions = {
    allowExtraFields: options.allowExtraFields ?? true,
    checkValueEquality: options.checkValueEquality ?? false,
  }

  const mismatches: ContractMismatch[] = []
  compareNode(baselinePayload, simulatorPayload, 'response', mismatches, normalizedOptions)
  return mismatches
}

export function formatContractDiff(mismatches: ContractMismatch[]): string {
  if (mismatches.length === 0) return 'No mismatches found.'
  return mismatches
    .map((m) => {
      const expected = m.expectedType ? ` expectedType=${m.expectedType}` : ''
      const actual = m.actualType ? ` actualType=${m.actualType}` : ''
      return `${m.code} at ${m.path}${expected}${actual}`
    })
    .join('\n')
}
