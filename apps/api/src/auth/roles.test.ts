import { describe, expect, it } from 'vitest'
import { computeRole, isConfiguredAdmin, isGroupAdmin } from './roles.ts'

const EMAIL = 'ada@widgets.test'

describe('computeRole', () => {
  it('leaves a member a member when no source names them', () => {
    expect(computeRole({ email: EMAIL })).toEqual({ role: 'member', roleSource: 'config' })
  })

  it('promotes an address listed in the organization settings', () => {
    expect(computeRole({ email: EMAIL, settingsAdmins: [EMAIL] })).toEqual({
      role: 'admin',
      roleSource: 'config',
    })
  })

  it('promotes an address listed in INITIAL_ADMIN_EMAILS, which is how a fresh install starts', () => {
    expect(computeRole({ email: EMAIL, initialAdminEmails: [EMAIL] })).toEqual({
      role: 'admin',
      roleSource: 'config',
    })
  })

  it('promotes a member of a configured admin group', () => {
    expect(
      computeRole({
        email: EMAIL,
        groups: ['engineering', 'golinks-admins'],
        adminGroups: ['golinks-admins'],
      }),
    ).toEqual({ role: 'admin', roleSource: 'idp' })
  })

  it('records config rather than idp when both sources agree', () => {
    expect(
      computeRole({
        email: EMAIL,
        settingsAdmins: [EMAIL],
        groups: ['golinks-admins'],
        adminGroups: ['golinks-admins'],
      }),
    ).toEqual({ role: 'admin', roleSource: 'config' })
  })

  it('keeps a manual role whatever the other sources say', () => {
    expect(
      computeRole({
        email: EMAIL,
        settingsAdmins: [EMAIL],
        current: { role: 'member', roleSource: 'manual' },
      }),
    ).toEqual({ role: 'member', roleSource: 'manual' })

    expect(computeRole({ email: EMAIL, current: { role: 'admin', roleSource: 'manual' } })).toEqual(
      { role: 'admin', roleSource: 'manual' },
    )
  })

  it('demotes a config admin who is no longer listed', () => {
    expect(computeRole({ email: EMAIL, current: { role: 'admin', roleSource: 'config' } })).toEqual(
      { role: 'member', roleSource: 'config' },
    )
  })

  it('demotes an idp admin who has left the group', () => {
    expect(
      computeRole({
        email: EMAIL,
        groups: ['engineering'],
        adminGroups: ['golinks-admins'],
        current: { role: 'admin', roleSource: 'idp' },
      }),
    ).toEqual({ role: 'member', roleSource: 'config' })
  })

  it('compares addresses and groups without regard to case or padding', () => {
    expect(computeRole({ email: EMAIL, settingsAdmins: ['  Ada@Widgets.TEST '] }).role).toBe(
      'admin',
    )
    expect(
      computeRole({ email: EMAIL, groups: [' GoLinks-Admins '], adminGroups: ['golinks-admins'] })
        .role,
    ).toBe('admin')
  })

  it('ignores groups when the deployment configured none', () => {
    expect(isGroupAdmin({ email: EMAIL, groups: ['golinks-admins'] })).toBe(false)
    expect(isConfiguredAdmin({ email: EMAIL })).toBe(false)
  })
})
