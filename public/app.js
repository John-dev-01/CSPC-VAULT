(() => {
  const root = document.documentElement;
  document.addEventListener('error', event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && !image.dataset.placeholderFallback && image.src !== `${window.location.origin}/images/equipment-placeholder.png`) {
      image.dataset.placeholderFallback = 'true';
      image.src = '/images/equipment-placeholder.png';
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]'))) return;
    const search = document.querySelector('[data-equipment-search]');
    if (!search) return;
    event.preventDefault();
    search.focus();
    search.select();
  });
  let themePreference = ['system', 'light', 'dark'].includes(root.dataset.themePreference) ? root.dataset.themePreference : 'system';
  const themeStorageKey = root.dataset.themeStorageKey || 'cspc-theme:guest';
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  document.addEventListener('submit', event => {
    const form = event.target.closest('form[action="/logout"]');
    if (!form || form.dataset.csrfRefreshing === 'true') return;
    event.preventDefault();
    form.dataset.csrfRefreshing = 'true';
    fetch('/csrf-token', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('CSRF refresh failed')))
      .then(({ token }) => {
        let field = form.querySelector('input[name="_csrf"]');
        if (!field) {
          field = document.createElement('input');
          field.type = 'hidden';
          field.name = '_csrf';
          form.appendChild(field);
        }
        field.value = token;
        HTMLFormElement.prototype.submit.call(form);
      })
      .catch(() => {
        delete form.dataset.csrfRefreshing;
        form.submit();
      });
  });
  const departmentOptions = (() => {
    try { return JSON.parse(document.querySelector('.auth-shell')?.dataset.departments || '[]'); }
    catch { return []; }
  })();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const passwordFieldMarkup = (label, id, name, autocomplete) => `<div class="auth-password-group">
    <div class="auth-password-field">
      <input id="${id}" type="password" name="${name}" autocomplete="${autocomplete}" aria-label="${label}" placeholder="${label}" required${autocomplete === 'new-password' ? ' minlength="12" maxlength="72"' : ''}>
      <button class="password-toggle" type="button" data-password-toggle data-field-label="${label.toLowerCase()}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false" title="Show ${label.toLowerCase()}">
        <svg data-icon-show viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg data-icon-hide viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4-.8"/></svg>
      </button>
    </div>
  </div>`;
  const authWelcomeLogo = `<span class="auth-welcome-logo" aria-hidden="true"><svg class="auth-logo-svg" viewBox="0 0 48 48"><path class="orbit" d="M24 4a20 20 0 1 1-14.14 5.86"/><path class="orbit orbit-secondary" d="M24 10a14 14 0 1 1-9.9 4.1"/><path class="core" d="m24 13 11 6.35v12.3L24 38l-11-6.35v-12.3z"/><path class="core-lines" d="M24 13v12.5m11-6.15-11 6.15-11-6.15"/></svg></span>`;

  const fixedCursor = document.createElement('span');
  fixedCursor.id = 'custom-cursor';
  fixedCursor.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fixedCursor);
  root.dataset.customCursor = 'active';

  // Flip the cursor color depending on the surface under it.
  let lastX = -1, lastY = -1, checkQueued = false;
  const surfaceIsLight = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el) {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        const [r, g, b] = m.map(Number);
        const a = m.length > 3 ? m[3] : 1;
        if (a > 0.5) return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
      }
      el = el.parentElement;
    }
    return false;
  };
  const updateCursorContrast = () => {
    checkQueued = false;
    if (lastX < 0) return;
    const light = surfaceIsLight(lastX, lastY);
    fixedCursor.classList.toggle('on-light', light);
    fixedCursor.classList.toggle('on-dark', !light);
    if (light) {
      fixedCursor.style.background = '#111';
      fixedCursor.style.boxShadow = '0 0 5px 2px rgba(0,0,0,.88), 0 0 13px 6px rgba(0,0,0,.44), 0 0 25px 11px rgba(0,0,0,.2)';
    } else {
      fixedCursor.style.background = '#fff';
      fixedCursor.style.boxShadow = '0 0 5px 2px rgba(255,255,255,.95), 0 0 13px 6px rgba(255,255,255,.58), 0 0 25px 11px rgba(255,255,255,.28)';
    }
  };
  const queueContrastCheck = () => {
    if (checkQueued) return;
    checkQueued = true;
    requestAnimationFrame(updateCursorContrast);
  };

  const departmentMenuCloseTimers = new WeakMap();
  const closeDepartmentMenu = (wrapper, restoreFocus = false) => {
    if (!wrapper) return;
    const trigger = wrapper.querySelector('[data-department-trigger]');
    const menu = wrapper.querySelector('[data-department-options]');
    if (menu) {
      const timer = departmentMenuCloseTimers.get(menu);
      if (timer) window.clearTimeout(timer);
      menu.classList.remove('is-open');
      if (!menu.hidden) {
        const closeTimer = window.setTimeout(() => {
          if (!menu.classList.contains('is-open')) menu.hidden = true;
          departmentMenuCloseTimers.delete(menu);
        }, 180);
        departmentMenuCloseTimers.set(menu, closeTimer);
      }
    }
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
  };
  const openDepartmentMenu = wrapper => {
    document.querySelectorAll('[data-department-select]').forEach(other => {
      if (other !== wrapper) closeDepartmentMenu(other);
    });
    const menu = wrapper?.querySelector('[data-department-options]');
    const trigger = wrapper?.querySelector('[data-department-trigger]');
    if (!menu || !trigger) return;
    const timer = departmentMenuCloseTimers.get(menu);
    if (timer) window.clearTimeout(timer);
    departmentMenuCloseTimers.delete(menu);
    const rect = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom;
    const roomAbove = rect.top;
    menu.classList.toggle('opens-upward', roomBelow < Math.min(250, window.innerHeight * 0.38) && roomAbove > roomBelow);
    menu.hidden = false;
    menu.classList.remove('is-open');
    void menu.offsetWidth;
    trigger.setAttribute('aria-expanded', 'true');
    const selected = menu.querySelector('[aria-selected="true"]') || menu.querySelector('[data-department-option]');
    window.requestAnimationFrame(() => {
      if (menu.hidden || trigger.getAttribute('aria-expanded') !== 'true') return;
      menu.classList.add('is-open');
      selected?.focus();
    });
  };

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-department-trigger]');
    if (trigger) {
      const wrapper = trigger.closest('[data-department-select]');
      const menu = wrapper?.querySelector('[data-department-options]');
      if (!menu?.classList.contains('is-open')) openDepartmentMenu(wrapper);
      else closeDepartmentMenu(wrapper);
      return;
    }

    const option = event.target.closest('[data-department-option]');
    if (option) {
      const wrapper = option.closest('[data-department-select]');
      const value = wrapper?.querySelector('[data-department-value]');
      const label = wrapper?.querySelector('[data-department-label]');
      if (value && label) {
        value.value = option.dataset.value || '';
        label.textContent = option.textContent.trim();
        wrapper.classList.toggle('has-value', Boolean(value.value) || wrapper.classList.contains('filter-select'));
        wrapper.classList.remove('is-invalid');
        wrapper.querySelector('[data-department-error]')?.setAttribute('hidden', '');
        wrapper.classList.remove('is-selecting');
        void wrapper.offsetWidth;
        wrapper.classList.add('is-selecting');
        window.setTimeout(() => wrapper.classList.remove('is-selecting'), 240);
        wrapper.querySelectorAll('[data-department-option]').forEach(item => {
          const selected = item === option;
          item.setAttribute('aria-selected', String(selected));
          item.classList.toggle('is-selected', selected);
        });
      }
      closeDepartmentMenu(wrapper, true);
      return;
    }

    if (!event.target.closest('[data-department-select]')) {
      document.querySelectorAll('[data-department-select]').forEach(wrapper => closeDepartmentMenu(wrapper));
    }
  });

  document.addEventListener('keydown', event => {
    const trigger = event.target.closest('[data-department-trigger]');
    if (trigger && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
      const wrapper = trigger.closest('[data-department-select]');
      const menu = wrapper?.querySelector('[data-department-options]');
      if (menu && !menu.classList.contains('is-open')) {
        event.preventDefault();
        openDepartmentMenu(wrapper);
      }
      return;
    }

    const option = event.target.closest('[data-department-option]');
    if (!option) return;
    const wrapper = option.closest('[data-department-select]');
    const options = [...(wrapper?.querySelectorAll('[data-department-option]') || [])];
    const index = options.indexOf(option);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDepartmentMenu(wrapper, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    }
  });

  document.addEventListener('submit', event => {
    const wrapper = event.target.querySelector('[data-department-select][data-required-selection]');
    if (!wrapper) return;
    const value = wrapper.querySelector('[data-department-value]');
    if (value?.value) return;
    event.preventDefault();
    wrapper.classList.add('is-invalid');
    wrapper.querySelector('[data-department-error]')?.removeAttribute('hidden');
    wrapper.querySelector('[data-department-trigger]')?.focus();
  }, true);

  const moveFixedCursor = event => {
    if (event.pointerType === 'touch') return;
    lastX = event.clientX;
    lastY = event.clientY;
    fixedCursor.style.left = `${lastX}px`;
    fixedCursor.style.top = `${lastY}px`;
    fixedCursor.classList.add('is-visible');
    queueContrastCheck();
  };
  document.addEventListener('transitionend', queueContrastCheck, true);
  document.addEventListener('animationend', queueContrastCheck, true);
  window.addEventListener('scroll', queueContrastCheck, { passive: true, capture: true });
  document.addEventListener('pointermove', moveFixedCursor, { passive: true });
  document.addEventListener('pointerleave', () => fixedCursor.classList.remove('is-visible'));
  window.addEventListener('blur', () => fixedCursor.classList.remove('is-visible'));

  const placeThemeIndicators = (instant = false) => {
    document.querySelectorAll('.theme-switcher').forEach(switcher => {
      const activeButton = switcher.querySelector(`[data-theme-choice="${themePreference}"]`);
      if (!activeButton) return;
      let indicator = switcher.querySelector('.theme-switcher-indicator');
      if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'theme-switcher-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        switcher.prepend(indicator);
      }
      const containerRect = switcher.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      if (!containerRect.width || !buttonRect.width) return;
      const firstPlacement = indicator.dataset.positioned !== 'true';
      if (instant || firstPlacement) indicator.style.transition = 'none';
      indicator.style.width = `${buttonRect.width}px`;
      indicator.style.height = `${buttonRect.height}px`;
      indicator.style.transform = `translate3d(${buttonRect.left - containerRect.left - switcher.clientLeft}px, ${buttonRect.top - containerRect.top - switcher.clientTop}px, 0)`;
      indicator.dataset.positioned = 'true';
      if (instant || firstPlacement) {
        indicator.getBoundingClientRect();
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => indicator.style.removeProperty('transition')));
      }
    });
  };
  const updateButtons = () => {
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const nextTheme = theme === 'dark' ? 'light' : 'dark';
      const label = `Switch to ${nextTheme} mode`;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    });
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const selected = button.dataset.themeChoice === themePreference;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-active', selected);
    });
    placeThemeIndicators();
  };
  let themeTransitionTimer;
  const applyThemePreference = (preference, persist = false, animate = false, sourceEvent = null) => {
    const nextPreference = ['system', 'light', 'dark'].includes(preference) ? preference : 'system';
    const nextTheme = nextPreference === 'system'
      ? (systemThemeQuery.matches ? 'dark' : 'light')
      : nextPreference;
    const appearanceChanged = nextTheme !== theme;
    const updateTheme = () => {
      themePreference = nextPreference;
      theme = nextTheme;
      root.dataset.themePreference = themePreference;
      root.dataset.theme = theme;
      if (persist) {
        try { localStorage.setItem(themeStorageKey, themePreference); } catch (error) { /* Theme remains active for this page. */ }
      }
      updateButtons();
    };
    if (!animate || !appearanceChanged) {
      updateTheme();
      return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion && sourceEvent && typeof document.startViewTransition === 'function') {
      window.clearTimeout(themeTransitionTimer);
      root.classList.remove('theme-anim');
      const target = sourceEvent.currentTarget?.getBoundingClientRect();
      const hasPointerOrigin = sourceEvent.detail !== 0 && Number.isFinite(sourceEvent.clientX) && Number.isFinite(sourceEvent.clientY);
      const x = hasPointerOrigin ? sourceEvent.clientX : target ? target.left + target.width / 2 : window.innerWidth / 2;
      const y = hasPointerOrigin ? sourceEvent.clientY : target ? target.top + target.height / 2 : window.innerHeight / 2;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      try {
        const transition = document.startViewTransition(updateTheme);
        transition.ready.then(() => {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 540, easing: 'cubic-bezier(.32,.08,.24,1)', pseudoElement: '::view-transition-new(root)' }
          );
        }).catch(() => { /* Keep the selected theme if the visual transition is interrupted. */ });
        return;
      } catch (error) {
        /* Fall back to the coordinated color transition if View Transitions are unavailable. */
      }
    }

    root.classList.add('theme-anim');
    updateTheme();
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => root.classList.remove('theme-anim'), 520);
  };
  applyThemePreference(themePreference);
  window.addEventListener('resize', () => placeThemeIndicators(true), { passive: true });
  if ('ResizeObserver' in window) {
    const themeSwitcherResizeObserver = new ResizeObserver(() => placeThemeIndicators(true));
    document.querySelectorAll('.theme-switcher').forEach(switcher => themeSwitcherResizeObserver.observe(switcher));
  }
  const themeSwitcherToggle = document.querySelector('[data-theme-switcher-toggle]');
  const sidebarThemeSwitcher = document.querySelector('#sidebar-theme-selector');
  const placeCollapsedThemeSwitcher = () => {
    if (!themeSwitcherToggle || !sidebarThemeSwitcher || !themeSwitcherToggle.closest('.sidebar-bottom')?.classList.contains('is-theme-open')) return;
    const anchor = themeSwitcherToggle.getBoundingClientRect();
    const width = 160;
    const height = sidebarThemeSwitcher.getBoundingClientRect().height || 48;
    const left = Math.max(8, Math.min(anchor.right + 8, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8));
    sidebarThemeSwitcher.style.left = `${left}px`;
    sidebarThemeSwitcher.style.top = `${top}px`;
  };
  const closeCollapsedThemeSwitcher = () => {
    const bottom = themeSwitcherToggle?.closest('.sidebar-bottom');
    bottom?.classList.remove('is-theme-open');
    themeSwitcherToggle?.setAttribute('aria-expanded', 'false');
  };
  if (themeSwitcherToggle && sidebarThemeSwitcher) {
    themeSwitcherToggle.addEventListener('click', () => {
      const bottom = themeSwitcherToggle.closest('.sidebar-bottom');
      const open = !bottom.classList.contains('is-theme-open');
      bottom.classList.toggle('is-theme-open', open);
      themeSwitcherToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        window.requestAnimationFrame(() => {
          placeCollapsedThemeSwitcher();
          placeThemeIndicators(true);
        });
      }
    });
    document.addEventListener('click', event => {
      if (!themeSwitcherToggle.contains(event.target) && !sidebarThemeSwitcher.contains(event.target)) closeCollapsedThemeSwitcher();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && themeSwitcherToggle.getAttribute('aria-expanded') === 'true') {
        closeCollapsedThemeSwitcher();
        themeSwitcherToggle.focus();
      }
    });
    window.addEventListener('resize', placeCollapsedThemeSwitcher, { passive: true });
  }
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', event => applyThemePreference(button.dataset.themeChoice, true, true, event));
  });
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', () => applyThemePreference(theme === 'dark' ? 'light' : 'dark', true, true));
  });
  const followSystemTheme = () => {
    if (themePreference === 'system') applyThemePreference('system', false, true);
  };
  if (typeof systemThemeQuery.addEventListener === 'function') systemThemeQuery.addEventListener('change', followSystemTheme);
  else if (typeof systemThemeQuery.addListener === 'function') systemThemeQuery.addListener(followSystemTheme);
  window.addEventListener('storage', event => {
    if (event.key === themeStorageKey) applyThemePreference(event.newValue || 'system', false, true);
  });
  const sidebarButtons = document.querySelectorAll('[data-sidebar-toggle]');
  const updateSidebarButtons = () => {
    const hidden = root.dataset.sidebar === 'hidden';
    sidebarButtons.forEach(button => {
      const label = hidden ? 'Show sidebar' : 'Hide sidebar';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-expanded', String(!hidden));
    });
  };
  updateSidebarButtons();
  const sidebarNav = document.querySelector('.sidebar-portal > .sidebar nav');
  let sidebarIndicator;
  const placeSidebarIndicator = (target, instant = false) => {
    if (!sidebarNav || !target || !sidebarIndicator) return;
    const navRect = sidebarNav.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!targetRect.width || !targetRect.height) return;
    if (instant) sidebarIndicator.style.transition = 'none';
    sidebarIndicator.style.width = `${targetRect.width}px`;
    sidebarIndicator.style.height = `${targetRect.height}px`;
    sidebarIndicator.style.transform = `translate3d(${targetRect.left - navRect.left}px, ${targetRect.top - navRect.top + sidebarNav.scrollTop}px, 0)`;
    if (instant) {
      sidebarIndicator.getBoundingClientRect();
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (sidebarIndicator) sidebarIndicator.style.removeProperty('transition');
      }));
    }
  };
  if (sidebarNav) {
    sidebarIndicator = document.createElement('span');
    sidebarIndicator.className = 'sidebar-nav-active-indicator';
    sidebarIndicator.setAttribute('aria-hidden', 'true');
    sidebarNav.dataset.slidingIndicator = 'true';
    sidebarNav.prepend(sidebarIndicator);
    placeSidebarIndicator(sidebarNav.querySelector('a.active'), true);
    window.addEventListener('resize', () => placeSidebarIndicator(sidebarNav.querySelector('a.active'), true), { passive: true });
    if ('ResizeObserver' in window) {
      const sidebarResizeObserver = new ResizeObserver(() => placeSidebarIndicator(sidebarNav.querySelector('a.active'), true));
      sidebarResizeObserver.observe(sidebarNav);
    }
    sidebarNav.addEventListener('pointerover', event => {
      const link = event.target.closest('a.active');
      if (link) placeSidebarIndicator(link);
    });
  }
  let sidebarNavigationPending = false;
  document.querySelector('.sidebar nav')?.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    if (sidebarNavigationPending) { event.preventDefault(); return; }
    const nav = link.closest('nav');
    const links = [...(nav?.querySelectorAll('a[href]') || [])];
    const targetIndex = links.indexOf(link);
    const activeIndex = Math.max(0, links.findIndex(item => item.classList.contains('active')));
    const direction = targetIndex >= activeIndex ? 'up' : 'down';
    event.preventDefault();
    sidebarNavigationPending = true;
    links.forEach(item => {
      const selected = item === link;
      item.classList.toggle('active', selected);
      if (selected) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    placeSidebarIndicator(link);
    root.dataset.navLeaving = direction;
    try { sessionStorage.setItem('cspc-sidebar-nav-transition', direction); } catch (error) { /* Continue with normal navigation if storage is unavailable. */ }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => { window.location.assign(destination.href); }, reducedMotion ? 0 : 370);
  });
  sidebarButtons.forEach(button => button.addEventListener('click', () => {
    if (root.dataset.sidebar === 'hidden') delete root.dataset.sidebar;
    else root.dataset.sidebar = 'hidden';
    try { localStorage.setItem('cspc-sidebar', root.dataset.sidebar || 'visible'); } catch (error) { /* Keep the panel toggle available without storage. */ }
    updateSidebarButtons();
    window.requestAnimationFrame(() => placeSidebarIndicator(sidebarNav?.querySelector('a.active'), true));
  }));
  // Resizable control panel: pointer drag plus keyboard arrows; the collapsed rail remains unchanged.
  const sidebar = document.querySelector('.app.sidebar-portal > .sidebar');
  if (sidebar && window.matchMedia('(min-width: 701px)').matches) {
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sidebar-resize-handle';
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-label', 'Resize control panel');
    resizeHandle.setAttribute('tabindex', '0');
    resizeHandle.setAttribute('aria-controls', 'control-sidebar');
    sidebar.id = sidebar.id || 'control-sidebar';
    sidebar.appendChild(resizeHandle);
    const minWidth = 180, maxWidth = Math.min(420, Math.floor(window.innerWidth * 0.42));
    let savedWidth = 224;
    try { savedWidth = Number(localStorage.getItem('cspc-sidebar-width')) || savedWidth; } catch (error) { /* Use default width. */ }
    const applyWidth = width => {
      const value = Math.max(minWidth, Math.min(maxWidth, width));
      root.style.setProperty('--sidebar-width', `${value}px`);
      resizeHandle.setAttribute('aria-valuemin', String(minWidth));
      resizeHandle.setAttribute('aria-valuemax', String(maxWidth));
      resizeHandle.setAttribute('aria-valuenow', String(value));
      try { localStorage.setItem('cspc-sidebar-width', String(value)); } catch (error) { /* Resizing still works without storage. */ }
    };
    // Apply persisted sizing instantly on navigation; only user-triggered collapse animates.
    root.classList.add('sidebar-width-initializing');
    applyWidth(savedWidth);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      root.classList.remove('sidebar-width-initializing');
    }));
    let dragStartX = 0, dragStartWidth = 224;
    resizeHandle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') return;
      dragStartX = event.clientX;
      dragStartWidth = sidebar.getBoundingClientRect().width;
      resizeHandle.setPointerCapture(event.pointerId);
      document.documentElement.classList.add('sidebar-resizing');
      event.preventDefault();
    });
    resizeHandle.addEventListener('pointermove', event => {
      if (!resizeHandle.hasPointerCapture(event.pointerId)) return;
      applyWidth(dragStartWidth + event.clientX - dragStartX);
    });
    const endResize = () => document.documentElement.classList.remove('sidebar-resizing');
    resizeHandle.addEventListener('pointerup', endResize);
    resizeHandle.addEventListener('pointercancel', endResize);
    resizeHandle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 32 : 12;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const current = sidebar.getBoundingClientRect().width;
        applyWidth(current + (event.key === 'ArrowRight' ? step : -step));
      } else if (event.key === 'Home') { event.preventDefault(); applyWidth(minWidth); }
      else if (event.key === 'End') { event.preventDefault(); applyWidth(maxWidth); }
    });
  }

  const accountToggle = document.querySelector('[data-account-toggle]');
  const accountMenu = document.querySelector('[data-account-menu]');
  let accountMenuCloseTimer;
  const positionAccountMenu = () => {
    if (!accountToggle || !accountMenu || accountMenu.hidden) return;
    const anchor = accountToggle.getBoundingClientRect();
    const margin = 12;
    const gap = 9;
    const width = Math.max(0, Math.min(260, window.innerWidth - margin * 2));
    accountMenu.style.width = `${width}px`;
    accountMenu.style.maxHeight = `calc(100vh - ${margin * 2}px)`;
    const panel = accountMenu.getBoundingClientRect();
    const above = anchor.top - margin;
    const below = window.innerHeight - margin - anchor.bottom;
    const placeAbove = above >= panel.height + gap || above >= below;
    accountMenu.classList.toggle('opens-upward', placeAbove);
    const top = placeAbove
      ? Math.max(margin, anchor.top - panel.height - gap)
      : Math.min(window.innerHeight - margin - panel.height, anchor.bottom + gap);
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
    accountMenu.style.top = `${top}px`;
    accountMenu.style.left = `${left}px`;
  };
  if (accountToggle && accountMenu) {
    accountMenu.classList.add('account-popover-portal');
    document.body.appendChild(accountMenu);
  }
  const closeAccountMenu = () => {
    if (!accountToggle || !accountMenu) return;
    if (accountMenuCloseTimer) window.clearTimeout(accountMenuCloseTimer);
    if (accountMenu.hidden) return;
    accountMenu.classList.remove('is-open');
    accountToggle.setAttribute('aria-expanded', 'false');
    accountToggle.setAttribute('aria-label', 'Open account menu');
    accountToggle.setAttribute('title', 'Open account menu');
    accountMenuCloseTimer = window.setTimeout(() => {
      if (!accountMenu.classList.contains('is-open')) accountMenu.hidden = true;
      accountMenuCloseTimer = undefined;
    }, 190);
  };
  const openAccountMenu = () => {
    if (!accountToggle || !accountMenu) return;
    if (accountMenuCloseTimer) window.clearTimeout(accountMenuCloseTimer);
    accountMenuCloseTimer = undefined;
    accountMenu.hidden = false;
    accountMenu.classList.remove('is-open');
    positionAccountMenu();
    accountToggle.setAttribute('aria-expanded', 'true');
    accountToggle.setAttribute('aria-label', 'Close account menu');
    accountToggle.setAttribute('title', 'Close account menu');
    void accountMenu.offsetWidth;
    window.requestAnimationFrame(() => {
      if (!accountMenu.hidden && accountToggle.getAttribute('aria-expanded') === 'true') accountMenu.classList.add('is-open');
    });
  };
  if (accountToggle && accountMenu) {
    accountToggle.addEventListener('click', () => {
      if (accountMenu.classList.contains('is-open')) closeAccountMenu();
      else openAccountMenu();
    });
    document.addEventListener('click', event => {
      if (!accountToggle.contains(event.target) && !accountMenu.contains(event.target)) closeAccountMenu();
    });
    accountMenu.addEventListener('click', event => {
      if (event.target.closest('[data-open-password-dialog], form[action="/logout"] button')) closeAccountMenu();
    });
    window.addEventListener('resize', positionAccountMenu, { passive: true });
    window.addEventListener('scroll', positionAccountMenu, { passive: true, capture: true });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && accountMenu.classList.contains('is-open')) {
        closeAccountMenu();
        accountToggle.focus();
      }
    });
  }

  const departmentAdminDialog = document.querySelector('[data-department-admin-dialog]');
  const openDepartmentAdminButton = document.querySelector('[data-open-department-admin-dialog]');
  const closeDepartmentAdminButtons = departmentAdminDialog?.querySelectorAll('[data-close-department-admin-dialog]');
  if (departmentAdminDialog && openDepartmentAdminButton) {
    const closeDepartmentAdminDialog = () => { if (departmentAdminDialog.open) departmentAdminDialog.close(); };
    openDepartmentAdminButton.addEventListener('click', () => {
      if (!departmentAdminDialog.open) departmentAdminDialog.showModal();
      departmentAdminDialog.appendChild(fixedCursor);
      departmentAdminDialog.querySelector('input[name="name"]')?.focus();
    });
    closeDepartmentAdminButtons?.forEach(button => button.addEventListener('click', closeDepartmentAdminDialog));
    departmentAdminDialog.addEventListener('click', event => {
      if (event.target === departmentAdminDialog) closeDepartmentAdminDialog();
    });
    departmentAdminDialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeDepartmentAdminDialog();
    });
    departmentAdminDialog.addEventListener('close', () => {
      if (fixedCursor && fixedCursor.parentElement === departmentAdminDialog) document.body.append(fixedCursor);
    });
  }

  const departmentAdminForm = departmentAdminDialog?.querySelector('form[action="/admin/department-admins"]');
  const departmentAdminPassword = departmentAdminForm?.querySelector('input[name="password"]');
  const departmentAdminPasswordConfirm = departmentAdminForm?.querySelector('input[name="password_confirm"]');
  const validateDepartmentAdminPassword = () => {
    if (!departmentAdminPasswordConfirm) return;
    departmentAdminPasswordConfirm.setCustomValidity(
      departmentAdminPasswordConfirm.value && departmentAdminPasswordConfirm.value !== departmentAdminPassword?.value
        ? 'Passwords do not match.' : ''
    );
  };
  departmentAdminPassword?.addEventListener('input', validateDepartmentAdminPassword);
  departmentAdminPasswordConfirm?.addEventListener('input', validateDepartmentAdminPassword);

  const passwordDialog = document.querySelector('[data-password-dialog]');
  const openPasswordDialogButton = document.querySelector('[data-open-password-dialog]');
  const closePasswordDialogButtons = passwordDialog?.querySelectorAll('[data-close-password-dialog]');
  if (passwordDialog && openPasswordDialogButton) {
    const closePasswordDialog = () => { if (passwordDialog.open) passwordDialog.close(); };
    openPasswordDialogButton.addEventListener('click', () => {
      closeAccountMenu();
      if (!passwordDialog.open) passwordDialog.showModal();
      passwordDialog.appendChild(fixedCursor);
      passwordDialog.querySelector('input[name="current_password"]')?.focus();
    });
    closePasswordDialogButtons?.forEach(button => button.addEventListener('click', closePasswordDialog));
    passwordDialog.addEventListener('click', event => {
      if (event.target === passwordDialog) closePasswordDialog();
    });
    passwordDialog.addEventListener('close', () => {
      document.body.appendChild(fixedCursor);
      queueContrastCheck();
      accountToggle?.focus();
    });
    const form = passwordDialog.querySelector('form');
    const newPassword = form?.querySelector('input[name="new_password"]');
    const confirmPassword = form?.querySelector('input[name="confirm_password"]');
    const validatePasswordMatch = () => {
      if (!confirmPassword) return;
      confirmPassword.setCustomValidity(confirmPassword.value && confirmPassword.value !== newPassword?.value ? 'New passwords do not match.' : '');
    };
    newPassword?.addEventListener('input', validatePasswordMatch);
    confirmPassword?.addEventListener('input', validatePasswordMatch);
    form?.addEventListener('submit', validatePasswordMatch);
  }

  const addItemDialog = document.querySelector('[data-add-item-dialog]');
  const openAddItemButton = document.querySelector('[data-open-add-item]');
  const closeAddItemButton = addItemDialog?.querySelector('[data-close-add-item]');
  if (addItemDialog && openAddItemButton) {
    let addItemCloseTimer;
    const closeAddItemDialog = () => {
      if (!addItemDialog.open || addItemDialog.classList.contains('is-closing')) return;
      addItemDialog.classList.add('is-closing');
      const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
      addItemCloseTimer = window.setTimeout(() => {
        addItemCloseTimer = undefined;
        addItemDialog.classList.remove('is-closing');
        if (addItemDialog.open) addItemDialog.close();
      }, delay);
    };
    openAddItemButton.addEventListener('click', () => {
      if (addItemCloseTimer) window.clearTimeout(addItemCloseTimer);
      addItemCloseTimer = undefined;
      addItemDialog.classList.remove('is-closing');
      if (addItemDialog.open) return;
      addItemDialog.showModal();
      addItemDialog.appendChild(fixedCursor);
      addItemDialog.querySelector('input[name="name"]')?.focus();
    });
    closeAddItemButton?.addEventListener('click', closeAddItemDialog);
    addItemDialog.addEventListener('click', event => {
      if (event.target === addItemDialog) closeAddItemDialog();
    });
    addItemDialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeAddItemDialog();
    });
    addItemDialog.addEventListener('close', () => {
      if (addItemCloseTimer) window.clearTimeout(addItemCloseTimer);
      addItemCloseTimer = undefined;
      addItemDialog.classList.remove('is-closing');
      document.body.appendChild(fixedCursor);
      openAddItemButton.focus();
    });
  }

  // The auth canvas shows a pre-rendered campus halftone and animates only the
  // small group of dots near the pointer, keeping the dense artwork responsive.
  document.querySelectorAll('[data-dot-canvas]').forEach(canvas => {
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: -9999, y: -9999, active: false };
    const points = [];
    const map = window.CSPC_MONUMENT_HALFTONE;
    if (map && typeof map.data === 'string') {
      try {
        const bytes = Uint8Array.from(atob(map.data), value => value.charCodeAt(0));
        const cols = Number(map.cols), rows = Number(map.rows), spacing = Number(map.spacing);
        const sourceWidth = Number(map.width), sourceHeight = Number(map.height);
        if (bytes.length !== cols * rows || !spacing || !sourceWidth || !sourceHeight) return;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const darkness = bytes[row * cols + col] / 255;
            if (!darkness) continue;
            const alpha = .34 + .64 * darkness ** .68;
            points.push({
              nx: (col * spacing + spacing * .5) / sourceWidth,
              ny: (row * spacing + spacing * .5) / sourceHeight,
              size: .48 + .76 * darkness ** .55,
              bucket: Math.max(1, Math.min(10, Math.round(alpha * 10))),
            });
          }
        }
      } catch (error) {
        console.warn('Campus halftone data could not be decoded.', error);
      }
    }
    if (!points.length && Array.isArray(window.CSPC_MONUMENT_PARTICLES)) {
      window.CSPC_MONUMENT_PARTICLES.forEach(([nx, ny, size, alpha]) => points.push({
        nx, ny, size, bucket: Math.max(1, Math.min(10, Math.round(alpha * 10))),
      }));
    }
    if (!points.length) return;
    const layers = Array.from({ length: 10 }, () => []);
    const particles = points.map(point => {
      const particle = { ...point, x: 0, y: 0, baseX: 0, baseY: 0, vx: 0, vy: 0 };
      layers[particle.bucket - 1].push(particle);
      return particle;
    });
    const baseCanvas = document.createElement('canvas');
    const baseContext = baseCanvas.getContext('2d', { alpha: false });
    if (!baseContext) return;
    // Cover the complete visible CSPC artwork while keeping the spatial lookup
    // bounded so broad pointer movement stays responsive instead of lagging.
    const cellSize = 56;
    // Never truncate candidates by lookup order; that creates visible columns.
    // Every dot inside the distance field is allowed to react individually.
    const maxActiveParticles = particles.length;
    const interactionRadiusRatio = .18;
    const activeParticles = new Set();
    let spatialCells = new Map();
    let width = 0, height = 0, dpr = 1, artWidth = 0, artHeight = 0, artLeft = 0, artTop = 0, scale = 1, frame = 0, pointerIdleTimer, pointerFrame = 0;
    let canvasRect = { left: 0, top: 0 };
    let pendingPointerX = -9999, pendingPointerY = -9999;
    const scheduleDraw = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    const draw = () => {
      frame = 0;
      context.globalAlpha = 1;
      context.drawImage(baseCanvas, 0, 0, width, height);
      if (!activeParticles.size) return;
      const radius = Math.max(84, Math.min(artWidth, artHeight) * interactionRadiusRatio);
      const moved = [];
      for (const particle of activeParticles) {
        if (pointer.active && !reducedMotion) {
          const dx = particle.x - pointer.x;
          const dy = particle.y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < radius && distance > .01) {
            const push = (1 - distance / radius) ** 2 * 3.2;
            particle.vx += (dx / distance) * push;
            particle.vy += (dy / distance) * push;
          }
        }
        particle.vx += (particle.baseX - particle.x) * .035;
        particle.vy += (particle.baseY - particle.y) * .035;
        particle.vx *= .78;
        particle.vy *= .78;
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (Math.abs(particle.x - particle.baseX) > .12 || Math.abs(particle.y - particle.baseY) > .12 || Math.abs(particle.vx) > .015 || Math.abs(particle.vy) > .015) {
          moved.push(particle);
        } else {
          particle.x = particle.baseX;
          particle.y = particle.baseY;
          particle.vx = 0;
          particle.vy = 0;
          activeParticles.delete(particle);
        }
      }
      if (!moved.length) return;
      context.globalAlpha = 1;
      context.fillStyle = '#FFFFFF';
      context.beginPath();
      for (const particle of moved) {
        const clearSize = particle.radius + .28;
        context.moveTo(particle.baseX + clearSize, particle.baseY);
        context.arc(particle.baseX, particle.baseY, clearSize, 0, Math.PI * 2);
      }
      context.fill();
      context.beginPath();
      for (const particle of moved) {
        context.moveTo(particle.x + particle.radius, particle.y);
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      }
      context.fillStyle = '#101010';
      context.globalAlpha = .9;
      context.fill();
      context.globalAlpha = 1;
      if (activeParticles.size) scheduleDraw();
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvasRect = { left: rect.left, top: rect.top };
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const artRatio = 1672 / 941;
      artWidth = Math.max(width, height * artRatio);
      artHeight = artWidth / artRatio;
      artLeft = artWidth > width + 1 ? width * .5 - artWidth * .56 : (width - artWidth) / 2;
      artTop = (height - artHeight) / 2;
      scale = Math.min(artWidth, artHeight) / 660;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      baseCanvas.width = canvas.width;
      baseCanvas.height = canvas.height;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      baseContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      baseContext.globalAlpha = 1;
      baseContext.fillStyle = '#FFFFFF';
      baseContext.fillRect(0, 0, width, height);
      layers.forEach((layer, index) => {
        if (!layer.length) return;
        baseContext.beginPath();
        for (const particle of layer) {
          particle.baseX = artLeft + particle.nx * artWidth;
          particle.baseY = artTop + particle.ny * artHeight;
          particle.x = particle.baseX;
          particle.y = particle.baseY;
          particle.vx = 0;
          particle.vy = 0;
          particle.radius = Math.max(.22, particle.size * scale * .70);
          baseContext.moveTo(particle.baseX + particle.radius, particle.baseY);
          baseContext.arc(particle.baseX, particle.baseY, particle.radius, 0, Math.PI * 2);
        }
        baseContext.fillStyle = '#101010';
        baseContext.globalAlpha = .96 * ((index + 1) / 10);
        baseContext.fill();
      });
      baseContext.globalAlpha = 1;
      context.globalAlpha = 1;
      context.drawImage(baseCanvas, 0, 0, width, height);
      activeParticles.clear();
      spatialCells = new Map();
      particles.forEach(particle => {
        const cellX = Math.floor(particle.baseX / cellSize);
        const cellY = Math.floor(particle.baseY / cellSize);
        const key = `${cellX}:${cellY}`;
        if (!spatialCells.has(key)) spatialCells.set(key, []);
        spatialCells.get(key).push(particle);
      });
    };
    const addNearbyParticles = () => {
      const radius = Math.max(84, Math.min(artWidth, artHeight) * interactionRadiusRatio);
      const radiusSquared = radius * radius;
      const candidates = [];
      const minX = Math.floor((pointer.x - radius) / cellSize);
      const maxX = Math.floor((pointer.x + radius) / cellSize);
      const minY = Math.floor((pointer.y - radius) / cellSize);
      const maxY = Math.floor((pointer.y + radius) / cellSize);
      for (let cellY = minY; cellY <= maxY; cellY++) {
        for (let cellX = minX; cellX <= maxX; cellX++) {
          const cell = spatialCells.get(`${cellX}:${cellY}`);
          if (!cell) continue;
          for (const particle of cell) {
            const dx = particle.baseX - pointer.x;
            const dy = particle.baseY - pointer.y;
            if (dx * dx + dy * dy < radiusSquared) candidates.push(particle);
          }
        }
      }
      const limit = Math.min(maxActiveParticles, candidates.length);
      if (limit) {
        // Sample across the whole candidate list instead of taking the first
        // cells, which avoids columns without the cost of sorting every frame.
        const offset = candidates.length > 1
          ? (Math.abs(Math.floor(pointer.x * 3 + pointer.y * 5)) % candidates.length)
          : 0;
        for (let index = 0; index < limit; index++) {
          const sample = Math.floor((index * candidates.length) / limit + offset) % candidates.length;
          activeParticles.add(candidates[sample]);
        }
      }
      // Keep fast pointer sweeps from growing the animated set without bound.
      const trimRadius = radius * 1.08;
      const trimRadiusSquared = trimRadius * trimRadius;
      activeParticles.forEach(particle => {
        const dx = particle.baseX - pointer.x;
        const dy = particle.baseY - pointer.y;
        if (dx * dx + dy * dy > trimRadiusSquared) {
          activeParticles.delete(particle);
        }
      });
    };
    const processPointer = () => {
      pointerFrame = 0;
      if (pointer.x < -1000) {
        pointer.x = pendingPointerX;
        pointer.y = pendingPointerY;
      } else {
        pointer.x += (pendingPointerX - pointer.x) * .18;
        pointer.y += (pendingPointerY - pointer.y) * .18;
      }
      addNearbyParticles();
      scheduleDraw();
      if (pointer.active && (Math.abs(pendingPointerX - pointer.x) > .5 || Math.abs(pendingPointerY - pointer.y) > .5)) {
        pointerFrame = window.requestAnimationFrame(processPointer);
      }
    };
    const movePointer = event => {
      if (reducedMotion) return;
      pendingPointerX = Number.isFinite(event.offsetX) ? event.offsetX : event.clientX - canvasRect.left;
      pendingPointerY = Number.isFinite(event.offsetY) ? event.offsetY : event.clientY - canvasRect.top;
      pointer.active = true;
      if (!pointerFrame) pointerFrame = window.requestAnimationFrame(processPointer);
      window.clearTimeout(pointerIdleTimer);
      pointerIdleTimer = window.setTimeout(() => {
        pointer.active = false;
        scheduleDraw();
      }, 120);
      scheduleDraw();
    };
    canvas.addEventListener('pointermove', movePointer, { passive: true });
    canvas.addEventListener('pointerenter', movePointer, { passive: true });
    canvas.addEventListener('pointerleave', () => {
      window.clearTimeout(pointerIdleTimer);
      pointer.active = false;
      pendingPointerX = -9999;
      pendingPointerY = -9999;
      scheduleDraw();
    }, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    resize();
    window.addEventListener('pagehide', () => {
      window.clearTimeout(pointerIdleTimer);
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
      if (frame) window.cancelAnimationFrame(frame);
    }, { once: true });
  });

  // Let the split auth panels finish their side-switch animation before routing.
  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-password-toggle]');
    if (!toggle) return;
    const input = toggle.closest('.auth-password-field')?.querySelector('input');
    if (!input) return;
    const visible = input.type === 'password';
    const label = toggle.dataset.fieldLabel || 'password';
    input.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${label}`);
    toggle.setAttribute('title', `${visible ? 'Hide' : 'Show'} ${label}`);
    input.focus({ preventScroll: true });
  });

  const rejectionDialog = document.querySelector('[data-rejection-dialog]');
  const rejectionForm = rejectionDialog?.querySelector('[data-rejection-form]');
  const rejectionReason = rejectionForm?.querySelector('[name="reason"]');
  rejectionDialog?.addEventListener('close', () => {
    rejectionForm?.reset();
    if (fixedCursor && fixedCursor.parentElement === rejectionDialog) document.body.append(fixedCursor);
  });
  document.addEventListener('click', event => {
    if (!rejectionDialog || !rejectionForm) return;
    const trigger = event.target.closest('[data-reject-open]');
    if (trigger) {
      const requestId = trigger.dataset.requestId || '';
      if (!/^\d+$/.test(requestId)) return;
      rejectionForm.action = `/admin/requests/${requestId}/reject`;
      rejectionForm.reset();
      if (!rejectionDialog.open) rejectionDialog.showModal();
      rejectionDialog.append(fixedCursor);
      window.requestAnimationFrame(() => rejectionReason?.focus());
      return;
    }
    if (event.target.closest('[data-rejection-dialog-close]') || event.target === rejectionDialog) {
      if (rejectionDialog.open) rejectionDialog.close();
    }
  });

  document.addEventListener('submit', event => {
    const deleteAllForm = event.target.closest('[data-confirm-notification-delete-all]');
    if (deleteAllForm) {
      if (!window.confirm('Delete all notifications? This action cannot be undone.')) {
        event.preventDefault();
        return;
      }
      const cards = [...document.querySelectorAll('.notification-card')];
      if (!cards.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      event.preventDefault();
      cards.forEach((card, index) => {
        card.style.setProperty('--trash-delay', `${Math.min(index, 8) * 35}ms`);
        card.classList.add('is-deleting-all');
      });
      const button = deleteAllForm.querySelector('.notification-delete-all-button');
      if (button) button.disabled = true;
      button?.classList.add('is-deleting');
      window.setTimeout(() => deleteAllForm.submit(), 850);
      return;
    }
    const deleteForm = event.target.closest('[data-confirm-notification-delete]');
    if (!deleteForm) return;
    if (!window.confirm('Delete this notification? This action cannot be undone.')) event.preventDefault();
    else {
      const card = deleteForm.closest('.notification-card');
      if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      event.preventDefault();
      card.classList.add('is-deleting');
      const button = deleteForm.querySelector('.notification-delete-button');
      if (button) button.disabled = true;
      window.setTimeout(() => deleteForm.submit(), 520);
    }
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-auth-switch]');
    if (!link) return;
    const shell = link.closest('[data-auth-mode]');
    if (!shell || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    event.preventDefault();
    if (shell.dataset.authSwitching === 'true') return;

    const switchingToRegister = link.getAttribute('href') === '/register';
    const mode = switchingToRegister ? 'register' : 'login';
    const contentSwapDelay = 310;
    const formPanel = shell.querySelector('.auth-form-panel');
    if (!formPanel) return;
    let switchFinished = false;
    let fallbackTimer;

    const finishSwitch = () => {
      if (switchFinished) return;
      switchFinished = true;
      window.clearTimeout(fallbackTimer);
      formPanel.removeEventListener('transitionend', onPanelTransitionEnd);
      shell.classList.add('auth-switch-settle');
      shell.classList.remove('switch-to-register', 'switch-to-login', 'login-mode', 'register-mode');
      shell.classList.add(switchingToRegister ? 'register-mode' : 'login-mode');
      shell.dataset.authMode = mode;
      delete shell.dataset.authSwitching;
      window.history.pushState({}, '', link.getAttribute('href'));
      void shell.offsetWidth;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => shell.classList.remove('auth-switch-settle'));
      });
    };

    const onPanelTransitionEnd = event => {
      if (event.target === formPanel && event.propertyName === 'transform') finishSwitch();
    };
    formPanel.addEventListener('transitionend', onPanelTransitionEnd);
    shell.dataset.authSwitching = 'true';
    shell.classList.add(switchingToRegister ? 'switch-to-register' : 'switch-to-login');

    window.setTimeout(() => {
      const formArea = shell.querySelector('.auth-form-area');
      if (!formArea) return;
      const googleButtonMarkup = !switchingToRegister && shell.dataset.googleEnabled === 'true' ? '<div class="auth-divider"><span>or</span></div><a class="google-sign-in" href="/auth/google"><span class="google-g-mark" aria-hidden="true">G</span><span>Continue with Google</span></a>' : '';
      formArea.innerHTML = `<div class="auth-welcome">${authWelcomeLogo}</div>
        <div class="auth-form-main">
        <div class="auth-kicker">${switchingToRegister ? 'Create account' : 'Sign in'}</div>
        <h1>${switchingToRegister ? 'Create account' : 'Sign in'}</h1>
        <p class="auth-form-copy">${switchingToRegister ? 'Verify your CSPC email to create a borrower account.' : 'Access the equipment library and keep track of your requests.'}</p>
        <form method="post" action="/${mode}" class="auth-card">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          ${switchingToRegister ? '<label>Full name<input name="name" autocomplete="name" placeholder="Name" required maxlength="120"></label>' : ''}
          <label>CSPC email<input type="email" name="email" autocomplete="email" placeholder="CSPC email" required pattern="[^@\\s]+@my\\.cspc\\.edu\\.ph"></label>
          ${switchingToRegister ? `<label>College / campus<div class="department-select" data-department-select data-required-selection><input type="hidden" name="department" value="" data-department-value><button class="department-select-trigger" type="button" data-department-trigger role="combobox" aria-label="Select your college or campus" aria-haspopup="listbox" aria-expanded="false" aria-controls="department-options" aria-required="true"><span data-department-label>Select your college / campus</span><span class="department-select-chevron" aria-hidden="true"></span></button><div class="department-select-menu" id="department-options" data-department-options role="listbox" aria-label="Colleges" hidden>${departmentOptions.map(name => `<button type="button" class="department-option" data-department-option data-value="${escapeHtml(name)}" role="option" aria-selected="false">${escapeHtml(name)}</button>`).join('')}</div><span class="department-error" data-department-error hidden>Please choose a college or campus.</span></div></label>` : ''}
          ${passwordFieldMarkup('Password', 'auth-password', 'password', switchingToRegister ? 'new-password' : 'current-password')}
          ${switchingToRegister ? passwordFieldMarkup('Confirm password', 'auth-password-confirm', 'password_confirm', 'new-password') : ''}
          ${switchingToRegister ? '<p class="field-note">Use 12+ characters with uppercase, lowercase, a number, and a symbol. A verification link will be sent to your CSPC email.</p>' : ''}
          <button>${switchingToRegister ? 'Email verification link' : 'Sign in'}</button>
        </form>
        ${googleButtonMarkup}
        </div>
        <p class="auth-switch">${switchingToRegister ? 'Already have an account?' : 'New to Vault?'} <a href="${switchingToRegister ? '/login' : '/register'}" data-auth-switch>${switchingToRegister ? 'Sign in' : 'Create an account'}</a></p>`;
    }, contentSwapDelay);
    fallbackTimer = window.setTimeout(finishSwitch, 760);
  });

  // Keep logo motion independent from the single account-panel slide.


  document.querySelectorAll('.borrow-request-form[data-availability-url]').forEach(form => {
    const borrowDate = form.querySelector('[name="borrow_date"]');
    const dueDate = form.querySelector('[name="due_date"]');
    const quantity = form.querySelector('[name="quantity"]');
    const message = form.querySelector('[data-availability-message]');
    const submit = form.querySelector('button[type="submit"], button:not([type])');
    let timer;
    const updateAvailability = async () => {
      if (!borrowDate?.value || !dueDate?.value || dueDate.value < borrowDate.value) {
        if (message) message.textContent = 'Choose a valid date range.';
        if (submit) submit.disabled = true;
        return;
      }
      if (message) message.textContent = 'Checking availability…';
      try {
        const params = new URLSearchParams({ borrow_date: borrowDate.value, due_date: dueDate.value });
        const response = await fetch(`${form.dataset.availabilityUrl}?${params}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Availability could not be checked.');
        const available = Number(result.available) || 0;
        if (message) message.textContent = result.unavailableReason || `${available} ${available === 1 ? 'copy is' : 'copies are'} available for these dates.`;
        if (quantity) {
          quantity.max = String(Math.max(1, available));
          if (Number(quantity.value) > available && available > 0) quantity.value = String(available);
        }
        if (submit) submit.disabled = available < 1;
      } catch (error) {
        if (message) message.textContent = error.message;
        if (submit) submit.disabled = true;
      }
    };
    [borrowDate, dueDate].forEach(input => input?.addEventListener('change', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(updateAvailability, 180);
    }));
    updateAvailability();
  });

})();
