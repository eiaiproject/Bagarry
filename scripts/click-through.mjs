#!/usr/bin/env node
// Click-through di peramban sungguhan untuk memenuhi aturan R-35: setiap halaman dibuka
// di Chromium headless, setiap tautan diklik satu per satu, galat konsol dicatat, fokus
// keyboard dan breakpoint mobile diuji, dan kontras teks dihitung dari gaya terhitung.
//
// Tanpa dependensi di luar Node bawaan: peramban dijalankan sendiri lalu dikendalikan
// lewat Chrome DevTools Protocol memakai WebSocket global Node.
//
// Pakai: node scripts/click-through.mjs [base_url]
// Prasyarat: `npm run dev` berjalan di database lokal yang masih memakai password default
//            (jalankan `npm run db:reset:local` lalu `npm run db:seed:local` lebih dulu).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const ADMIN = { identifier: 'bendahara@bagarry.id', password: 'Bagarry#Admin' };
const RESIDENT = { identifier: 'Lupine-C4/06', password: 'BagarryC4/06' };
const ADMIN_NEW_PASSWORD = 'BagarryAdmin2026';
const RESIDENT_NEW_PASSWORD = 'WargaC604baru';

const BROWSER_CANDIDATES = [
  process.env.BROWSER_BIN,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const ADMIN_PAGES = [
  '/admin',
  '/admin/payments/pending',
  '/admin/houses',
  '/admin/houses/new',
  '/admin/houses/import',
  '/admin/payments',
  '/admin/expenses',
  '/admin/reports',
  '/admin/settings',
  '/admin/audit',
  '/admin/password',
];

const RESIDENT_PAGES = ['/warga', '/warga/pembayaran', '/warga/riwayat', '/warga/password'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error('Tidak ada peramban Chromium di mesin ini. Set BROWSER_BIN ke jalur binernya.');
  }
  return found;
}

async function waitForDevToolsPort(profile, timeoutMs = 30000) {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, 'utf8').split('\n');
      if (port) return Number(port);
    }
    await sleep(200);
  }
  throw new Error('Peramban tidak menyiapkan port debug dalam batas waktu.');
}

async function targetWebSocketUrl(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`Gagal membuka tab baru: HTTP ${res.status}`);
  const target = await res.json();
  return target.webSocketDebuggerUrl;
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('Koneksi WebSocket ke peramban gagal.')));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const handler of listeners.get(message.method)) handler(message.params);
    }
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(handler);
    },
    close() {
      try {
        socket.close();
      } catch {
        // koneksi mungkin sudah tertutup
      }
    },
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}
function section(title) {
  console.log(`\n== ${title}`);
}
function report() {
  let pass = 0;
  let fail = 0;
  for (const item of results) {
    if (item.ok) {
      pass += 1;
      console.log(`PASS  ${item.name}`);
    } else {
      fail += 1;
      console.log(`FAIL  ${item.name}${item.detail ? `  (${item.detail})` : ''}`);
    }
  }
  console.log(`\nRingkasan click-through: ${pass} pass, ${fail} fail`);
  return fail;
}

const CONTRAST_SNIPPET = `(() => {
  function parse(color) {
    const m = color.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(function (v) { return parseFloat(v); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) {
    const x = lum(a); const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function background(el) {
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.95) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const text = Array.from(el.childNodes)
      .filter(function (n) { return n.nodeType === 3; })
      .map(function (n) { return n.textContent.trim(); })
      .join(' ')
      .trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const min = large ? 3 : 4.5;
    const found = ratio(fg, background(el));
    if (found < min - 0.01) {
      out.push({ text: text.slice(0, 48), found: Number(found.toFixed(2)), min: min, size: size, weight: weight });
    }
  }
  return out;
})()`;

const OVERFLOW_SNIPPET = `(() => {
  const root = document.documentElement;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (box.right > root.clientWidth + 1 || box.left < -1) {
      let parent = el.parentElement;
      let insideScroller = false;
      while (parent) {
        const pcs = getComputedStyle(parent);
        if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') { insideScroller = true; break; }
        parent = parent.parentElement;
      }
      if (!insideScroller) offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), right: Math.round(box.right) });
    }
  }
  return { documentWidth: root.scrollWidth, viewportWidth: root.clientWidth, offenders: offenders.slice(0, 5) };
})()`;

