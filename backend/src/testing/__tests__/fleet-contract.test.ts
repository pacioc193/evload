import fs from 'fs'
import path from 'path'
import { compareFleetContract, formatContractDiff } from '../fleet-contract'

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

describe('Fleet contract baseline comparison', () => {
  const fixtureRoot = path.join(__dirname, 'fixtures')
  const baselineRoot = path.join(fixtureRoot, 'baseline')
  const simulatorRoot = path.join(fixtureRoot, 'simulator')

  const endpoints = ['vehicle.vehicle_data', 'vehicle.charge_state', 'vehicle.climate_state']

  test.each(endpoints)('matches baseline schema for %s', (endpointKey) => {
    const baseline = readJson(path.join(baselineRoot, `${endpointKey}.json`))
    const simulator = readJson(path.join(simulatorRoot, `${endpointKey}.json`))

    const mismatches = compareFleetContract(baseline, simulator, {
      allowExtraFields: false,
      checkValueEquality: false,
    })

    if (mismatches.length > 0) {
      const diff = formatContractDiff(mismatches)
      throw new Error(`Contract mismatch for ${endpointKey}\n${diff}`)
    }
  })

  test('reports useful diff for broken payload', () => {
    const baseline = readJson(path.join(baselineRoot, 'vehicle.charge_state.json'))
    const broken = {
      response: {
        charging_state: 'Charging',
        battery_level: '85',
      },
    }

    const mismatches = compareFleetContract(baseline, broken, {
      allowExtraFields: false,
      checkValueEquality: false,
    })

    expect(mismatches.length).toBeGreaterThan(0)
    expect(formatContractDiff(mismatches)).toContain('type_mismatch')
    expect(formatContractDiff(mismatches)).toContain('missing_field')
  })
})
