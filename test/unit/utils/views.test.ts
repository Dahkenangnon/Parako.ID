import { afterEach, describe, expect, it, vi } from 'vitest';
import nunjucks from 'nunjucks';

describe('views asset resolution', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('falls back to the logical asset path when a development manifest has an invalid shape', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => 'null'),
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(resolveAssetPath('css/app.css')).toBe('/css/app.css');
  });

  it('does not resolve inherited object properties as manifest entries', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => '{}'),
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(resolveAssetPath('toString')).toBe('/toString');
  });

  it('rewrites logical paths from a valid manifest loaded once', async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({ 'css/app.css': 'css/app.abc123.css' })
    );
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync,
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(resolveAssetPath('/css/app.css')).toBe('/css/app.abc123.css');
    expect(resolveAssetPath('css/app.css')).toBe('/css/app.abc123.css');
    expect(readFileSync).toHaveBeenCalledOnce();
  });

  it('fails with a build instruction when the production manifest is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(() => resolveAssetPath('css/app.css')).toThrow(
      /Asset manifest not found.*pnpm build/s
    );
  });

  it('uses the unhashed logical path when the development manifest is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(resolveAssetPath('js/app.js')).toBe('/js/app.js');
  });

  it('reports a malformed production manifest with its parse error', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => '{'),
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(() => resolveAssetPath('css/app.css')).toThrow(
      /Asset manifest .* is malformed: /s
    );
  });

  it('falls back to logical paths for malformed development manifest JSON', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => '{'),
    }));

    const { resolveAssetPath } = await import('../../../src/utils/views.js');

    expect(resolveAssetPath('images/logo.svg')).toBe('/images/logo.svg');
  });
});

