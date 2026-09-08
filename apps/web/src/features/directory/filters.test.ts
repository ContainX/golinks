import { describe, expect, it } from 'vitest'
import { directoryQuery, isClientSideFilter, namespaceFilter, sortOption } from './filters.ts'

describe('turning the toolbar into a listing query', () => {
  it('asks for nothing in particular when nothing is selected', () => {
    expect(directoryQuery({ search: '', filter: 'all', sort: 'visits' })).toEqual({
      sort: 'visits',
      order: 'desc',
    })
  })

  it('sends the search as q, trimmed', () => {
    expect(directoryQuery({ search: '  handbook ', filter: 'all', sort: 'visits' }).q).toBe(
      'handbook',
    )
  })

  it('reads Mine as the owner filter the API understands', () => {
    expect(directoryQuery({ search: '', filter: 'mine', sort: 'visits' }).owner).toBe('me')
  })

  it('reads a namespace chip as the namespace filter', () => {
    const query = directoryQuery({ search: '', filter: namespaceFilter('eng'), sort: 'visits' })
    expect(query.namespace).toBe('eng')
  })

  it('reads the programmatic chip as the programmatic filter', () => {
    expect(
      directoryQuery({ search: '', filter: 'programmatic', sort: 'visits' }).programmatic,
    ).toBe(true)
  })

  it('sends no filter for unlisted, which the listing endpoint has no parameter for', () => {
    const query = directoryQuery({ search: '', filter: 'unlisted', sort: 'visits' })
    expect(query).toEqual({ sort: 'visits', order: 'desc' })
    expect(isClientSideFilter('unlisted')).toBe(true)
    expect(isClientSideFilter('mine')).toBe(false)
  })

  it('sorts keywords upward and everything else downward', () => {
    expect(directoryQuery({ search: '', filter: 'all', sort: 'keyword' })).toEqual({
      sort: 'keyword',
      order: 'asc',
    })
    expect(directoryQuery({ search: '', filter: 'all', sort: 'created' })).toEqual({
      sort: 'created',
      order: 'desc',
    })
    expect(sortOption('updated').label).toBe('Recently updated')
  })
})
