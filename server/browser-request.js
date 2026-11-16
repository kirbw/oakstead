// Embedded in the browser asset and tested independently; no runtime imports.
function createBrowserRequest({ fetch: fetchRequest, timeoutMs = 30000, onAuthLoss = () => {} }) {
  return async function request(url, options = {}) {
    const { responseType = 'json', allowLoginRedirect = false, ...init } = options;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    function failure(message, status = 0, requestId = '', fields = {}) {
      return Object.assign(new Error(message), { status, requestId, fields });
    }
    try {
      const response = await fetchRequest(url, { ...init, signal: controller.signal });
      const raw = await response.text();
      if (response.status === 401 || (!allowLoginRedirect && /\/login(?:[?#]|$)/.test(response.url || ''))) {
        const error = failure('Your session ended. Sign in again, then retry unsaved work.', 401, response.headers.get('x-request-id') || '');
        onAuthLoss(error);
        throw error;
      }
      const jsonType = /application\/(?:problem\+)?json/i.test(response.headers.get('content-type') || '');
      let data;
      if (jsonType) {
        try { data = JSON.parse(raw); }
        catch { throw failure('The server returned an unreadable response. Check whether the change saved before trying again.', response.status); }
      }
      const requestId = response.headers.get('x-request-id') || data?.requestId || '';
      if (!response.ok) throw failure(data?.error || 'The request could not be completed. Please try again.', response.status, requestId, data?.problem?.fields || {});
      if (responseType === 'json' && !jsonType) throw failure('The server returned an unexpected response. Check whether the change saved before trying again.', response.status, requestId);
      return { ok: true, status: response.status, url: response.url, redirected: response.redirected,
        json: async () => data, text: async () => raw };
    } catch (error) {
      if (timedOut) throw failure('The request timed out. Check whether the change saved before trying again.');
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
  };
}
module.exports = { createBrowserRequest };