describe('configured Nunjucks filters', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('makes asset and safe image helpers available to rendered templates', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
    }));
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment(undefined, {
      autoescape: true,
    });
    configureNunjucks(environment);

    expect(
      environment.renderString(
        '{{ asset("css/app.css") }}|{{ image("/images/logo.svg", { alt: "Parako" }) }}',
        {}
      )
    ).toBe(
      '/css/app.css|<img src="/images/logo.svg" alt="Parako" loading="lazy" decoding="async">'
    );
  });

  it('treats partial empty flash state as having no messages', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);
    const hasFlash = environment.getGlobal('hasFlash') as (
      this: unknown
    ) => boolean;

    expect(hasFlash.call({ ctx: { flash: { success: [] } } })).toBe(false);
  });

  it('detects messages in every supported flash category', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);
    const hasFlash = environment.getGlobal('hasFlash') as (
      this: unknown
    ) => boolean;

    expect(hasFlash.call({})).toBe(false);
    expect(hasFlash.call({ ctx: {} })).toBe(false);
    for (const category of ['success', 'error', 'info', 'warning']) {
      expect(
        hasFlash.call({ ctx: { flash: { [category]: ['message'] } } })
      ).toBe(true);
    }
  });

  it('exposes clock, environment, and timezone globals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2032-04-05T12:00:00Z'));
    vi.stubEnv('NODE_ENV', 'development');
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const developmentEnvironment = new nunjucks.Environment();
    configureNunjucks(developmentEnvironment);

    expect(developmentEnvironment.getGlobal('currentYear')).toBe(2032);
    expect(developmentEnvironment.getGlobal('isDevelopment')).toBe(true);
    expect(developmentEnvironment.getGlobal('isProduction')).toBe(false);
    expect(developmentEnvironment.getGlobal('availableTimezones')).toContain(
      'UTC'
    );

    vi.stubEnv('NODE_ENV', 'production');
    const productionEnvironment = new nunjucks.Environment();
    configureNunjucks(productionEnvironment);
    expect(productionEnvironment.getGlobal('isDevelopment')).toBe(false);
    expect(productionEnvironment.getGlobal('isProduction')).toBe(true);
    vi.useRealTimers();
  });

  it('formats a zero-byte file size as zero bytes', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('fileSize')(0)).toBe('0 B');
  });

  it('formats non-finite file sizes as zero bytes', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('fileSize')(Number.POSITIVE_INFINITY)).toBe(
      '0 B'
    );
  });

  it('clamps file sizes above the largest supported unit to terabytes', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('fileSize')(1024 ** 5)).toBe('1024.0 TB');
  });

  it('emits XSS-safe markup and validates link and badge classes', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('escapeHtml')(`<a href='x'>/&"`)).toBe(
      '&lt;a href=&#x27;x&#x27;&gt;&#x2F;&amp;&quot;'
    );
    expect(environment.getFilter('bold')('<script>')).toBe(
      '<strong>&lt;script&gt;</strong>'
    );
    expect(environment.getFilter('italic')('<script>')).toBe(
      '<em>&lt;script&gt;</em>'
    );
    expect(environment.getFilter('bold')(null)).toBe(null);
    expect(environment.getFilter('bold')(12)).toBe(12);
    expect(environment.getFilter('italic')(null)).toBe(null);
    expect(environment.getFilter('italic')(12)).toBe(12);
    expect(
      environment.getFilter('link')(
        '<Open>',
        'https://example.test/?a=1&b=2',
        'button" onclick="evil()'
      )
    ).toBe(
      '<a href="https:&#x2F;&#x2F;example.test&#x2F;?a=1&amp;b=2" class="button&quot; onclick=&quot;evil()">&lt;Open&gt;</a>'
    );
    expect(
      environment.getFilter('link')('<Unsafe>', 'javascript:alert(1)')
    ).toBe('&lt;Unsafe&gt;');
    expect(environment.getFilter('link')('Open', 'https://example.test')).toBe(
      '<a href="https:&#x2F;&#x2F;example.test">Open</a>'
    );
    expect(environment.getFilter('link')('', 'https://example.test')).toBe('');
    expect(environment.getFilter('statusBadge')('<Ready>', 'success')).toBe(
      '<span class="badge badge-success">&lt;Ready&gt;</span>'
    );
    expect(environment.getFilter('statusBadge')('Ready', 'onclick=evil')).toBe(
      '<span class="badge badge-info">Ready</span>'
    );
    expect(environment.getFilter('statusBadge')('')).toBe('');
  });

  it('formats primitive text values and their nullish boundaries', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('numberFormat')(1234567)).toBe('1,234,567');
    expect(environment.getFilter('numberFormat')(null)).toBe('');
    expect(environment.getFilter('truncate')('short', 10)).toBe('short');
    expect(environment.getFilter('truncate')('abcdefgh', 4)).toBe('abcd...');
    expect(environment.getFilter('truncate')(17)).toBe(17);
    expect(environment.getFilter('capitalize')('hELLO')).toBe('Hello');
    expect(environment.getFilter('capitalize')(null)).toBe(null);
    expect(environment.getFilter('lowercase')('HeLLo')).toBe('hello');
    expect(environment.getFilter('lowercase')(0)).toBe(0);
    expect(environment.getFilter('uppercase')('HeLLo')).toBe('HELLO');
    expect(environment.getFilter('uppercase')(false)).toBe(false);
    expect(environment.getFilter('urlSafe')('  Hello, World!  ')).toBe(
      'hello-world'
    );
    expect(environment.getFilter('urlSafe')(null)).toBe(null);
    expect(environment.getFilter('pluralize')(1, 'item')).toBe('item');
    expect(environment.getFilter('pluralize')(2, 'item')).toBe('items');
    expect(environment.getFilter('pluralize')(2, 'person', 'people')).toBe(
      'people'
    );
    expect(environment.getFilter('pluralize')(null, 'item')).toBe('');
    expect(environment.getFilter('default')('', 'fallback')).toBe('fallback');
    expect(environment.getFilter('default')(null, 'fallback')).toBe('fallback');
    expect(environment.getFilter('default')('value', 'fallback')).toBe('value');
  });

  it('serializes and formats numeric values with safe fallbacks', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(environment.getFilter('tojson')({ ready: true })).toBe(
      '{"ready":true}'
    );
    expect(environment.getFilter('tojson')(undefined)).toBe('null');
    expect(environment.getFilter('tojson')(circular)).toBe('null');
    expect(environment.getFilter('currency')(1234.5, 'USD', 'en-US')).toBe(
      '$1,234.50'
    );
    expect(environment.getFilter('currency')(null)).toBe('');
    expect(environment.getFilter('currency')(12, 'INVALID', 'en-US')).toBe(
      'INVALID 12'
    );
    expect(environment.getFilter('percentage')(0.125, 1)).toBe('12.5%');
    expect(environment.getFilter('percentage')(null)).toBe('');
    expect(environment.getFilter('percentage')(0.5, 101)).toBe('0.5%');
    expect(environment.getFilter('fileSize')(512)).toBe('512 B');
    expect(environment.getFilter('fileSize')('2048')).toBe('2.0 KB');
    expect(environment.getFilter('fileSize')(-1)).toBe('0 B');
    expect(environment.getFilter('fileSize')('not-a-number')).toBe('0 B');
    expect(environment.getFilter('fileSize')(null)).toBe('0 B');
  });

  it('masks private values and handles collection and duration inputs', async () => {
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('mask_email')('alice@example.test')).toBe(
      'a****@example.test'
    );
    expect(environment.getFilter('mask_email')('a@example.test')).toBe(
      'a@example.test'
    );
    expect(environment.getFilter('mask_email')('invalid')).toBe('invalid');
    expect(environment.getFilter('mask_phone')('+229 97 12 34 56')).toBe(
      '*******3456'
    );
    expect(environment.getFilter('mask_phone')('abc1')).toBe('abc1');
    expect(environment.getFilter('mask_phone')(1234)).toBe(1234);

    const hash = environment.getFilter('hash')('stable-value');
    expect(hash).toMatch(/^[0-9a-f]{1,8}$/);
    expect(environment.getFilter('hash')('stable-value')).toBe(hash);
    expect(environment.getFilter('hash')(null)).toBe('');

    expect(environment.getFilter('join')(['a', 'b'])).toBe('a,b');
    expect(environment.getFilter('join')(['a', 'b'], ' | ')).toBe('a | b');
    expect(environment.getFilter('join')('a,b')).toBe('');
    expect(environment.getFilter('length')(['a', 'b'])).toBe(2);
    expect(environment.getFilter('length')('ab')).toBe(0);
    expect(environment.getFilter('includes')(['a', 'b'], 'b')).toBe(true);
    expect(environment.getFilter('includes')('ab', 'b')).toBe(false);
    expect(environment.getFilter('slice')('abcdef', 2)).toBe('cdef');
    expect(environment.getFilter('slice')('abcdef', 1, 3)).toBe('bc');
    expect(environment.getFilter('slice')(null, 0)).toBe('');
    expect(environment.getFilter('kebabCase')('primaryForeground')).toBe(
      'primary-foreground'
    );
    expect(environment.getFilter('kebabCase')(null)).toBe('');

    expect(environment.getFilter('max')([8, Number.NaN, '9', 12])).toBe(12);
    expect(environment.getFilter('max')(['9'])).toBe(0);
    expect(environment.getFilter('max')('9')).toBe('9');
    expect(environment.getFilter('min')([8, Number.NaN, '1', 3])).toBe(3);
    expect(environment.getFilter('min')(['1'])).toBe(0);
    expect(environment.getFilter('min')('1')).toBe('1');

    expect(environment.getFilter('duration')(0)).toBe('unlimited');
    expect(environment.getFilter('duration')('60')).toBe('unlimited');
    expect(environment.getFilter('duration')(86400)).toBe('1 day');
    expect(environment.getFilter('duration')(172800)).toBe('2 days');
    expect(environment.getFilter('duration')(3600)).toBe('1 hour');
    expect(environment.getFilter('duration')(7200)).toBe('2 hours');
    expect(environment.getFilter('duration')(60)).toBe('1 minute');
    expect(environment.getFilter('duration')(120)).toBe('2 minutes');
    expect(environment.getFilter('duration')(1)).toBe('1 second');
    expect(environment.getFilter('duration')(2)).toBe('2 seconds');

    expect(environment.getFilter('displayList')(['en', 'fr'])).toBe('en, fr');
    expect(environment.getFilter('displayList')('en')).toBe('en');
    expect(environment.getFilter('displayList')(null)).toBe('');
  });

  it('formats date and time values with deterministic invalid-value fallbacks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);
    const value = new Date(2026, 7, 1, 13, 4, 5);

    expect(environment.getFilter('date')(null)).toBe('');
    expect(environment.getFilter('date')('invalid')).toBe('invalid');
    expect(environment.getFilter('date')(value, 'YYYY-MM-DD HH:mm:ss A')).toBe(
      '2026-08-01 13:04:05 PM'
    );
    expect(
      environment.getFilter('date')(
        new Date(2026, 7, 1, 0, 4, 5),
        'YY-M-D H hh h m s a'
      )
    ).toBe('26-8-1 0 12 12 4 5 am');
    expect(environment.getFilter('date')(value, 'MMM DD, YYYY')).toContain(
      'Today'
    );
    expect(
      environment.getFilter('date')(value, 'MMM DD, YYYY HH:mm')
    ).toContain('Today');
    expect(
      environment.getFilter('date')(value, 'MMM DD, YYYY HH:mm:ss')
    ).toContain('Today');
    expect(environment.getFilter('date')(value, 'DD/MM/YYYY HH:mm')).toContain(
      'Today'
    );
    expect(
      environment.getFilter('date')(
        new Date('2026-08-01T13:04:05Z'),
        'YYYY-MM-DD HH:mm:ss',
        'UTC'
      )
    ).toBe('2026-08-01 13:04:05');
    expect(
      environment.getFilter('date')(value, {
        useRelativeTime: false,
        includeTime: false,
        serverTimezone: false,
      })
    ).toContain('2026');

    expect(environment.getFilter('datetime')(null)).toBe('');
    expect(environment.getFilter('datetime')('invalid')).toBe('invalid');
    expect(
      environment.getFilter('datetime')(value, {
        useRelativeTime: false,
        serverTimezone: false,
      })
    ).toContain('2026');
    expect(environment.getFilter('relativeTime')(null)).toBe('');
    expect(environment.getFilter('relativeTime')('invalid')).toBe('invalid');
    expect(
      environment.getFilter('relativeTime')(new Date(2026, 7, 1, 11, 55, 0))
    ).toBe('5m ago');
    expect(environment.getFilter('datetimeWithMetadata')(null)).toBe('');
    expect(environment.getFilter('datetimeWithMetadata')('invalid')).toBe(
      'invalid'
    );
    expect(
      environment.getFilter('datetimeWithMetadata')(value, {
        serverTimezone: false,
      })
    ).toMatchObject({ formatted: expect.any(String), isRelative: true });

    expect(environment.getFilter('time')(null)).toBe('');
    expect(environment.getFilter('time')('invalid')).toBe('invalid');
    expect(environment.getFilter('time')(value)).toBe('13:04:05');
    expect(environment.getFilter('dateOnly')(null)).toBe('');
    expect(environment.getFilter('dateOnly')('invalid')).toBe('invalid');
    expect(environment.getFilter('dateOnly')(value)).toBe('Today');
    expect(environment.getFilter('timeOnly')(null)).toBe('');
    expect(environment.getFilter('timeOnly')('invalid')).toBe('invalid');
    expect(environment.getFilter('timeOnly')(value, true)).toBe('13:04');
    expect(environment.getFilter('timeOnly')(value)).toBe('01:04 PM');
  });

  it('calculates age and day predicates at calendar boundaries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 12, 0, 0));
    const { configureNunjucks } = await import('../../../src/utils/views.js');
    const environment = new nunjucks.Environment();
    configureNunjucks(environment);

    expect(environment.getFilter('age')(new Date(2000, 7, 10))).toBe(26);
    expect(environment.getFilter('age')(new Date(2000, 7, 11))).toBe(25);
    expect(environment.getFilter('age')(new Date(2000, 8, 1))).toBe(25);
    expect(environment.getFilter('age')(null)).toBe('');
    expect(environment.getFilter('age')('invalid')).toBe('');

    expect(environment.getFilter('daysAgo')(new Date(2026, 7, 8, 12))).toBe(2);
    expect(environment.getFilter('daysAgo')(new Date(2026, 7, 12, 12))).toBe(2);
    expect(environment.getFilter('daysAgo')(null)).toBe('');
    expect(environment.getFilter('daysAgo')('invalid')).toBe('');

    expect(environment.getFilter('isToday')(new Date(2026, 7, 10, 1))).toBe(
      true
    );
    expect(environment.getFilter('isToday')(null)).toBe(false);
    expect(environment.getFilter('isToday')('invalid')).toBe(false);
    expect(environment.getFilter('isYesterday')(new Date(2026, 7, 9, 23))).toBe(
      true
    );
    expect(environment.getFilter('isYesterday')(null)).toBe(false);
    expect(environment.getFilter('isYesterday')('invalid')).toBe(false);
  });
});

