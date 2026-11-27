import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { selectRoutes, summarise, withQuery, smoke } from './smoke-routes.mjs';

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const docs = {
  paths: {
    '/api/v1/health': { get: {} },
    '/api/v1/products/{id}': { get: {} },
    '/api/v1/cart': { get: {}, post: {} },
    '/api/v1/orders': { post: {} },
    '/api/v1/recommendations/for-you': { get: {} },
    '/api/v1/broken': { get: {} },
  },
};

test('selects only GET routes without path parameters', () => {
  assert.deepEqual(selectRoutes(docs), [
    '/api/v1/broken',
    '/api/v1/cart',
    '/api/v1/health',
    '/api/v1/recommendations/for-you',
  ]);
});

test('adds a session id only to the routes that need one', () => {
  assert.match(withQuery('/api/v1/recommendations/for-you'), /\?sessionId=/);
  assert.equal(withQuery('/api/v1/cart'), '/api/v1/cart');
});

test('counts statuses and separates server errors', () => {
  const s = summarise([{ status: 200 }, { status: 401 }, { status: 500 }, { status: 0 }]);
  assert.deepEqual(s.byStatus, { 0: 1, 200: 1, 401: 1, 500: 1 });
  assert.equal(s.serverErrors.length, 2);
});

test('reports a route that answers 5xx and treats 401 as fine', async () => {
  const { server, url } = await serve((req, res) => {
    if (req.url === '/api/docs-json') return res.end(JSON.stringify(docs));
    if (req.url.startsWith('/api/v1/broken')) { res.statusCode = 500; return res.end('x'); }
    if (req.url.startsWith('/api/v1/cart')) { res.statusCode = 401; return res.end('x'); }
    res.end('ok');
  });
  const out = await smoke(url, { origin: 'http://localhost:5173' });
  server.close();
  assert.deepEqual(out.serverErrors.map((r) => r.route), ['/api/v1/broken']);
  assert.equal(out.byStatus[401], 1);
});

test('skips quietly when the API does not publish its documentation', async () => {
  const { server, url } = await serve((req, res) => { res.statusCode = 404; res.end('no'); });
  const out = await smoke(url, { origin: 'http://localhost:5173' });
  server.close();
  assert.match(out.skipped, /not served/);
});

test('a route that never answers counts as a failure', async () => {
  const { server, url } = await serve((req, res) => {
    if (req.url === '/api/docs-json') return res.end(JSON.stringify({ paths: { '/hang': { get: {} } } }));
    // never answers /hang
  });
  const out = await smoke(url, { origin: 'http://localhost:5173', maxMs: 300 });
  server.closeAllConnections?.();
  server.close();
  assert.equal(out.serverErrors.length, 1);
  assert.equal(out.serverErrors[0].status, 0);
});
