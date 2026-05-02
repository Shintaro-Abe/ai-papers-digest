// Shared helpers for the OAuth 2.0 Authorization Code + PKCE flow.
//
// All three auth pages (login, callback, logout) load this script.

(function () {
  'use strict';

  // ---------------- PKCE helpers ----------------
  function base64UrlEncode(buffer) {
    var bytes = new Uint8Array(buffer);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(length) {
    var arr = new Uint8Array(length);
    window.crypto.getRandomValues(arr);
    return base64UrlEncode(arr).slice(0, length);
  }

  async function sha256(input) {
    var enc = new TextEncoder().encode(input);
    var digest = await window.crypto.subtle.digest('SHA-256', enc);
    return base64UrlEncode(digest);
  }

  async function generatePkce() {
    var verifier = randomString(64);
    var challenge = await sha256(verifier);
    return { verifier: verifier, challenge: challenge };
  }

  // ---------------- Cookie helpers ----------------
  // We can't set HttpOnly via document.cookie (browser restriction), so the
  // tokens are technically readable from JS on this origin. We mitigate by:
  //  - SameSite=Lax + Secure so the cookie is only sent over HTTPS and not on
  //    cross-site sub-requests.
  //  - Restricting the Cookie path to "/".
  //  - Keeping the id_token TTL short (~55 min, less than its actual exp).

  function setCookie(name, value, maxAgeSec) {
    var parts = [
      name + '=' + value,
      'Path=/',
      'Secure',
      'SameSite=Lax',
      'Max-Age=' + Math.max(0, Math.floor(maxAgeSec)),
    ];
    document.cookie = parts.join('; ');
  }

  function deleteCookie(name) {
    document.cookie = name + '=; Path=/; Max-Age=0; Secure; SameSite=Lax';
  }

  function getCookie(name) {
    var pairs = document.cookie.split(';');
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i].trim();
      var idx = p.indexOf('=');
      if (idx === -1) continue;
      var k = p.slice(0, idx);
      if (k === name) return p.slice(idx + 1);
    }
    return null;
  }

  // ---------------- Cognito calls ----------------
  function tokenEndpoint() {
    return 'https://' + window.AUTH_CONFIG.cognitoDomain + '/oauth2/token';
  }

  function callbackUrl() {
    return 'https://' + window.AUTH_CONFIG.cloudfrontDomain + '/auth/callback.html';
  }

  function loginUrl(challenge, state) {
    var params = new URLSearchParams({
      client_id: window.AUTH_CONFIG.clientId,
      response_type: 'code',
      scope: window.AUTH_CONFIG.scope,
      redirect_uri: callbackUrl(),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: state,
    });
    return 'https://' + window.AUTH_CONFIG.cognitoDomain + '/login?' + params.toString();
  }

  function logoutUrl() {
    var params = new URLSearchParams({
      client_id: window.AUTH_CONFIG.clientId,
      logout_uri: 'https://' + window.AUTH_CONFIG.cloudfrontDomain + '/auth/logout.html',
    });
    return 'https://' + window.AUTH_CONFIG.cognitoDomain + '/logout?' + params.toString();
  }

  async function exchangeCodeForTokens(code, verifier) {
    var body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: window.AUTH_CONFIG.clientId,
      code: code,
      redirect_uri: callbackUrl(),
      code_verifier: verifier,
    });
    var resp = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!resp.ok) throw new Error('Token exchange failed: ' + resp.status);
    return resp.json();
  }

  async function refreshTokens(refreshToken) {
    var body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: window.AUTH_CONFIG.clientId,
      refresh_token: refreshToken,
    });
    var resp = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!resp.ok) throw new Error('Refresh failed: ' + resp.status);
    return resp.json();
  }

  function storeTokens(tokens) {
    // id_token: 60 min validity in Cognito; we cookie it for 55 min to refresh proactively.
    if (tokens.id_token) setCookie('id_token', tokens.id_token, 55 * 60);
    // refresh_token: 7 days, matching the Cognito client setting. Rotation is
    // enabled server-side so each refresh re-issues a fresh refresh_token.
    if (tokens.refresh_token) setCookie('refresh_token', tokens.refresh_token, 7 * 24 * 60 * 60);
  }

  function clearTokens() {
    deleteCookie('id_token');
    deleteCookie('refresh_token');
  }

  // ---------------- URL safety ----------------
  // Prevent Open Redirect via the `dest` parameter. Only allow same-origin
  // paths starting with a single "/" (rejects "//evil.com" and absolute URLs).
  function safeDest(dest) {
    if (typeof dest !== 'string' || dest.length === 0) return '/';
    if (dest.charAt(0) !== '/') return '/';
    if (dest.charAt(1) === '/' || dest.charAt(1) === '\\') return '/';
    // Reject any control character or scheme-like prefix smuggled through encoding
    try {
      var decoded = decodeURIComponent(dest);
      if (decoded.charAt(0) !== '/' || decoded.charAt(1) === '/') return '/';
      if (/^\/+(?:javascript|data|file):/i.test(decoded)) return '/';
    } catch (_) {
      return '/';
    }
    return dest;
  }

  // ---------------- State encoding ----------------
  // Encodes PKCE state into the OAuth state parameter so it survives
  // cross-context redirects on mobile (iOS WKWebView → Safari handoff,
  // in-app browsers, etc.) where localStorage may be inaccessible on return.

  function encodeState(nonce, verifier, dest) {
    var json = JSON.stringify({ n: nonce, v: verifier, d: dest });
    return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(state) {
    if (!state) return null;
    try {
      var b64 = state.replace(/-/g, '+').replace(/_/g, '/');
      var pad = (4 - (b64.length % 4)) % 4;
      b64 += '==='.slice(0, pad);
      var parsed = JSON.parse(atob(b64));
      if (!parsed || typeof parsed.n !== 'string' || typeof parsed.v !== 'string') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  // Expose helpers
  window.AuthHelpers = {
    generatePkce: generatePkce,
    setCookie: setCookie,
    deleteCookie: deleteCookie,
    getCookie: getCookie,
    loginUrl: loginUrl,
    logoutUrl: logoutUrl,
    exchangeCodeForTokens: exchangeCodeForTokens,
    refreshTokens: refreshTokens,
    storeTokens: storeTokens,
    clearTokens: clearTokens,
    randomString: randomString,
    safeDest: safeDest,
    encodeState: encodeState,
    decodeState: decodeState,
  };
})();
