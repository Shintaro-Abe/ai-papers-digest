// Login page logic — extracted from inline script for CSP compliance.
(async function () {
  'use strict';
  var statusEl = document.getElementById('status');

  // Read intended destination from query string and sanitize against open redirect.
  var params = new URLSearchParams(window.location.search);
  var dest = window.AuthHelpers.safeDest(params.get('dest'));
  // Cap dest length to keep the state parameter within Cognito's 2048-char limit.
  if (dest.length > 200) dest = '/';

  // 1. Try silent refresh if a refresh_token cookie exists
  var refreshToken = window.AuthHelpers.getCookie('refresh_token');
  if (refreshToken) {
    try {
      statusEl.textContent = 'セッションを復元中…';
      var tokens = await window.AuthHelpers.refreshTokens(refreshToken);
      window.AuthHelpers.storeTokens(tokens);
      window.location.replace(dest);
      return;
    } catch (_err) {
      // Refresh failed, fall through to interactive login
      window.AuthHelpers.clearTokens();
    }
  }

  // 2. Interactive login: PKCE start
  try {
    var pkce = await window.AuthHelpers.generatePkce();
    var nonce = window.AuthHelpers.randomString(32);

    // Store in localStorage for CSRF validation on desktop.
    localStorage.setItem('pkce_verifier', pkce.verifier);
    localStorage.setItem('oauth_state', nonce);
    localStorage.setItem('post_login_dest', dest);

    // Encode nonce+verifier+dest into the state parameter so the flow
    // survives cross-context mobile redirects (iOS WKWebView → Safari)
    // where localStorage is unavailable on the callback page.
    var statePayload = window.AuthHelpers.encodeState(nonce, pkce.verifier, dest);

    statusEl.textContent = 'Cognito ログイン画面へ遷移します';
    window.location.replace(window.AuthHelpers.loginUrl(pkce.challenge, statePayload));
  } catch (err) {
    statusEl.textContent = 'サインインを開始できませんでした: ' + err.message;
  }
})();