const TAP_TARGET_SNIPPET = `(() => {
  // Sasaran sentuh sebuah centang adalah labelnya, bukan kotak kecilnya.
  function effectiveTarget(el) {
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      const label = el.closest('label') || (el.id ? document.querySelector('label[for="' + el.id + '"]') : null);
      if (label) return label;
    }
    return el;
  }
  const small = [];
  for (const el of document.querySelectorAll('a, button, input, select, textarea')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    // Tautan teks di tengah kalimat bukan sasaran sentuh terpisah (pengecualian WCAG 2.5.8).
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.textContent.trim()) continue;
    const target = effectiveTarget(el);
    const rect = target.getBoundingClientRect();
    if (rect.height < 44 - 0.5) {
      small.push({
        tag: el.tagName,
        text: (el.textContent || el.getAttribute('type') || '').trim().slice(0, 30),
        target: target.tagName,
        height: Math.round(rect.height),
      });
    }
  }
  return small;
})()`;

async function main() {
  const browserPath = findBrowser();
  console.log(`Peramban: ${browserPath}`);
  const profile = await mkdtemp(join(tmpdir(), 'bagarry-clickthrough-'));
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  try {
    const port = await waitForDevToolsPort(profile);
    cdp = connect(await targetWebSocketUrl(port));
    await cdp.ready;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'exception');
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry.level === 'error') consoleErrors.push(params.entry.text);
    });

    let loadSettle = null;
    cdp.on('Page.loadEventFired', () => {
      if (loadSettle) {
        const settle = loadSettle;
        loadSettle = null;
        settle();
      }
    });

    const documentStatuses = [];
    cdp.on('Network.responseReceived', (params) => {
      if (params.type === 'Document') documentStatuses.push(params.response.status);
    });

    // Jalankan aksi yang memicu perpindahan halaman, lalu tunggu pemuatan selesai.
    // Batas waktu membuat langkah yang memang tidak berpindah halaman tetap cepat.
    const withLoad = async (action, timeoutMs = 8000) => {
      const loaded = new Promise((resolve) => {
        loadSettle = resolve;
      });
      const result = await action();
      await Promise.race([loaded, sleep(timeoutMs)]);
      loadSettle = null;
      await sleep(60);
      return result;
    };

    const evaluate = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        const detail = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'evaluate gagal';
        throw new Error(`${detail.split('\n')[0]} pada: ${expression.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
      return res.result.value;
    };

    const pathname = () => evaluate('location.pathname + location.search');

    const navigate = async (path) => {
      consoleErrors.length = 0;
      documentStatuses.length = 0;
      await withLoad(() => cdp.send('Page.navigate', { url: `${BASE}${path}` }));
      return { status: documentStatuses[documentStatuses.length - 1] ?? null, errors: [...consoleErrors] };
    };

    const click = async (expression) => {
      consoleErrors.length = 0;
      documentStatuses.length = 0;
      const value = await withLoad(() => evaluate(expression));
      return {
        value,
        path: await pathname(),
        status: documentStatuses[documentStatuses.length - 1] ?? null,
        errors: [...consoleErrors],
      };
    };

    const pageInfo = () =>
      evaluate(`(() => ({
        title: document.title,
        text: document.body.innerText.slice(0, 20000),
        links: Array.from(document.querySelectorAll('a[href]')).map(function (a) {
          return { href: a.getAttribute('href'), text: a.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) };
        }),
      }))()`);

    // Tombol submit harus diambil dari form pemilik kolomnya. Header memasang form Keluar
    // lebih dulu di DOM, jadi querySelector global akan menekan tombol yang salah.
    const submitLogin = (account) =>
      `(() => {
        const form = document.querySelector('#identifier').form;
        form.querySelector('#identifier').value = ${JSON.stringify(account.identifier)};
        form.querySelector('#password').value = ${JSON.stringify(account.password)};
        const button = form.querySelector('button[type="submit"]');
        button.click();
        const label = button.querySelector('span');
        const cs = getComputedStyle(button);
        return {
          disabled: button.disabled,
          label: (label || {}).textContent,
          busy: button.getAttribute('aria-busy'),
          opacity: cs.opacity,
          labelColor: label ? getComputedStyle(label).color : null,
        };
      })()`;

    const submitPasswordChange = (current, next) =>
      `(() => {
        const form = document.querySelector('#current').form;
        form.querySelector('#current').value = ${JSON.stringify(current)};
        form.querySelector('#next').value = ${JSON.stringify(next)};
        form.querySelector('#confirm').value = ${JSON.stringify(next)};
        form.querySelector('button[type="submit"]').click();
      })()`;

    // ---------------------------------------------------------------- anonim
    section('Anonim: papan pengumuman');
    let step = await navigate('/');
    let info = await pageInfo();
    check('GET / merespons 200', step.status === 200, `status ${step.status}`);
    check('Papan publik tanpa galat konsol', step.errors.length === 0, step.errors.join(' | ').slice(0, 160));
    check('Papan publik tanpa undefined atau NaN', !/undefined|NaN/.test(info.text));
    check('Papan publik menampilkan saldo kas', /Saldo kas/.test(info.text));
    check('Papan publik punya tautan Masuk', info.links.some((l) => l.href === '/login'));

    let clickedStep = await click(`document.querySelector('a[href="/login"]').click()`);
    check('Klik "Masuk" membuka halaman login', clickedStep.path === '/login', String(clickedStep.path));
    check('Halaman login tanpa galat konsol', clickedStep.errors.length === 0, clickedStep.errors.join(' | ').slice(0, 160));

    // ----------------------------------------------------------------- login
    section('Login: validasi dan kunci tombol');
    const emptyValidity = await evaluate(
      `(() => { const f = document.querySelector('form'); f.querySelector('#identifier').value = ''; f.querySelector('#password').value = ''; return f.checkValidity(); })()`,
    );
    check('Form kosong ditolak validasi peramban', emptyValidity === false);

    const blocked = await evaluate(`(() => {
      const form = document.querySelector('#identifier').form;
      const button = form.querySelector('button[type="submit"]');
      button.click();
      return { validity: form.checkValidity(), disabled: button.disabled };
    })()`);
    check('Form kosong tidak terkunci dan tidak dikirim', blocked.disabled === false, JSON.stringify(blocked));
    check('Form kosong tidak berpindah halaman', (await pathname()) === '/login', String(await pathname()));

    await navigate('/login');
    clickedStep = await click(submitLogin(ADMIN));
    const lock = clickedStep.value ?? {};
    check('Tombol submit terkunci saat form sungguhan dikirim', lock.disabled === true, JSON.stringify(lock));
    check('Label tombol berubah menjadi "Mengirim..."', lock.label === 'Mengirim...', String(lock.label));
    check('Tombol submit menandai aria-busy', lock.busy === 'true', String(lock.busy));
    // Meredupkan tombol saat dikunci akan menjatuhkan kontras labelnya di bawah 4,5:1.
    check('Tombol terkunci tidak diredupkan', lock.opacity === '1', `opacity ${lock.opacity}`);
    check('Login bendahara diarahkan ke /ganti-password', clickedStep.path === '/ganti-password', String(clickedStep.path));
    check('Login tanpa galat konsol', clickedStep.errors.length === 0, clickedStep.errors.join(' | ').slice(0, 160));

    section('Ganti password wajib');
    clickedStep = await click(submitPasswordChange(ADMIN.password, ADMIN_NEW_PASSWORD));
    if (process.env.CLICK_THROUGH_DEBUG) {
      const debugInfo = await pageInfo();
      console.log(`DEBUG ganti password: ${JSON.stringify({ path: clickedStep.path, status: clickedStep.status, errors: clickedStep.errors })}`);
      console.log(`DEBUG teks halaman: ${debugInfo.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    check('Ganti password bendahara masuk ke /admin', clickedStep.path.startsWith('/admin'), String(clickedStep.path));

    // --------------------------------------------------------- klik tiap link
    const clicked = new Set();
    const contrastFindings = [];
    const checkedPages = new Set();

    async function walkPages(paths, roleLabel) {
      for (const path of paths) {
        const visit = await navigate(path);
        const pageData = await pageInfo();
        check(`${roleLabel} GET ${path} merespons 200`, visit.status === 200, `status ${visit.status}`);
        check(`${roleLabel} ${path} tanpa galat konsol`, visit.errors.length === 0, visit.errors.join(' | ').slice(0, 160));
        check(`${roleLabel} ${path} tanpa undefined atau NaN`, !/undefined|NaN/.test(pageData.text));

        if (!checkedPages.has(path)) {
          checkedPages.add(path);
          const bad = await evaluate(CONTRAST_SNIPPET);
          for (const item of bad) contrastFindings.push({ page: path, ...item });
        }

        for (const link of pageData.links.filter((l) => !clicked.has(l.href))) {
          clicked.add(link.href);
          const reset = await navigate(path);
          if (reset.status !== 200) continue;
          const tapped = await click(`(() => {
            const a = Array.from(document.querySelectorAll('a[href]')).find(function (el) { return el.getAttribute('href') === ${JSON.stringify(link.href)}; });
            if (!a) return null;
            a.click();
            return true;
          })()`);
          if (!tapped.value) continue;
          check(
            `${roleLabel} klik "${link.text || link.href}" -> ${tapped.path}`,
            tapped.status !== null && tapped.status < 400 && tapped.errors.length === 0,
            `status ${tapped.status}${tapped.errors.length ? ` galat: ${tapped.errors.join(' | ').slice(0, 120)}` : ''}`,
          );
        }
      }
    }

    section('Bendahara: klik setiap tautan');
    await walkPages(ADMIN_PAGES, 'bendahara');

    // ------------------------------------------------------- breakpoint mobile
    section('Bendahara: lebar 360 px dan 1280 px');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    for (const path of ['/', '/login', ...ADMIN_PAGES]) {
      await navigate(path);
      const landed = await pathname();
      const label = landed === path ? path : `${path} (dialihkan ke ${landed})`;
      const overflow = await evaluate(OVERFLOW_SNIPPET);
      check(
        `360 px ${label} tanpa luber horizontal`,
        overflow.documentWidth <= overflow.viewportWidth + 1,
        `dokumen ${overflow.documentWidth} px, viewport ${overflow.viewportWidth} px, contoh ${JSON.stringify(overflow.offenders)}`,
      );
      const small = await evaluate(TAP_TARGET_SNIPPET);
      check(`360 px ${label} target sentuh minimal 44 px`, small.length === 0, JSON.stringify(small.slice(0, 5)));
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate('/admin');
    const wideOverflow = await evaluate(OVERFLOW_SNIPPET);
    check(
      '1280 px /admin tanpa luber horizontal',
      wideOverflow.documentWidth <= wideOverflow.viewportWidth + 1,
      `dokumen ${wideOverflow.documentWidth} px, viewport ${wideOverflow.viewportWidth} px`,
    );
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // ---------------------------------------------------------- keyboard focus
    section('Keyboard: Tab dan cincin fokus');
    for (const path of ['/', '/login', '/admin', '/admin/houses/new']) {
      await navigate(path);
      await evaluate('document.body.focus()');
      const sequence = [];
      for (let i = 0; i < 6; i += 1) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
        const focused = await evaluate(`(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          return {
            tag: el.tagName,
            text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
            focusVisible: el.matches(':focus-visible'),
            outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
          };
        })()`);
        if (focused) sequence.push(focused);
      }
      check(`${path} Tab mencapai elemen interaktif`, sequence.length >= 3, `hanya ${sequence.length} elemen`);
      check(
        `${path} setiap elemen terfokus punya cincin fokus`,
        sequence.length > 0 && sequence.every((s) => s.focusVisible && s.outline.startsWith('solid')),
        JSON.stringify(sequence.filter((s) => !(s.focusVisible && s.outline.startsWith('solid')))),
      );
    }

    // --------------------------------------------------------------- keluar
    section('Keluar');
    await navigate('/admin');
    clickedStep = await click(`document.querySelector('form[action="/logout"] button').click()`);
    check('Klik Keluar kembali ke papan publik', clickedStep.path === '/', String(clickedStep.path));
    const afterLogout = await pageInfo();
    check('Setelah keluar, tautan Masuk muncul kembali', afterLogout.links.some((l) => l.href === '/login'));

    // ------------------------------------------------------------------ warga
    section('Warga: login, ganti password, klik setiap tautan');
    await navigate('/login');
    clickedStep = await click(submitLogin(RESIDENT));
    check('Login warga diarahkan ke /ganti-password', clickedStep.path === '/ganti-password', String(clickedStep.path));

    clickedStep = await click(submitPasswordChange(RESIDENT.password, RESIDENT_NEW_PASSWORD));
    check('Ganti password warga masuk ke /warga', clickedStep.path.startsWith('/warga'), String(clickedStep.path));

    await walkPages(RESIDENT_PAGES, 'warga');

    section('Warga: lebar 360 px');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    for (const path of RESIDENT_PAGES) {
      await navigate(path);
      const overflow = await evaluate(OVERFLOW_SNIPPET);
      check(
        `360 px ${path} tanpa luber horizontal`,
        overflow.documentWidth <= overflow.viewportWidth + 1,
        `dokumen ${overflow.documentWidth} px, viewport ${overflow.viewportWidth} px, contoh ${JSON.stringify(overflow.offenders)}`,
      );
      const small = await evaluate(TAP_TARGET_SNIPPET);
      check(`360 px ${path} target sentuh minimal 44 px`, small.length === 0, JSON.stringify(small.slice(0, 5)));
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    check(
      'Kontras seluruh halaman memenuhi WCAG AA',
      contrastFindings.length === 0,
      contrastFindings.slice(0, 8).map((f) => `${f.page} "${f.text}" ${f.found}:1 (min ${f.min})`).join(' ; '),
    );

    section('Halaman tidak ditemukan');
    const notFound = await navigate('/halaman-tidak-ada');
    const notFoundInfo = await pageInfo();
    check('Alamat tidak dikenal menjawab 404', notFound.status === 404, `status ${notFound.status}`);
    check('Halaman 404 menampilkan pesan yang terbaca', /tidak ditemukan/i.test(notFoundInfo.text), notFoundInfo.text.slice(0, 80));
  } finally {
    cdp?.close();
    child.kill('SIGKILL');
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  const failures = report();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nClick-through berhenti: ${error.message}`);
  report();
  process.exit(2);
});
