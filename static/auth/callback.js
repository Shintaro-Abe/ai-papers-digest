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

  // Validate state to prevent CSRF
  var savedState = localStorage.getItem('oauth_state');
  if (!savedState || savedState !== returnedState) {
    statusEl.textContent = 'セキュリティチェックに失敗しました（state mismatch）。再度サインインしてください。';
    localStorage.removeItem('pkce_verifier');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('post_login_dest');
    return;
  }

  var verifier = localStorage.getItem('pkce_verifier');
  if (!verifier) {
    statusEl.textContent = 'PKCE 情報が見つかりません。再度サインインしてください。';
    return;
  }

  // Re-validate dest from localStorage to defend in depth.
  var dest = window.AuthHelpers.safeDest(localStorage.getItem('post_login_dest'));

  try {
    var tokens = await window.AuthHelpers.exchangeCodeForTokens(code, verifier);
    window.AuthHelpers.storeTokens(tokens);

    // Clean up
    localStorage.removeItem('pkce_verifier');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('post_login_dest');

    window.location.replace(dest);
  } catch (err) {
    statusEl.textContent = 'トークン交換に失敗しました: ' + err.message;
  }
})();
