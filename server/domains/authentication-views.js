const ui = require('../ui');

function createViews({ APP_STYLESHEET_VERSION, appSettings, csrfInput, esc, https }) {
  function loginPage(csrfToken, hasError) {
    const settings = appSettings();
    return `<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in &middot; ${esc(settings.schoolName)}</title>
  <link rel="icon" href="${settings.faviconUrl}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/app.css?v=${APP_STYLESHEET_VERSION}" />
  </head>
  <body>
  <main class="login">
    <section class="login-panel">
      <div class="login-logo">
        <img src="${settings.logoUrl}" alt="${esc(settings.schoolName)}" />
        <div><h1>${esc(settings.schoolName)}</h1><p>Rooted Records for Growing Minds</p></div>
      </div>
      <form method="post" action="/login" class="form-grid">
        ${csrfInput(csrfToken)}
        ${ui.field({name:'username',label:'Username',autocomplete:'username',required:true,maxLength:80})}
        ${ui.field({name:'password',label:'Password',type:'password',autocomplete:'current-password',required:true,maxLength:120})}
        ${ui.button({label:'Sign in',type:'submit',variant:'primary'})}
      </form>
      ${hasError ? ui.notice({kind:'error',message:'That username or password did not match.'}) : '<p class="notice">Default administrator: admin / ChangeMeNow!</p>'}
    </section>
  </main>
  </body>
  </html>`;
  }

  return { loginPage };
}
module.exports = { createViews };