describe('image rendering', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('rewrites logical sources and escapes all caller-controlled attributes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({ 'images/avatar.png': 'images/avatar.hash.png' })
      ),
    }));
    const { renderImage } = await import('../../../src/utils/views.js');

    expect(
      renderImage('images/avatar.png', {
        alt: '"><script>alert(1)</script>',
        loading: 'eager',
        decoding: 'sync',
        fetchpriority: 'high',
        sizes: '(max-width: 10px) 100% & more',
        className: 'avatar" onclick="evil()',
        width: 64,
        height: '64" onerror="evil()',
        id: "profile'image",
      })
    ).toBe(
      '<img src="/images/avatar.hash.png" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" loading="eager" decoding="sync" fetchpriority="high" sizes="(max-width: 10px) 100% &amp; more" class="avatar&quot; onclick=&quot;evil()" width="64" height="64&quot; onerror=&quot;evil()" id="profile&#39;image">'
    );
  });

  it('passes through external and rooted sources with safe defaults', async () => {
    const { renderImage } = await import('../../../src/utils/views.js');

    expect(renderImage('https://cdn.example/avatar.png')).toBe(
      '<img src="https://cdn.example/avatar.png" alt="" loading="lazy" decoding="async">'
    );
    expect(renderImage('/uploads/avatar.png')).toBe(
      '<img src="/uploads/avatar.png" alt="" loading="lazy" decoding="async">'
    );
    expect(renderImage('')).toBe('');
  });
});

