import { describe, expect, it, vi } from 'vitest'
import { createVisitRecorder, type RecordedVisit, visitSourceOf } from './visits.ts'

const visit: RecordedVisit = {
  linkId: 1,
  organizationId: 'widgets.test',
  userId: 7,
  via: 'browser',
}

describe('visitSourceOf', () => {
  it('accepts every source the catalog lists', () => {
    expect(visitSourceOf('browser')).toBe('browser')
    expect(visitSourceOf('search')).toBe('search')
    expect(visitSourceOf('ext')).toBe('ext')
    expect(visitSourceOf('api')).toBe('api')
  })

  it('reads a source case-insensitively and trims it', () => {
    expect(visitSourceOf(' SEARCH ')).toBe('search')
  })

  it('counts anything else as a browser visit', () => {
    expect(visitSourceOf(undefined)).toBe('browser')
    expect(visitSourceOf('')).toBe('browser')
    expect(visitSourceOf('telepathy')).toBe('browser')
    expect(visitSourceOf(42)).toBe('browser')
    expect(visitSourceOf({ via: 'search' })).toBe('browser')
  })

  it('reads the first value when the parameter was repeated', () => {
    expect(visitSourceOf(['ext', 'api'])).toBe('ext')
    expect(visitSourceOf([])).toBe('browser')
  })
})

describe('createVisitRecorder', () => {
  it('writes what it is given and reports when the writes are done', async () => {
    const write = vi.fn(async () => {})
    const recorder = createVisitRecorder({ write })

    recorder.record(visit)
    await recorder.settled()

    expect(write).toHaveBeenCalledWith(visit)
  })

  it('does not make its caller wait for the write', async () => {
    let release = () => {}
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const recorder = createVisitRecorder({ write })

    recorder.record(visit)
    expect(write).toHaveBeenCalledTimes(1)

    release()
    await recorder.settled()
  })

  it('swallows a failed write and logs it', async () => {
    const logger = { warn: vi.fn() }
    const recorder = createVisitRecorder({
      write: async () => {
        throw new Error('the visit store is down')
      },
      logger,
    })

    recorder.record(visit)
    await expect(recorder.settled()).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[1]).toContain('recording a visit failed')
  })

  it('waits for every write queued, including ones queued while waiting', async () => {
    const written: number[] = []
    const recorder = createVisitRecorder({
      write: async (recorded) => {
        await Promise.resolve()
        written.push(recorded.linkId)
        if (recorded.linkId === 1) recorder.record({ ...visit, linkId: 2 })
      },
    })

    recorder.record(visit)
    await recorder.settled()

    expect(written).toEqual([1, 2])
  })

  it('settles immediately when nothing has been recorded', async () => {
    const recorder = createVisitRecorder({ write: async () => {} })
    await expect(recorder.settled()).resolves.toBeUndefined()
  })
})
