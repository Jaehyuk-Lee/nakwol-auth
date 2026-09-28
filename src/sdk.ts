import type { Hono } from 'hono';
import sdkV01Source from './assets/nakwol-auth-web.js.txt';
import sdkV02Source from './assets/nakwol-auth-web-v0.2.0.js.txt';
import sdkV03Source from './assets/nakwol-auth-web-v0.3.0.js.txt';
import sdkV031Source from './assets/nakwol-auth-web-v0.3.1.js.txt';

import sdkV032Source from './assets/nakwol-auth-web-v0.3.2.js.txt';

export const NAKWOL_AUTH_WEB_SDK_VERSION = '0.3.2';

function javascriptResponse(source: string, cacheControl: string): Response {
  return new Response(source, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function registerSdkRoutes(app: Hono<any>) {
  app.get('/sdk/v0.1.0/nakwol-auth-web.js', () =>
    javascriptResponse(sdkV01Source, 'public, max-age=31536000, immutable')
  );

  app.get('/sdk/v0.2.0/nakwol-auth-web.js', () =>
    javascriptResponse(sdkV02Source, 'public, max-age=31536000, immutable')
  );

  app.get('/sdk/v0.3.0/nakwol-auth-web.js', () =>
    javascriptResponse(sdkV03Source, 'public, max-age=31536000, immutable')
  );

  app.get('/sdk/v0.3.1/nakwol-auth-web.js', () =>
    javascriptResponse(sdkV031Source, 'public, max-age=31536000, immutable')
  );

  app.get('/sdk/v0.3.2/nakwol-auth-web.js', () =>
    javascriptResponse(sdkV032Source, 'public, max-age=31536000, immutable')
  );

  app.get('/sdk/nakwol-auth-web.js', () =>
    javascriptResponse(sdkV032Source.replaceAll('../v0.3.1/nakwol-auth-web.js', './v0.3.1/nakwol-auth-web.js'), 'public, max-age=300')
  );

  app.get('/sdk/manifest.json', (c) => {
    const response = c.json({
      ok: true,
      name: 'nakwol-auth-web',
      stable: NAKWOL_AUTH_WEB_SDK_VERSION,
      module: '/sdk/v0.3.2/nakwol-auth-web.js',
      alias: '/sdk/nakwol-auth-web.js',
      format: 'browser-esm',
    });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'public, max-age=300');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  });
}
