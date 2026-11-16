function createDomainRoutes({ services, sendText, sendJson, redirect }) {
  const routes = new Map();
  for (const service of services) for (const path of service.paths) {
    if (routes.has(path)) throw new Error(`Duplicate domain route ${path}`);
    routes.set(path, service);
  }
  async function handle(req, res, path, body, user, headers) {
    const service = routes.get(path);
    if (!service) return false;
    const result = await service.execute(path, body, user, req);
    const responseHeaders = { ...headers, ...result.headers };
    if (headers['Set-Cookie'] && result.headers['Set-Cookie']) {
      responseHeaders['Set-Cookie'] = [headers['Set-Cookie'], result.headers['Set-Cookie']].flat();
    }
    if (result.kind === 'redirect') redirect(res, result.location, responseHeaders);
    else if (result.kind === 'json') sendJson(res, result.status, result.body, responseHeaders);
    else sendText(res, result.status, result.body, responseHeaders);
    return true;
  }
  return { paths: new Set(routes.keys()), handle };
}
module.exports = { createDomainRoutes };
