import { describe, expect, it } from 'vitest'
import { linkFixture } from '../../test/fixtures.ts'
import {
  addressFromFullPath,
  findTypedLink,
  linkDisplayPath,
  resolverPath,
  shortForm,
} from './paths.ts'

const address = { namespace: 'go', displayKeyword: 'handbook' }
const engAddress = { namespace: 'eng', displayKeyword: 'deploy' }

describe('the forms a link takes', () => {
  it('labels a link with its namespace, whichever namespace it is', () => {
    expect(linkDisplayPath(address)).toBe('go/handbook')
    expect(linkDisplayPath(engAddress)).toBe('eng/deploy')
  })

  it('leaves the default namespace out of the path, because the host implies it', () => {
    expect(resolverPath(address, 'go')).toBe('handbook')
    expect(resolverPath(engAddress, 'go')).toBe('eng/deploy')
  })

  it('builds the short form a member types', () => {
    expect(shortForm(address, 'go', 'go')).toBe('go/handbook')
    expect(shortForm(engAddress, 'go', 'go')).toBe('go/eng/deploy')
  })

  it('splits a joined path back into a namespace and a keyword', () => {
    expect(addressFromFullPath('go/meeting-notes')).toEqual({
      namespace: 'go',
      displayKeyword: 'meeting-notes',
    })
    expect(addressFromFullPath('go/jira/%s')).toEqual({
      namespace: 'go',
      displayKeyword: 'jira/%s',
    })
  })
})

describe('recognizing a typed keyword', () => {
  const handbook = linkFixture({ id: '1', displayKeyword: 'handbook', fullPath: 'go/handbook' })
  const deploy = linkFixture({
    id: '2',
    namespace: 'eng',
    displayKeyword: 'deploy',
    fullPath: 'eng/deploy',
  })
  const links = [handbook, deploy]

  it('matches the keyword, the label, and the short form', () => {
    expect(findTypedLink('handbook', links, 'go', 'go')).toBe(handbook)
    expect(findTypedLink('go/handbook', links, 'go', 'go')).toBe(handbook)
    expect(findTypedLink('/handbook', links, 'go', 'go')).toBe(handbook)
    expect(findTypedLink('eng/deploy', links, 'go', 'go')).toBe(deploy)
    expect(findTypedLink('go/eng/deploy', links, 'go', 'go')).toBe(deploy)
  })

  it('ignores case and surrounding space, which the keyword rules do too', () => {
    expect(findTypedLink('  HANDBOOK ', links, 'go', 'go')).toBe(handbook)
  })

  it('matches nothing on a partial keyword, so Enter never guesses', () => {
    expect(findTypedLink('hand', links, 'go', 'go')).toBeNull()
    expect(findTypedLink('handbooks', links, 'go', 'go')).toBeNull()
    expect(findTypedLink('', links, 'go', 'go')).toBeNull()
    expect(findTypedLink('   ', links, 'go', 'go')).toBeNull()
  })
})
