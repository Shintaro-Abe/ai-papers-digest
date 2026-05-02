// Callback page logic — extracted from inline script for CSP compliance.
(async function () {
  'use strict';
  var statusEl = document.getElementById('status');

  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var returnedState = params.get('state');
  var error = params.get('error');

  if (error) {
    // error comes from Cognito; render as text only
    statusEl.textContent = 'サインインに失敗しました: ' + String(error);
    return;
  }

  if (!code) {
    statusEl.textContent = '認証コードが見つかりません。再度サインインしてください。';
    return;
  }

  // Decode state payload: contains nonce, PKCE verifier, and dest.
  var stateData = window.AuthHelpers.decodeState(returnedState);
  if (!stateData) {
    statusEl.textContent = 'セキュリティチェックに失敗しました（invalid state）。再度サインインしてください。';
    return;
  }

  // Three-tier recovery, from most to least secure:
  //   1. localStorage  — desktop / standard mobile browsers
  //   2. Path=/auth/ cookies — SFSafariViewController (shares cookies with Safari)
  //   3. state payload — WKWebView last resort (PKCE still protects token exchange)
  var savedNonce = localStorage.getItem('oauth_state');
  var cookieNonce = window.AuthHelpers.getCookie('oauth_state');
  var verifier, dest;

  function clearPkceStorage() {
    localStorage.removeItem('pkce_verifier');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('post_login_dest');
    window.AuthHelpers.deleteAuthCookie('pkce_verifier');
    window.AuthHelpers.deleteAuthCookie('oauth_state');
    window.AuthHelpers.deleteAuthCookie('post_login_dest');
  }

  if (savedNonce) {
    // Tier 1: localStorage available — validate nonce for CSRF protection.
    if (savedNonce !== stateData.n) {
      statusEl.textContent = 'セキュリティチェックに失敗しました（state mismatch）。再度サインインしてください。';
      clearPkceStorage();
      return;
    }
    verifier = localStorage.getItem('pkce_verifier') || stateData.v;
    dest = window.AuthHelpers.safeDest(localStorage.getItem('post_login_dest') || stateData.d);
  } else if (cookieNonce) {
    // Tier 2: Path=/auth/ cookie available (SFSafariViewController) — validate nonce.
    if (cookieNonce !== stateData.n) {
      statusEl.textContent = 'セキュリティチェックに失敗しました（state mismatch）。再度サインインしてください。';
      clearPkceStorage();
      return;
    }
    verifier = window.AuthHelpers.getCookie('pkce_verifier') || stateData.v;
    dest = window.AuthHelpers.safeDest(window.AuthHelpers.getCookie('post_login_dest') || stateData.d);
  } else {
    // Tier 3: WKWebView — no client storage across contexts; recover from state payload.
    // PKCE still protects token exchange even without nonce validation.
    verifier = stateData.v;
    dest = window.AuthHelpers.safeDest(stateData.d || '/');
  }

  if (!verifier) {
    statusEl.textContent = 'PKCE 情報が見つかりません。再度サインインしてください。';
    return;
  }

  try {
    var tokens = await window.AuthHelpers.exchangeCodeForTokens(code, verifier);
    window.AuthHelpers.storeTokens(tokens);

    // Clean up all three storage tiers
    clearPkceStorage();

    window.location.replace(dest);
  } catch (err) {
    statusEl.textContent = 'トークン交換に失敗しました: ' + err.message;
  }
})();
