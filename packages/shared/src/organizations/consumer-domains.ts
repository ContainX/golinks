/**
 * Email domains that belong to consumer mailbox providers rather than to an
 * organization (spec 01 §1.2).
 *
 * Under the `domain` resolution strategy an address at one of these domains
 * becomes its own single-member organization, keyed by the full address, so
 * that two unrelated people at the same provider never share a link space.
 *
 * How to extend this list:
 *
 * - Add the domain in lowercase to the group it belongs to, keeping each group
 *   alphabetical, and add country variants next to their parent brand.
 * - Only add domains whose mailboxes are handed out to individuals. A domain
 *   that a company controls for its own staff belongs to that company and must
 *   stay out of the list, even when the provider behind it is a consumer brand.
 * - Nothing else needs to change: the set is derived from this array, and a new
 *   entry takes effect at the next sign-in.
 *
 * A deployment that needs a different answer without a code change can put the
 * domain in the organization alias map instead (spec 01 §1.2), or switch the
 * strategy to `fixed`.
 */
export const CONSUMER_EMAIL_DOMAINS: readonly string[] = Object.freeze([
  // Google
  'gmail.com',
  'googlemail.com',

  // Microsoft
  'hotmail.be',
  'hotmail.ca',
  'hotmail.co.jp',
  'hotmail.co.nz',
  'hotmail.co.uk',
  'hotmail.com',
  'hotmail.com.ar',
  'hotmail.com.au',
  'hotmail.com.br',
  'hotmail.com.mx',
  'hotmail.de',
  'hotmail.es',
  'hotmail.fr',
  'hotmail.it',
  'hotmail.nl',
  'hotmail.se',
  'live.ca',
  'live.co.uk',
  'live.com',
  'live.com.au',
  'live.de',
  'live.fr',
  'live.it',
  'live.nl',
  'live.se',
  'msn.com',
  'outlook.co.id',
  'outlook.co.nz',
  'outlook.co.th',
  'outlook.com',
  'outlook.com.au',
  'outlook.com.br',
  'outlook.com.tr',
  'outlook.de',
  'outlook.dk',
  'outlook.es',
  'outlook.fr',
  'outlook.ie',
  'outlook.in',
  'outlook.it',
  'outlook.jp',
  'outlook.pt',
  'outlook.sa',

  // Yahoo
  'rocketmail.com',
  'yahoo.ca',
  'yahoo.co.id',
  'yahoo.co.in',
  'yahoo.co.jp',
  'yahoo.co.kr',
  'yahoo.co.nz',
  'yahoo.co.uk',
  'yahoo.com',
  'yahoo.com.ar',
  'yahoo.com.au',
  'yahoo.com.br',
  'yahoo.com.hk',
  'yahoo.com.mx',
  'yahoo.com.ph',
  'yahoo.com.sg',
  'yahoo.com.tw',
  'yahoo.com.vn',
  'yahoo.de',
  'yahoo.dk',
  'yahoo.es',
  'yahoo.fr',
  'yahoo.gr',
  'yahoo.ie',
  'yahoo.it',
  'yahoo.no',
  'yahoo.pl',
  'yahoo.se',
  'ymail.com',

  // Apple
  'icloud.com',
  'mac.com',
  'me.com',

  // AOL
  'aim.com',
  'aol.co.uk',
  'aol.com',
  'aol.de',
  'aol.fr',

  // Privacy-focused providers
  'hushmail.com',
  'mailbox.org',
  'mailfence.com',
  'pm.me',
  'posteo.de',
  'posteo.net',
  'proton.me',
  'protonmail.ch',
  'protonmail.com',
  'riseup.net',
  'startmail.com',
  'tuta.com',
  'tuta.io',
  'tutamail.com',
  'tutanota.com',
  'tutanota.de',

  // Independent and subscription providers
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'mail.com',
  'runbox.com',
  'zoho.com',
  'zoho.eu',
  'zohomail.com',

  // Germany, Austria, and Switzerland
  'arcor.de',
  'bluewin.ch',
  'freenet.de',
  'gmx.at',
  'gmx.ch',
  'gmx.com',
  'gmx.de',
  'gmx.fr',
  'gmx.net',
  'gmx.us',
  't-online.de',
  'web.de',

  // France, Belgium, and the Netherlands
  'free.fr',
  'hetnet.nl',
  'home.nl',
  'kpnmail.nl',
  'laposte.net',
  'orange.fr',
  'sfr.fr',
  'skynet.be',
  'telenet.be',
  'wanadoo.fr',
  'xs4all.nl',
  'ziggo.nl',

  // Italy, Spain, and Portugal
  'alice.it',
  'libero.it',
  'sapo.pt',
  'terra.es',
  'tin.it',
  'tiscali.it',
  'virgilio.it',

  // Nordics and central Europe
  'atlas.cz',
  'centrum.cz',
  'email.cz',
  'freemail.hu',
  'interia.pl',
  'o2.pl',
  'onet.pl',
  'op.pl',
  'seznam.cz',
  'suomi24.fi',
  'telia.com',
  'wp.pl',

  // Russia, Ukraine, and central Asia
  'bk.ru',
  'inbox.ru',
  'list.ru',
  'mail.ru',
  'rambler.ru',
  'ukr.net',
  'ya.ru',
  'yandex.by',
  'yandex.com',
  'yandex.kz',
  'yandex.ru',
  'yandex.ua',

  // China and Taiwan
  '126.com',
  '139.com',
  '163.com',
  '21cn.com',
  'aliyun.com',
  'foxmail.com',
  'qq.com',
  'sina.cn',
  'sina.com',
  'sohu.com',
  'yeah.net',

  // Korea and Japan
  'daum.net',
  'hanmail.net',
  'naver.com',
  'nate.com',
  'nifty.com',

  // South and southeast Asia
  'indiatimes.com',
  'rediffmail.com',
  'sify.com',

  // Latin America
  'bol.com.br',
  'globo.com',
  'ig.com.br',
  'terra.com.br',
  'uol.com.br',

  // United Kingdom, Ireland, Australia, and New Zealand
  'bigpond.com',
  'bigpond.net.au',
  'btinternet.com',
  'eircom.net',
  'iinet.net.au',
  'ntlworld.com',
  'optusnet.com.au',
  'sky.com',
  'talktalk.net',
  'tpg.com.au',
  'virginmedia.com',
  'xtra.co.nz',

  // United States and Canada
  'att.net',
  'bellsouth.net',
  'charter.net',
  'comcast.net',
  'cox.net',
  'earthlink.net',
  'juno.com',
  'mindspring.com',
  'optonline.net',
  'rogers.com',
  'sbcglobal.net',
  'shaw.ca',
  'sympatico.ca',
  'telus.net',
  'verizon.net',
  'videotron.ca',
  'windstream.net',

  // Middle East and Africa
  'abv.bg',
  'mail.bg',
  'mweb.co.za',
  'mynet.com',
  'walla.co.il',
  'walla.com',
])

const CONSUMER_EMAIL_DOMAIN_SET: ReadonlySet<string> = new Set(CONSUMER_EMAIL_DOMAINS)

/** True when the domain belongs to a consumer mailbox provider (spec 01 §1.2). */
export function isConsumerEmailDomain(domain: string): boolean {
  return CONSUMER_EMAIL_DOMAIN_SET.has(domain.trim().toLowerCase())
}
