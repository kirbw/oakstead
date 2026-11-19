const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { schoolFixture } = require('./helpers/school');

async function submitAssignmentForm(app, pagePath, action, title) {
  const headers = { Cookie: app.cookie('admin').replace('csrfToken=fixture;', `csrfToken=${'a'.repeat(48)};`) };
  const page = await app.request(pagePath, { headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  const markup = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
    .find(([, , body]) => body.includes(`name="action" value="${action}"`));
  assert.ok(markup, `Assignment ${action} form exists`);
  const [, attributes, fields] = markup;
  const formData = new FormData();
  for (const [, name, value] of fields.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
    formData.append(name, value);
  }
  formData.set('title', title);
  formData.set('category', 'Test');
  formData.set('maxScore', '50');
  formData.set('assignmentDate', '2025-10-10');

  const submitHandlers = [];
  const document = {
    baseURI: page.url,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ dataset: {}, childNodes: [], setAttribute() {}, appendChild() {}, focus() {} }),
    addEventListener(type, handler) {
      if (type === 'submit') submitHandlers.push(handler);
    }
  };
  const finished = Promise.withResolvers();
  class AssignmentForm {
    // Real HTML forms expose a named input before the native action property.
    action = { toString: () => '[object HTMLInputElement]' };
    dataset = {};
    classList = { contains: () => false };
    getAttribute(name) {
      return attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
    }
    setAttribute() {}
    removeAttribute() { finished.resolve(); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    prepend() {}
  }
  let postedUrl, savedPage;
  const window = {
    location: { href: page.url },
    addEventListener() {},
    async fetch(url, options) {
      postedUrl = new URL(url, page.url);
      savedPage = await fetch(postedUrl, { ...options, headers: { ...options.headers, ...headers } });
      return savedPage;
    }
  };
  const asset = await app.request('/assets/app.js');
  vm.runInNewContext(await asset.text(), {
    window, document, URL, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    history: { replaceState() {} },
    HTMLFormElement: AssignmentForm,
    FormData: function () { return formData; }
  });
  const event = {
    target: new AssignmentForm(),
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  };
  for (const handler of submitHandlers) handler(event);
  assert.equal(event.defaultPrevented, true);
  await finished.promise;
  assert.equal(postedUrl?.pathname, '/assignments');
  assert.equal(savedPage?.status, 200);
  assert.equal(savedPage.redirected, true);
  const savedUrl = new URL(savedPage.url);
  assert.equal(savedUrl.pathname, '/assignments');
  const assignmentId = Number(savedUrl.searchParams.get('assignmentId'));
  assert.ok(assignmentId > 0);
  assert.match(await app.request(savedUrl.pathname + savedUrl.search, { headers }).then(response => response.text()),
    new RegExp(`<h2>${title}</h2>`));
  return assignmentId;
}

test('Assignments forms save and edit through the app submit handler with a named action input', { timeout: 10000 }, async t => {
  const app = await schoolFixture(t);
  const pagePath = '/assignments?yearId=1&grade=1&subjectId=101';
  const assignmentId = await submitAssignmentForm(app, pagePath + '&action=add', 'add', 'Created assignment');
  const editedId = await submitAssignmentForm(app, pagePath + '&assignmentId=' + assignmentId, 'update', 'Edited assignment');
  assert.equal(editedId, assignmentId);
  const saved = app.withDb(db => db.prepare('SELECT title, max_score FROM os_assignments WHERE id = ?').get(assignmentId));
  assert.equal(saved.title, 'Edited assignment');
  assert.equal(saved.max_score, 50);
});
