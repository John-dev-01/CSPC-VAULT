(() => {
  const root = document.querySelector('[data-chat-root]');
  if (!root) return;

  const role = root.dataset.chatRole;
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (role !== 'borrower' && role !== 'admin') return;
  const list = root.querySelector('[data-chat-conversations]');
  const filterToggle = root.querySelector('[data-chat-filter-toggle]');
  const filterPanel = root.querySelector('[data-chat-filter-panel]');
  const filterSummary = root.querySelector('[data-chat-filter-summary]');
  const filterClear = root.querySelector('[data-chat-filter-clear]');
  const departmentFilters = new Set();
  const departmentCheckboxes = [...root.querySelectorAll('[data-department-filter]')];
  const messagePane = root.querySelector('[data-chat-messages]');
  const title = root.querySelector('[data-chat-title]');
  const subtitle = root.querySelector('[data-chat-subtitle]');
  const status = root.querySelector('[data-chat-status]');
  const form = root.querySelector('[data-chat-form]');
  const textarea = form?.querySelector('textarea[name="body"]');
  const attachToggle = form?.querySelector('[data-chat-attach-toggle]');
  const itemPicker = form?.querySelector('[data-chat-item-picker]');
  const itemOptions = form?.querySelector('[data-chat-item-options]');
  const attachClose = form?.querySelector('[data-chat-attach-close]');
  const itemPreview = form?.querySelector('[data-chat-item-preview]');
  const itemPreviewItems = itemPreview?.querySelector('[data-chat-item-preview-items]');
  const sendButton = form?.querySelector('[data-chat-send]');
  if (!messagePane || !form || !textarea || !attachToggle || !itemPicker ||
      !itemOptions || !attachClose || !itemPreview || !itemPreviewItems || !sendButton) return;

  let activeBorrowerId = null;
  let lastMessageId = 0;
  let conversationSignature = '';
  let currentConversations = [];
  let currentItems = [];
  let itemsLoaded = false;
  let refreshTimer = null;
  let refreshing = false;

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.assign('/login');
      throw new Error(data.error || 'Sign in again to continue.');
    }
    if (!response.ok) throw new Error(data.error || 'Unable to load messages.');
    return data;
  }

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function showEmpty(message) {
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.dataset.chatEmpty = '';
    empty.textContent = message;
    messagePane.replaceChildren(empty);
  }

  function formattedTime(value) {
    const raw = String(value || '');
    const parsed = new Date(`${raw.replace(' ', 'T')}Z`);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function appendMessage(message) {
    const item = document.createElement('article');
    item.className = `chat-message${message.sender_role === role ? ' is-own' : ''}`;
    item.dataset.messageId = String(message.id);

    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';
    const sender = document.createElement('span');
    sender.textContent = message.sender_role === role ? 'You' : (message.sender_name || (message.sender_role === 'admin' ? 'Admin team' : 'Borrower'));
    const time = document.createElement('time');
    time.dateTime = String(message.created_at || '').replace(' ', 'T') + 'Z';
    time.textContent = formattedTime(message.created_at);
    meta.append(sender, time);

    const body = document.createElement('p');
    body.className = 'chat-message-body';
    body.textContent = message.body;
    item.append(meta, body);
    if (Array.isArray(message.equipment) && message.equipment.length) {
      const attachments = document.createElement('div');
      attachments.className = 'chat-item-attachments';
      for (const equipment of message.equipment) {
        const attachment = document.createElement('div');
        attachment.className = 'chat-item-attachment';
        if (equipment.image_url) {
          const image = document.createElement('img');
          image.className = 'chat-item-attachment-image';
          image.src = equipment.image_url;
          image.alt = equipment.name;
          image.loading = 'lazy';
          image.addEventListener('error', () => image.remove(), { once: true });
          attachment.append(image);
        }
        const details = document.createElement('div');
        details.className = 'chat-item-attachment-details';
        const name = document.createElement('strong');
        name.textContent = equipment.name;
        const department = document.createElement('small');
        department.textContent = `${equipment.department || 'CSPC'} department`;
        details.append(name, department);
        attachment.append(details);
        attachments.append(attachment);
      }
      item.append(attachments);
    }
    messagePane.append(item);
  }

  function setPickerOpen(open) {
    itemPicker.hidden = !open;
    attachToggle.setAttribute('aria-expanded', String(open));
  }

  function updateItemPreview() {
    const selectedIds = new Set(Array.from(itemOptions.querySelectorAll('input:checked'), input => input.value));
    const selectedItems = currentItems.filter(item => selectedIds.has(String(item.id)));
    itemPreviewItems.replaceChildren();
    for (const selectedItem of selectedItems) {
      const preview = document.createElement('div');
      preview.className = 'chat-item-preview-entry';
      if (selectedItem.image_url) {
        const image = document.createElement('img');
        image.src = selectedItem.image_url;
        image.alt = selectedItem.name;
        image.loading = 'lazy';
        preview.append(image);
      }
      const name = document.createElement('span');
      name.textContent = `${selectedItem.name} · ${selectedItem.department}`;
      preview.append(name);
      itemPreviewItems.append(preview);
    }
    itemPreview.hidden = selectedItems.length === 0;
  }

  function renderItems(items) {
    currentItems = items;
    itemsLoaded = true;
    itemOptions.replaceChildren();
    for (const item of items) {
      const label = document.createElement('label');
      label.className = 'chat-item-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(item.id);
      checkbox.dataset.chatEquipmentId = String(item.id);
      const name = document.createElement('span');
      name.textContent = item.name;
      const department = document.createElement('small');
      department.textContent = item.department;
      label.append(checkbox, name, department);
      itemOptions.append(label);
    }
    const disabled = items.length === 0 || (role === 'admin' && activeBorrowerId === null);
    attachToggle.disabled = disabled;
    if (disabled) setPickerOpen(false);
    updateItemPreview();
  }

  async function loadItems() {
    if (role === 'borrower') {
      const data = await requestJson('/api/chat/items');
      renderItems(data.items || []);
    } else if (activeBorrowerId !== null) {
      const data = await requestJson(`/api/admin/chat/conversations/${activeBorrowerId}/items`);
      renderItems(data.items || []);
    } else {
      renderItems([]);
    }
  }

  attachToggle.addEventListener('click', () => setPickerOpen(itemPicker.hidden));
  attachClose.addEventListener('click', () => {
    setPickerOpen(false);
    attachToggle.focus();
  });
  itemOptions.addEventListener('change', updateItemPreview);
  itemOptions.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setPickerOpen(false);
      attachToggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!itemPicker.hidden && !event.target.closest('.chat-item-picker') &&
        !event.target.closest('[data-chat-attach-toggle]')) setPickerOpen(false);
  });

  function renderMessages(messages, reset = false) {
    const rows = Array.isArray(messages) ? messages : [];
    if (reset) {
      messagePane.replaceChildren();
      lastMessageId = 0;
      if (!rows.length) {
        showEmpty(role === 'borrower'
          ? 'No messages yet. Send a message to start the conversation.'
          : 'No messages yet. Send a message to start this conversation.');
        return;
      }
    }

    messagePane.querySelector('[data-chat-empty]')?.remove();
    const wasNearBottom = messagePane.scrollHeight - messagePane.scrollTop - messagePane.clientHeight < 100;
    const fresh = rows.filter(message => Number(message.id) > lastMessageId);
    for (const message of fresh) {
      appendMessage(message);
      lastMessageId = Math.max(lastMessageId, Number(message.id));
    }
    if (fresh.length && (reset || wasNearBottom)) messagePane.scrollTop = messagePane.scrollHeight;
  }

  function setActiveConversation(id) {
    for (const button of list?.querySelectorAll('[data-borrower-id]') || []) {
      const active = Number(button.dataset.borrowerId) === Number(id);
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  function setSidebarChatUnread(count) {
    const href = role === 'admin' ? '/admin/chat' : '/chat';
    const chatLink = document.querySelector(`.sidebar nav a[href="${href}"]`);
    if (!chatLink) return;
    const unread = Math.max(0, Number(count) || 0);
    let badge = chatLink.querySelector('.sidebar-notification-count');
    if (!unread) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sidebar-notification-count';
      chatLink.append(badge);
    }
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.setAttribute('aria-label', `${unread} unread chat messages`);
  }

  function updateAdminChatUnread() {
    setSidebarChatUnread(currentConversations.reduce((sum, conversation) => sum + (Number(conversation.unread_count) || 0), 0));
  }

  function renderConversations(rows) {
    if (!list) return;
    currentConversations = rows;
    updateAdminChatUnread();
    const visibleRows = departmentFilters.size
      ? rows.filter(conversation => departmentFilters.has(conversation.department))
      : rows;
    const signature = JSON.stringify({ rows, departments: [...departmentFilters].sort() });
    if (signature === conversationSignature) {
      setActiveConversation(activeBorrowerId);
      return;
    }
    conversationSignature = signature;
    list.replaceChildren();
    if (!visibleRows.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty chat-inbox-empty';
      empty.textContent = rows.length ? 'No borrowers match the selected departments.' : 'No borrower accounts are available yet.';
      list.append(empty);
      return;
    }

    for (const conversation of visibleRows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-conversation';
      button.dataset.borrowerId = String(conversation.borrower_id);
      const top = document.createElement('span');
      top.className = 'chat-conversation-top';
      const name = document.createElement('strong');
      name.textContent = conversation.name;
      top.append(name);
      if (Number(conversation.unread_count) > 0) {
        const badge = document.createElement('span');
        badge.className = 'chat-unread-badge';
        badge.textContent = String(conversation.unread_count);
        badge.setAttribute('aria-label', `${conversation.unread_count} unread messages`);
        top.append(badge);
      }
      const email = document.createElement('span');
      email.className = 'chat-conversation-email';
      email.textContent = conversation.email;
      const department = document.createElement('span');
      department.className = 'chat-conversation-department';
      department.textContent = conversation.department || 'College of Computer Studies';
      const preview = document.createElement('span');
      preview.className = 'chat-conversation-preview';
      preview.textContent = conversation.last_message || 'Start a conversation';
      button.append(top, email, department, preview);
      button.addEventListener('click', () => selectConversation(Number(conversation.borrower_id)));
      list.append(button);
    }
    setActiveConversation(activeBorrowerId);
  }

  async function loadBorrowerMessages(reset = false) {
    const data = await requestJson('/api/chat/messages');
    renderMessages(data.messages, reset);
    setSidebarChatUnread(0);
  }

  async function loadAdminMessages(reset = false) {
    if (activeBorrowerId === null) return;
    const data = await requestJson(`/api/admin/chat/conversations/${activeBorrowerId}/messages`);
    const conversation = currentConversations.find(item => Number(item.borrower_id) === activeBorrowerId);
    if (conversation) {
      conversation.unread_count = 0;
      updateAdminChatUnread();
      renderConversations(currentConversations);
    }
    title.textContent = data.borrower.name;
    subtitle.textContent = `${data.borrower.department || 'College of Computer Studies'} · ${data.borrower.email} · private conversation`;
    renderMessages(data.messages, reset);
  }

  async function selectConversation(id) {
    if (!Number.isSafeInteger(id) || id < 1) return;
    const changed = activeBorrowerId !== id;
    activeBorrowerId = id;
    setActiveConversation(id);
    sendButton.disabled = false;
    attachToggle.disabled = true;
    itemOptions.querySelectorAll('input:checked').forEach(input => { input.checked = false; });
    setPickerOpen(false);
    updateItemPreview();
    if (changed) {
      const selected = currentConversations.find(item => Number(item.borrower_id) === id);
      title.textContent = selected?.name || 'Borrower';
      subtitle.textContent = selected
        ? `${selected.department || 'College of Computer Studies'} · ${selected.email}`
        : 'Private conversation';
      showEmpty('Loading conversation…');
      lastMessageId = 0;
    }
    try {
      await Promise.all([loadAdminMessages(changed), loadItems()]);
      setStatus('Up to date');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function loadAdminInbox() {
    const data = await requestJson('/api/admin/chat/conversations');
    renderConversations(data.conversations || []);
    const available = currentConversations.some(item => Number(item.borrower_id) === activeBorrowerId);
    if (!available) activeBorrowerId = null;
    if (activeBorrowerId === null && currentConversations.length) {
      await selectConversation(Number(currentConversations[0].borrower_id));
    } else if (activeBorrowerId !== null) {
      await loadAdminMessages(false);
    } else {
      title.textContent = 'Choose a borrower';
      subtitle.textContent = 'Select a borrower to start or continue a conversation.';
      sendButton.disabled = true;
      await loadItems();
      showEmpty('Choose a borrower to open their conversation.');
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      if (document.hidden) {
        setStatus('Updates paused while this tab is hidden');
      } else if (role === 'borrower') {
        if (!itemsLoaded) await loadItems();
        await loadBorrowerMessages(false);
        setStatus('Up to date');
      } else {
        await loadAdminInbox();
        setStatus('Up to date');
      }
    } catch (error) {
      setStatus(error.message || 'Unable to load messages.', true);
    } finally {
      refreshing = false;
      refreshTimer = window.setTimeout(refresh, 4000);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = textarea.value.trim();
    if (!body || body.length > 2000 || (role === 'admin' && activeBorrowerId === null)) return;
    sendButton.disabled = true;
    setStatus('Sending…');
    const url = role === 'borrower'
      ? '/api/chat/messages'
      : `/api/admin/chat/conversations/${activeBorrowerId}/messages`;
    try {
      const payload = new URLSearchParams({ body });
      for (const input of itemOptions.querySelectorAll('input:checked')) payload.append('equipment_ids', input.value);
      await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Chat-Request': '1', 'X-CSRF-Token': csrfToken },
        body: payload,
      });
      textarea.value = '';
      itemOptions.querySelectorAll('input:checked').forEach(input => { input.checked = false; });
      setPickerOpen(false);
      updateItemPreview();
      if (role === 'borrower') await loadBorrowerMessages(false);
      else await loadAdminInbox();
      setStatus('Message sent');
      textarea.focus();
    } catch (error) {
      setStatus(error.message || 'Message could not be sent.', true);
    } finally {
      sendButton.disabled = role === 'admin' && activeBorrowerId === null;
    }
  });

  if (role === 'admin' && list) {
    list.addEventListener('keydown', event => {
      if (event.key === 'Escape') textarea.focus();
    });
  }
  if (role === 'admin' && filterToggle && filterPanel) {
    let filterPanelCloseTimer;
    const closeFilterPanel = () => {
      if (filterPanelCloseTimer) window.clearTimeout(filterPanelCloseTimer);
      if (filterPanel.hidden) return;
      filterPanel.classList.remove('is-open');
      filterToggle.setAttribute('aria-expanded', 'false');
      filterPanelCloseTimer = window.setTimeout(() => {
        if (!filterPanel.classList.contains('is-open')) filterPanel.hidden = true;
        filterPanelCloseTimer = undefined;
      }, 180);
    };
    const openFilterPanel = () => {
      if (filterPanelCloseTimer) window.clearTimeout(filterPanelCloseTimer);
      filterPanelCloseTimer = undefined;
      filterPanel.hidden = false;
      filterPanel.classList.remove('is-open');
      void filterPanel.offsetWidth;
      filterToggle.setAttribute('aria-expanded', 'true');
      window.requestAnimationFrame(() => {
        if (!filterPanel.hidden && filterToggle.getAttribute('aria-expanded') === 'true') filterPanel.classList.add('is-open');
      });
    };
    const updateFilterSummary = () => {
      const count = departmentFilters.size;
      filterToggle.textContent = count ? `Filter · ${count}` : 'Filter';
      filterSummary.textContent = count ? `${count} department${count === 1 ? '' : 's'} selected` : 'All departments';
      filterToggle.setAttribute('aria-label', count ? `Filter borrowers; ${count} department${count === 1 ? '' : 's'} selected` : 'Filter borrowers by department');
    };
    filterToggle.addEventListener('click', () => {
      if (filterPanel.classList.contains('is-open')) closeFilterPanel();
      else openFilterPanel();
    });
    filterPanel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeFilterPanel();
        filterToggle.focus();
      }
    });
    departmentCheckboxes.forEach(checkbox => checkbox.addEventListener('change', () => {
      if (checkbox.checked) departmentFilters.add(checkbox.value);
      else departmentFilters.delete(checkbox.value);
      updateFilterSummary();
      renderConversations(currentConversations);
    }));
    filterClear?.addEventListener('click', () => {
      departmentFilters.clear();
      departmentCheckboxes.forEach(checkbox => { checkbox.checked = false; });
      updateFilterSummary();
      renderConversations(currentConversations);
    });
    updateFilterSummary();
  }
  window.addEventListener('beforeunload', () => window.clearTimeout(refreshTimer), { once: true });
  refresh();
})();
