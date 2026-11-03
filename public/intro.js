(() => {
  const intro = document.getElementById('site-intro');
  if (!intro || document.documentElement.dataset.introSeen === 'true') return;

  const tagline = document.getElementById('site-intro-tagline');
  window.setTimeout(() => {
    if (!tagline) return;
    tagline.hidden = false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        tagline.classList.add('is-visible');
      });
    });
  }, 1000);

  window.setTimeout(() => {
    const introLogo = intro.querySelector('.site-intro-logo');
    const signInLogo = document.querySelector('.auth-welcome-logo');
    if (introLogo && signInLogo) {
      const sourceBox = introLogo.getBoundingClientRect();
      const sourceSvg = introLogo.querySelector('.auth-logo-svg')?.getBoundingClientRect();
      const targetBox = signInLogo.getBoundingClientRect();
      const sourceCenterX = sourceBox.left + sourceBox.width / 2;
      const sourceCenterY = sourceBox.top + sourceBox.height / 2;
      const targetCenterX = targetBox.left + targetBox.width / 2;
      const targetCenterY = targetBox.top + targetBox.height / 2;
      const scale = sourceSvg?.width ? targetBox.width / sourceSvg.width : targetBox.width / sourceBox.width;
      introLogo.style.setProperty('--intro-dx', `${targetCenterX - sourceCenterX}px`);
      introLogo.style.setProperty('--intro-dy', `${targetCenterY - sourceCenterY}px`);
      introLogo.style.setProperty('--intro-scale', String(scale));
    }
    intro.classList.add('is-exiting');
  }, 4550);

  window.setTimeout(() => {
    intro.classList.add('is-complete');
    intro.setAttribute('aria-hidden', 'true');
  }, 5000);
})();
