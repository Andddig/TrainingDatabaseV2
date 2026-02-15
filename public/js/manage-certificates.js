(function() {
  const app = document.getElementById('manageCertificatesApp');
  if (!app) {
    return;
  }

  const searchInput = document.getElementById('userSearchInput');
  const resultsContainer = document.getElementById('userSearchResults');
  const selectedUserCard = document.getElementById('selectedUserCard');
  const selectedUserName = document.getElementById('selectedUserName');
  const selectedUserFirst = document.getElementById('selectedUserFirst');
  const selectedUserMiddle = document.getElementById('selectedUserMiddle');
  const selectedUserLast = document.getElementById('selectedUserLast');
  const selectedUserEmail = document.getElementById('selectedUserEmail');
  const selectedUserRoles = document.getElementById('selectedUserRoles');
  const addCertificateSection = document.getElementById('addCertificateSection');
  const userCertificatesSection = document.getElementById('userCertificatesSection');
  const selectedUserIdInput = document.getElementById('selectedUserId');
  const certificateTableBody = document.querySelector('#certificateTable tbody');
  const certificateTableContainer = document.getElementById('certificateTableContainer');
  const noCertificatesNotice = document.getElementById('noCertificatesNotice');
  const editModalElement = document.getElementById('editCertificateModal');
  const editModal = editModalElement ? $(editModalElement) : null;
  const editForm = document.getElementById('editCertificateForm');
  const editTrainingClass = document.getElementById('editTrainingClass');
  const editStartDate = document.getElementById('editStartDate');
  const editEndDate = document.getElementById('editEndDate');
  const editHoursLogged = document.getElementById('editHoursLogged');
  const editRedirectStudentId = document.getElementById('editRedirectStudentId');
  const editCertificateFileInput = document.getElementById('editCertificateFile');
  const addCertificateFileInput = document.getElementById('certificateFile');
  const editCertificateCurrentFile = document.getElementById('editCertificateCurrentFile');
  const trainingClassSelect = document.getElementById('trainingClass');
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const hoursInput = document.getElementById('hoursLogged');
  const courseNumberInput = document.getElementById('courseNumber');
  const autofillStatus = document.getElementById('autofillStatus');
  const editAutofillStatus = document.getElementById('editAutofillStatus');
  const editCourseNumberInput = document.getElementById('editCourseNumber');
  const presearchCertificateInput = document.getElementById('presearchCertificateFile');
  const presearchUploadButton = document.getElementById('presearchUploadButton');
  const presearchStatus = document.getElementById('presearchStatus');

  const defaultAutofillMessage = autofillStatus ? autofillStatus.textContent : '';
  const defaultEditAutofillMessage = editAutofillStatus ? editAutofillStatus.textContent : '';
  const defaultPresearchStatusMessage = presearchStatus ? presearchStatus.textContent : '';

  const trainingClassOptionsCache = trainingClassSelect
    ? Array.from(trainingClassSelect.options)
        .filter((option) => option.value)
        .map((option) => ({
          option,
          normalized: normalizeForMatch(option.textContent || option.innerText || '', { keepNumbers: true })
        }))
    : [];

  let selectedUserId = app.dataset.selectedUserId || '';
  let selectedUserDetails = {
    displayName: app.dataset.selectedUserName || '',
    email: app.dataset.selectedUserEmail || '',
    firstName: app.dataset.selectedUserFirst || '',
    middleName: app.dataset.selectedUserMiddle || '',
    lastName: app.dataset.selectedUserLast || ''
  };
  let queuedAutofillData = null;
  let queuedAutofillSource = null;
  let currentSearchResults = [];
  let highlightedResultIndex = -1;
  let presearchProcessing = false;
  let searchDebounce;

  function escapeHtml(value) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
  }

  function normalizeForMatch(value, { keepNumbers = false } = {}) {
    const source = (value || '').toLowerCase();
    const pattern = keepNumbers ? /[^a-z0-9]+/g : /[^a-z]+/g;
    return source.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  }

  function setAutofillStatus(element, message, level) {
    if (!element) {
      return;
    }

    element.classList.remove('text-success', 'text-danger', 'text-warning', 'text-info', 'text-muted');
    const resolvedLevel = level || 'muted';
    switch (resolvedLevel) {
      case 'success':
        element.classList.add('text-success');
        break;
      case 'warning':
        element.classList.add('text-warning');
        break;
      case 'danger':
        element.classList.add('text-danger');
        break;
      case 'info':
        element.classList.add('text-info');
        break;
      default:
        element.classList.add('text-muted');
        break;
    }

    element.textContent = message || '';
  }

  function resetAutofillStatus(element, defaultMessage) {
    if (!element) {
      return;
    }
    setAutofillStatus(element, defaultMessage || '', defaultMessage ? 'muted' : 'muted');
  }

  function updateFileLabel(input) {
    if (!input) {
      return;
    }
    const label = input.nextElementSibling;
    if (!label) {
      return;
    }
    const files = input.files;
    label.textContent = files && files.length ? files[0].name : 'Choose file...';
  }

  function findTrainingClassOption(name, selectElement) {
    if (!selectElement || !name) {
      return null;
    }

    const normalizedTarget = normalizeForMatch(name, { keepNumbers: true });
    if (!normalizedTarget) {
      return null;
    }

    const candidates = selectElement === trainingClassSelect && trainingClassOptionsCache.length
      ? trainingClassOptionsCache
      : Array.from(selectElement.options)
          .filter((option) => option.value)
          .map((option) => ({
            option,
            normalized: normalizeForMatch(option.textContent || option.innerText || '', { keepNumbers: true })
          }));

    let bestOption = null;
    let bestScore = 0;

    candidates.forEach(({ option, normalized }) => {
      if (!normalized) {
        return;
      }

      if (normalized === normalizedTarget) {
        bestOption = option;
        bestScore = 100;
        return;
      }

      let score = 0;
      if (normalized.includes(normalizedTarget) || normalizedTarget.includes(normalized)) {
        score = 85 - Math.abs(normalized.length - normalizedTarget.length);
      } else {
        const targetWords = normalizedTarget.split(' ').filter(Boolean);
        const optionWords = normalized.split(' ').filter(Boolean);
        const overlap = targetWords.filter((word) => optionWords.includes(word)).length;
        if (overlap) {
          score = (overlap / targetWords.length) * 70;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    });

    return bestScore >= 45 ? bestOption : null;
  }

  function getUserNameVariantSet(user) {
    const variants = new Set();
    if (!user) {
      return variants;
    }

    const first = user.firstName || '';
    const middle = user.middleName || '';
    const last = user.lastName || '';
    const display = user.displayName || '';
    const middleInitial = middle ? middle.charAt(0) : '';
    const firstInitial = first ? first.charAt(0) : '';

    const candidateValues = [
      `${first} ${last}`,
      `${first} ${middle} ${last}`,
      `${first} ${middleInitial} ${last}`,
      `${firstInitial} ${last}`,
      `${last}, ${first} ${middle}`,
      display
    ];

    candidateValues
      .map((value) => normalizeForMatch(value))
      .filter(Boolean)
      .forEach((normalized) => variants.add(normalized));

    return variants;
  }

  function applyAutofillResult(extracted, context) {
    if (!context || !context.statusElement) {
      return;
    }

    const messages = [];
    let statusLevel = 'success';

    if (!extracted || typeof extracted !== 'object') {
      setAutofillStatus(context.statusElement, 'No recognizable fields were found.', 'warning');
      return;
    }

    let courseIdentifierHandled = false;

    if (context.trainingClassSelect && extracted.trainingClassName) {
      const match = findTrainingClassOption(extracted.trainingClassName, context.trainingClassSelect);
      if (match) {
        context.trainingClassSelect.value = match.value;
        messages.push(`Matched class: ${match.textContent || match.innerText || match.label || match.value}`);
      } else {
        messages.push(`Suggested class: ${extracted.trainingClassName}`);
        statusLevel = 'warning';
      }
    }

    if (context.startDateInput && extracted.courseDate) {
      const isoDate = extracted.courseDate.substring(0, 10);
      context.startDateInput.value = isoDate;
      if (context.endDateInput) {
        context.endDateInput.value = isoDate;
      }

      const datePreview = new Date(extracted.courseDate);
      if (!Number.isNaN(datePreview.getTime())) {
        messages.push(`Date set: ${datePreview.toLocaleDateString()}`);
      }
    } else if (extracted.courseDateText) {
      messages.push(`Suggested date: ${extracted.courseDateText}`);
      statusLevel = statusLevel === 'success' ? 'warning' : statusLevel;
    }

    if (context.hoursInput && typeof extracted.hoursLogged === 'number' && !Number.isNaN(extracted.hoursLogged)) {
      const hoursValue = Number.isInteger(extracted.hoursLogged)
        ? extracted.hoursLogged
        : parseFloat(extracted.hoursLogged.toFixed(1));
      context.hoursInput.value = hoursValue;
      messages.push(`Hours set: ${hoursValue}`);
    }

    if (context.courseNumberInput && extracted.courseIdentifier) {
      context.courseNumberInput.value = extracted.courseIdentifier;
      messages.push(`Course number set: ${extracted.courseIdentifier}`);
      courseIdentifierHandled = true;
    } else if (extracted.courseIdentifier) {
      messages.push(`Suggested course number: ${extracted.courseIdentifier}`);
      if (statusLevel === 'success') {
        statusLevel = 'info';
      }
      courseIdentifierHandled = true;
    }

    const currentUserName = selectedUserName ? selectedUserName.textContent.trim() : '';
    if (extracted.recipientName) {
      const normalizedRecipient = normalizeForMatch(extracted.recipientName);
      const candidateNames = new Set();

      const normalizedSelectedDisplay = normalizeForMatch(currentUserName);
      if (normalizedSelectedDisplay) {
        candidateNames.add(normalizedSelectedDisplay);
      }

      if (selectedUserDetails) {
        getUserNameVariantSet(selectedUserDetails).forEach((variant) => candidateNames.add(variant));
      }

      if (normalizedRecipient && candidateNames.has(normalizedRecipient)) {
        messages.push(`Detected recipient: ${extracted.recipientName}`);
      } else if (normalizedRecipient) {
        messages.push(`Detected recipient "${extracted.recipientName}" does not match the selected user.`);
        statusLevel = 'warning';
      }
    }

    if (!courseIdentifierHandled && extracted.courseIdentifier) {
      messages.push(`Course ID: ${extracted.courseIdentifier}`);
    } else if (extracted.logNumber) {
      messages.push(`Log number: ${extracted.logNumber}`);
    }

    if (!messages.length) {
      messages.push('No recognizable fields were found.');
      statusLevel = 'warning';
    }

    setAutofillStatus(context.statusElement, messages.join(' • '), statusLevel);
  }

  async function extractCertificateData(file) {
    const formData = new FormData();
    formData.append('certificateFile', file);

    const response = await fetch('/training/certificates/extract', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch (err) {
      payload = {};
    }

    if (!response.ok || !payload.success) {
      const message = payload && payload.error ? payload.error : 'Unable to extract certificate details.';
      throw new Error(message);
    }

    return payload;
  }

  async function handleAutofillFromFile(input, context) {
    if (!input || !input.files || !input.files.length || !context || !context.statusElement) {
      return;
    }

    const file = input.files[0];
    setAutofillStatus(context.statusElement, 'Attempting to read certificate...', 'info');

    try {
      const payload = await extractCertificateData(file);
      applyAutofillResult(payload.extracted || {}, context);
    } catch (err) {
      console.error('Auto-fill failed:', err);
      setAutofillStatus(context.statusElement, err.message || 'Auto-fill failed.', 'danger');
    }
  }

  if (addCertificateFileInput) {
    addCertificateFileInput.addEventListener('change', () => {
      updateFileLabel(addCertificateFileInput);

      if (!addCertificateFileInput.files || !addCertificateFileInput.files.length) {
        resetAutofillStatus(autofillStatus, defaultAutofillMessage);
        return;
      }

      handleAutofillFromFile(addCertificateFileInput, {
        trainingClassSelect,
        startDateInput,
        endDateInput,
        hoursInput,
        courseNumberInput,
        statusElement: autofillStatus
      });
    });
  }

  if (editCertificateFileInput) {
    editCertificateFileInput.addEventListener('change', () => {
      updateFileLabel(editCertificateFileInput);

      if (!editCertificateFileInput.files || !editCertificateFileInput.files.length) {
        resetAutofillStatus(editAutofillStatus, defaultEditAutofillMessage);
        return;
      }

      handleAutofillFromFile(editCertificateFileInput, {
        trainingClassSelect: editTrainingClass,
        startDateInput: editStartDate,
        endDateInput: editEndDate,
        hoursInput: editHoursLogged,
        courseNumberInput: editCourseNumberInput,
        statusElement: editAutofillStatus
      });
    });
  }

  function closeSearchResults() {
    currentSearchResults = [];
    highlightedResultIndex = -1;
    resultsContainer.innerHTML = '';
    resultsContainer.classList.add('d-none');
  }

  function renderSearchResults(users) {
    resultsContainer.innerHTML = '';
    currentSearchResults = Array.isArray(users) ? users : [];
    highlightedResultIndex = -1;

    if (!users.length) {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'list-group-item text-muted';
      emptyItem.textContent = 'No matching users found.';
      resultsContainer.appendChild(emptyItem);
      resultsContainer.classList.remove('d-none');
      return;
    }

    users.forEach((user, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-group-item list-group-item-action';
      item.setAttribute('data-result-index', index);
      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <span>${escapeHtml(user.displayName || '')}</span>
          <small class="text-muted ml-3">${escapeHtml(user.email || '')}</small>
        </div>`;
      item.addEventListener('click', () => {
        closeSearchResults();
        searchInput.value = '';
        setSelectedUser({
          id: user.id,
          displayName: user.displayName || '',
          email: user.email || '',
          roles: user.roles || [],
          firstName: user.firstName || '',
          middleName: user.middleName || '',
          lastName: user.lastName || ''
        });
      });
      resultsContainer.appendChild(item);
    });

    resultsContainer.classList.remove('d-none');
  }

  function highlightSearchResult(index) {
    const items = resultsContainer.querySelectorAll('.list-group-item-action');
    if (!items.length || index < 0 || index >= items.length) {
      return;
    }

    items.forEach((item) => item.classList.remove('active'));
    items[index].classList.add('active');
    items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function selectHighlightedResult() {
    if (highlightedResultIndex < 0 || highlightedResultIndex >= currentSearchResults.length) {
      return;
    }

    const user = currentSearchResults[highlightedResultIndex];
    closeSearchResults();
    searchInput.value = '';
    setSelectedUser({
      id: user.id,
      displayName: user.displayName || '',
      email: user.email || '',
      roles: user.roles || [],
      firstName: user.firstName || '',
      middleName: user.middleName || '',
      lastName: user.lastName || ''
    });
  }

  async function searchUsers(query) {
    try {
      const response = await fetch(`/training/users/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error('Search failed');
      }
      const users = await response.json();
      renderSearchResults(Array.isArray(users) ? users : []);
    } catch (err) {
      console.error('Error searching users:', err);
      resultsContainer.innerHTML = '<div class="list-group-item text-danger">Unable to search right now. Try again shortly.</div>';
      resultsContainer.classList.remove('d-none');
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      clearTimeout(searchDebounce);

      if (query.length < 2) {
        closeSearchResults();
        return;
      }

      searchDebounce = setTimeout(() => searchUsers(query), 250);
    });

    searchInput.addEventListener('keydown', (event) => {
      if (!currentSearchResults.length) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlightedResultIndex = Math.min(highlightedResultIndex + 1, currentSearchResults.length - 1);
        highlightSearchResult(highlightedResultIndex);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlightedResultIndex = Math.max(highlightedResultIndex - 1, 0);
        highlightSearchResult(highlightedResultIndex);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (highlightedResultIndex >= 0) {
          selectHighlightedResult();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSearchResults();
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (!resultsContainer.contains(event.target) && event.target !== searchInput) {
      closeSearchResults();
    }
  });

  function formatDate(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleDateString();
  }

  function formatDateRange(start, end) {
    const startText = formatDate(start);
    const endText = formatDate(end);

    if (startText === '—' && endText === '—') {
      return '—';
    }

    return `${startText} - ${endText}`;
  }

  function statusBadgeClass(status) {
    switch ((status || '').toLowerCase()) {
      case 'approved':
        return 'badge-success';
      case 'pending':
        return 'badge-warning';
      case 'rejected':
        return 'badge-danger';
      default:
        return 'badge-secondary';
    }
  }

  function renderCertificateCell(item) {
    const cell = document.createElement('td');

    if (item.certificateUrl) {
      const link = document.createElement('a');
      link.href = item.certificateUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'View';
      cell.appendChild(link);

      if (item.certificateOriginalName) {
        const details = document.createElement('div');
        details.className = 'small text-muted';
        details.textContent = item.certificateOriginalName;
        cell.appendChild(details);
      }
    } else {
      cell.textContent = 'Not available';
    }

    return cell;
  }

  function openEditModal(item) {
    if (!editModal || !editForm) {
      return;
    }

    editForm.action = `/training/submission/${item.id}/update`;
    if (editTrainingClass) {
      editTrainingClass.value = item.trainingClassId || '';
    }

    if (editStartDate) {
      editStartDate.value = item.startDate ? item.startDate.substring(0, 10) : '';
    }

    if (editEndDate) {
      editEndDate.value = item.endDate ? item.endDate.substring(0, 10) : '';
    }

    if (editHoursLogged) {
      editHoursLogged.value = item.hoursLogged != null ? item.hoursLogged : '';
    }

    if (editCourseNumberInput) {
      editCourseNumberInput.value = item.courseNumber || '';
    }

    if (editRedirectStudentId && selectedUserId) {
      editRedirectStudentId.value = selectedUserId;
    }

    if (editCertificateFileInput) {
      editCertificateFileInput.value = '';
      updateFileLabel(editCertificateFileInput);
    }

    resetAutofillStatus(editAutofillStatus, defaultEditAutofillMessage);

    if (editCertificateCurrentFile) {
      if (item.certificateUrl) {
        const displayName = item.certificateOriginalName || 'View current file';
        editCertificateCurrentFile.innerHTML = `Current file: <a href="${item.certificateUrl}" target="_blank" rel="noopener">${escapeHtml(displayName)}</a>`;
      } else {
        editCertificateCurrentFile.textContent = 'Current file: Not available';
      }
    }

    editModal.modal('show');
  }

  function populateCertificatesTable(items) {
    certificateTableBody.innerHTML = '';

    if (!items || !items.length) {
      noCertificatesNotice.classList.remove('d-none');
      noCertificatesNotice.classList.remove('alert-danger');
      noCertificatesNotice.classList.add('alert-info');
      noCertificatesNotice.textContent = 'No certificates have been uploaded for this user yet.';
      certificateTableContainer.classList.add('d-none');
      return;
    }

    certificateTableContainer.classList.remove('d-none');
    noCertificatesNotice.classList.add('d-none');

    items.forEach((item) => {
      const row = document.createElement('tr');

      const classCell = document.createElement('td');
      classCell.textContent = item.trainingClassName || '—';
      row.appendChild(classCell);

      const dateCell = document.createElement('td');
      dateCell.textContent = formatDateRange(item.startDate, item.endDate);
      row.appendChild(dateCell);

      const hoursCell = document.createElement('td');
      hoursCell.textContent = item.hoursLogged != null ? item.hoursLogged : '—';
      row.appendChild(hoursCell);

      const courseCell = document.createElement('td');
      courseCell.textContent = item.courseNumber || '—';
      row.appendChild(courseCell);

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge ${statusBadgeClass(item.status)}`;
      badge.textContent = (item.status || '').toUpperCase();
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      row.appendChild(renderCertificateCell(item));

      const actionsCell = document.createElement('td');
      const viewLink = document.createElement('a');
      viewLink.className = 'btn btn-sm btn-outline-primary mr-2';
      viewLink.href = `/training/submission/${item.id}`;
      viewLink.innerHTML = '<i class="fas fa-eye mr-1"></i>View';
      actionsCell.appendChild(viewLink);

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-sm btn-secondary';
      editButton.innerHTML = '<i class="fas fa-edit mr-1"></i>Edit';
      editButton.addEventListener('click', () => openEditModal(item));
      actionsCell.appendChild(editButton);

      row.appendChild(actionsCell);
      certificateTableBody.appendChild(row);
    });
  }

  async function loadCertificates(userId) {
    if (!userId) {
      return;
    }

    try {
      const response = await fetch(`/training/users/${userId}/submissions`);
      if (!response.ok) {
        throw new Error('Failed to load certificates');
      }
      const items = await response.json();
      populateCertificatesTable(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('Error loading certificates:', err);
      certificateTableBody.innerHTML = '';
      certificateTableContainer.classList.add('d-none');
      noCertificatesNotice.classList.remove('d-none');
      noCertificatesNotice.classList.remove('alert-info');
      noCertificatesNotice.classList.add('alert-danger');
      noCertificatesNotice.textContent = 'Unable to load certificates. Please try again.';
    }
  }

  function setSelectedUser(user) {
    selectedUserId = user.id;
    if (selectedUserIdInput) {
      selectedUserIdInput.value = selectedUserId;
    }
    if (editRedirectStudentId) {
      editRedirectStudentId.value = selectedUserId;
    }

    if (selectedUserCard) {
      selectedUserCard.classList.remove('d-none');
    }
    if (addCertificateSection) {
      addCertificateSection.classList.remove('d-none');
    }
    if (userCertificatesSection) {
      userCertificatesSection.classList.remove('d-none');
    }

    if (selectedUserName) {
      selectedUserName.textContent = user.displayName || '—';
    }
    if (selectedUserFirst) {
      selectedUserFirst.textContent = user.firstName || '—';
    }
    if (selectedUserMiddle) {
      selectedUserMiddle.textContent = user.middleName || '—';
    }
    if (selectedUserLast) {
      selectedUserLast.textContent = user.lastName || '—';
    }
    if (selectedUserEmail) {
      selectedUserEmail.textContent = user.email || '—';
    }
    if (selectedUserRoles) {
      const roles = user.roles && user.roles.length ? user.roles.join(', ') : '—';
      selectedUserRoles.textContent = roles;
    }

    selectedUserDetails = {
      displayName: user.displayName || '',
      email: user.email || '',
      firstName: user.firstName || '',
      middleName: user.middleName || '',
      lastName: user.lastName || ''
    };

    resetAutofillStatus(autofillStatus, defaultAutofillMessage);

    if (noCertificatesNotice) {
      noCertificatesNotice.classList.remove('alert-danger');
      noCertificatesNotice.classList.remove('d-none');
      noCertificatesNotice.classList.add('alert-info');
      noCertificatesNotice.textContent = 'Loading certificates...';
    }

    certificateTableContainer.classList.add('d-none');
    certificateTableBody.innerHTML = '';

    loadCertificates(selectedUserId);

    if (queuedAutofillData && queuedAutofillSource) {
      applyAutofillResult(queuedAutofillData, {
        trainingClassSelect,
        startDateInput,
        endDateInput,
        hoursInput,
        courseNumberInput,
        statusElement: autofillStatus
      });
      queuedAutofillData = null;
      queuedAutofillSource = null;
    }
  }

  async function findUserByName(nameString) {
    if (!nameString || typeof nameString !== 'string') {
      return null;
    }

    try {
      const response = await fetch(`/training/users/search?q=${encodeURIComponent(nameString)}`);
      if (!response.ok) {
        return null;
      }

      const users = await response.json();
      if (!Array.isArray(users) || !users.length) {
        return null;
      }

      const normalizedSearch = normalizeForMatch(nameString);
      let bestMatch = null;
      let highestScore = 0;

      users.forEach((user) => {
        const userVariants = getUserNameVariantSet(user);
        if (userVariants.has(normalizedSearch)) {
          bestMatch = user;
          highestScore = 100;
          return;
        }

        userVariants.forEach((variant) => {
          const searchWords = normalizedSearch.split(' ').filter(Boolean);
          const variantWords = variant.split(' ').filter(Boolean);
          const overlap = searchWords.filter((word) => variantWords.includes(word)).length;
          const score = searchWords.length > 0 ? (overlap / searchWords.length) * 100 : 0;

          if (score > highestScore) {
            highestScore = score;
            bestMatch = user;
          }
        });
      });

      return highestScore >= 60 ? bestMatch : null;
    } catch (err) {
      console.error('Error finding user by name:', err);
      return null;
    }
  }

  if (presearchCertificateInput) {
    presearchCertificateInput.addEventListener('change', () => {
      updateFileLabel(presearchCertificateInput);
    });
  }

  if (presearchUploadButton && presearchCertificateInput) {
    presearchUploadButton.addEventListener('click', async () => {
      if (presearchProcessing) {
        return;
      }

      if (!presearchCertificateInput.files || !presearchCertificateInput.files.length) {
        setAutofillStatus(presearchStatus, 'Please select a certificate file first.', 'warning');
        return;
      }

      presearchProcessing = true;
      presearchUploadButton.disabled = true;
      setAutofillStatus(presearchStatus, 'Reading certificate...', 'info');

      try {
        const payload = await extractCertificateData(presearchCertificateInput.files[0]);
        const extracted = payload.extracted || {};

        if (!extracted.recipientName) {
          setAutofillStatus(presearchStatus, 'Could not identify the recipient on this certificate.', 'warning');
          presearchProcessing = false;
          presearchUploadButton.disabled = false;
          return;
        }

        setAutofillStatus(presearchStatus, `Searching for: ${extracted.recipientName}...`, 'info');

        const matchedUser = await findUserByName(extracted.recipientName);

        if (!matchedUser) {
          setAutofillStatus(presearchStatus, `No matching user found for "${extracted.recipientName}".`, 'danger');
          presearchProcessing = false;
          presearchUploadButton.disabled = false;
          return;
        }

        queuedAutofillData = extracted;
        queuedAutofillSource = 'presearch';

        setAutofillStatus(presearchStatus, `Found: ${matchedUser.displayName}. Loading profile...`, 'success');

        setSelectedUser({
          id: matchedUser.id,
          displayName: matchedUser.displayName || '',
          email: matchedUser.email || '',
          roles: matchedUser.roles || [],
          firstName: matchedUser.firstName || '',
          middleName: matchedUser.middleName || '',
          lastName: matchedUser.lastName || ''
        });

        presearchCertificateInput.value = '';
        updateFileLabel(presearchCertificateInput);
        setTimeout(() => {
          resetAutofillStatus(presearchStatus, defaultPresearchStatusMessage);
          presearchProcessing = false;
          presearchUploadButton.disabled = false;
        }, 2000);
      } catch (err) {
        console.error('Presearch upload failed:', err);
        setAutofillStatus(presearchStatus, err.message || 'Unable to process certificate.', 'danger');
        presearchProcessing = false;
        presearchUploadButton.disabled = false;
      }
    });
  }

  const initialUserId = selectedUserId;
  if (initialUserId) {
    setSelectedUser({
      id: initialUserId,
      displayName: app.dataset.selectedUserName || '',
      email: app.dataset.selectedUserEmail || '',
      roles: (app.dataset.selectedUserRoles || '').split('|').filter(Boolean),
      firstName: app.dataset.selectedUserFirst || '',
      middleName: app.dataset.selectedUserMiddle || '',
      lastName: app.dataset.selectedUserLast || ''
    });
  }
})();