describe('picture URL validation', () => {
  it('rejects protocol-relative external URLs', async () => {
    const { isValidPictureUrl } = await import('../../../src/utils/views.js');

    expect(isValidPictureUrl('//attacker.example/tracker.png')).toBe(false);
  });

  it('rejects backslash network-path external URLs', async () => {
    const { isValidPictureUrl } = await import('../../../src/utils/views.js');

    expect(isValidPictureUrl('\\\\attacker.example\\tracker.png')).toBe(false);
  });

  it('accepts only supported public and local URL forms and resolves branding keys', async () => {
    const { isValidHttpUrl, isValidPictureUrl, resolveBrandingUrl } =
      await import('../../../src/utils/views.js');

    expect(isValidHttpUrl('https://images.example/avatar.png')).toBe(true);
    expect(isValidHttpUrl('http://images.example/avatar.png')).toBe(true);
    expect(isValidHttpUrl('ftp://images.example/avatar.png')).toBe(false);
    expect(isValidHttpUrl('not a URL')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);

    expect(isValidPictureUrl('https://images.example/avatar.png')).toBe(true);
    expect(isValidPictureUrl('/uploads/avatar.png')).toBe(true);
    expect(isValidPictureUrl('tenant/avatar.png')).toBe(true);
    expect(isValidPictureUrl('data:image/png;base64,abc')).toBe(false);
    expect(isValidPictureUrl('')).toBe(false);

    const getFileUrl = vi.fn((key: string) => `/media/${key}`);
    expect(resolveBrandingUrl(null, getFileUrl)).toBe('');
    expect(resolveBrandingUrl('https://cdn.example/logo.svg', getFileUrl)).toBe(
      'https://cdn.example/logo.svg'
    );
    expect(resolveBrandingUrl('/images/logo.svg', getFileUrl)).toBe(
      '/images/logo.svg'
    );
    expect(resolveBrandingUrl('/favicon.ico', getFileUrl)).toBe('/favicon.ico');
    expect(resolveBrandingUrl('tenant/logo.svg', getFileUrl)).toBe(
      '/media/tenant/logo.svg'
    );
    expect(
      resolveBrandingUrl('tenant/async.svg', async key => `/media/${key}`)
    ).toBe('tenant/async.svg');

    const { resolveBrandingUrlAsync } =
      await import('../../../src/utils/views.js');
    await expect(
      resolveBrandingUrlAsync('tenant/async.svg', async key => `/media/${key}`)
    ).resolves.toBe('/media/tenant/async.svg');
    await expect(
      resolveBrandingUrlAsync('/images/logo.svg', async () => 'unexpected')
    ).resolves.toBe('/images/logo.svg');
  });
});

describe('HTML escaping', () => {
  it('returns string output for non-null scalar values', async () => {
    const { escapeHtml } = await import('../../../src/utils/views.js');

    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
