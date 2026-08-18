const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { startServer } = require('./server');

let baseUrl;
let server;

before(async () => {
  server = startServer(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('health endpoint reports readiness', async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('production frontend passes the execute preflight', async () => {
  const response = await fetch(`${baseUrl}/execute`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://toolbox.charles-bai.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://toolbox.charles-bai.com'
  );
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
});

test('unknown origins are not granted browser access', async () => {
  const response = await fetch(`${baseUrl}/execute`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'POST'
    }
  });

  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
