export const navigationMethods = {
  switchModeActive(id, factory = undefined, isLeftClick) {
    if (this.context.historyManager.isOngoingEdit()) return;

    const currentId = this.context.mode.getId();
    if (currentId === id) {
      if (id === 'custom') {
        const preset = this.context.presets.getActivePreset(isLeftClick);
        const otherPreset = this.context.presets.getActivePreset(!isLeftClick);
        if (!preset && !otherPreset) return;

        this.context.setModeById('auto');
        if (preset) this.updatePresetWith(preset.presetID, 'objectFactory', factory);
        if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
        this.context.setModeById('custom');
      }
      return;
    }

    if (id === 'custom' && factory) {
      const preset = this.context.presets.getActivePreset(isLeftClick);
      const otherPreset = this.context.presets.getActivePreset(!isLeftClick);
      if (preset || otherPreset) {
        if (preset) this.updatePresetWith(preset.presetID, 'objectFactory', factory);
        if (otherPreset) this.updatePresetWith(otherPreset.presetID, 'objectFactory', factory);
      }
    }

    this.context.setModeById(id);
  },

  switchMenuList(type) {
    const presetListButton = $('#preset-list-button-mp');
    const annotListButton = $('#annotation-list-button-mp');
    const authorListButton = $('#author-list-button-mp');

    presetListButton.attr('aria-selected', false);
    annotListButton.attr('aria-selected', false);
    authorListButton.attr('aria-selected', false);

    const presetList = $('#preset-list-mp');
    const annotList = $('#annotation-list-mp');
    const authorList = $('#author-list-mp');

    presetList.css('display', 'none');
    annotList.css('display', 'none');
    authorList.css('display', 'none');

    if (type === 'preset') {
      presetListButton.attr('aria-selected', true);
      presetList.css('display', 'block');
    } else if (type === 'authors') {
      authorListButton.attr('aria-selected', true);
      authorList.css('display', 'block');
      this._populateAuthorsList();
    } else {
      if (!this.isModalHistory) {
        annotList.css('display', 'block');
      }
      if (this._preventOpenHistoryWindowOnce) {
        this._preventOpenHistoryWindowOnce = false;
      } else {
        this.openHistoryWindow(this.isModalHistory);
      }
      annotListButton.attr('aria-selected', true);
    }
  },

  openHistoryWindow(asModal = this.isModalHistory) {
    if (asModal) this.context.historyManager.openHistoryWindow();
    else this.context.historyManager.openHistoryWindow(this._annotationsDomRenderer);
    this._afterHistoryWindowOpen(asModal);
  },

  _afterHistoryWindowOpen(asModal = this.isModalHistory) {
    if (asModal) {
      $('#preset-list-button-mp').click();
    } else {
      USER_INTERFACE.RightSideMenu.open();
      const pin = $('#annotations-panel-pin');
      if (!pin.hasClass('opened')) pin.click();
      this._preventOpenHistoryWindowOnce = true;
      $('#annotation-list-button-mp').click();
    }
    this.isModalHistory = asModal;
  },

  _createHistoryInTopPluginsMenu(focus = false) {
    USER_INTERFACE.AppBar.Plugins.setMenu(this.id, 'annotations-board-in-advanced-menu', 'Annotations Board', '', 'shape_line');
    this.context.history.openHistoryWindow(document.getElementById('annotations-board-in-advanced-menu'));
    this._openedHistoryMenu = true;
    if (focus) USER_INTERFACE.AppBar.Plugins.openSubmenu(this.id, 'annotations-board-in-advanced-menu');
  },

  _toggleAuthorShown(authorId) {
    this.context.toggleAuthorShown(authorId);
    this._populateAuthorsList();
  },

  _updateAuthorBorderColor(authorId, color) {
    this.context.updateAuthorBorderColor(authorId, color);
  },

  _updateAuthorBorderDashing(authorId, dashing) {
    this.context.updateAuthorBorderDashing(authorId, dashing);
  },

  _toggleAuthorIgnoreCustomStyling(authorId) {
    this.context.updateAuthorIgnoreCustomStyling(authorId, !this.context.getAuthorConfig(authorId).ignoreCustomStyling);
    this._populateAuthorsList();
  },

  _populateAuthorsList() {
    const authorListContainer = document.getElementById('author-list-inner-mp');
    if (!authorListContainer) return;

    // todo check this code, it smells
    const objects = this.context.fabric.canvas.getObjects();
    const authorCounts = new Map();

    objects.forEach((obj) => {
      if (this.context.isAnnotation(obj) && obj.author) {
        const author = this.context.mapAuthorCallback?.(obj) ?? obj.author;
        if (author === this.user.id) return;
        authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
      }
    });

    authorListContainer.replaceChildren();
    if (authorCounts.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-muted text-small p-2';
      empty.textContent = this.t('annotations.authors.empty');
      authorListContainer.appendChild(empty);
      return;
    }

    const sortedAuthors = Array.from(authorCounts.keys()).sort();
    sortedAuthors.forEach((author) => {
      const count = authorCounts.get(author);
      const config = this.context.getAuthorConfig(author);
      const wrapper = document.createElement('div');
      wrapper.className = 'author-item p-2 border-bottom border-secondary';
      if (!config.shown) wrapper.style.opacity = '0.6';

      const head = document.createElement('div');
      head.className = 'd-flex align-items-center mb-2';
      const icon = document.createElement('span');
      icon.className = 'material-icons mr-2';
      icon.textContent = 'person';
      const title = document.createElement('span');
      title.className = 'author-name';
      title.textContent = author;
      head.append(icon, title);

      const toggles = document.createElement('div');
      toggles.className = 'd-flex align-items-center text-muted text-small ml-4 mb-2';
      const countLabel = document.createElement('span');
      countLabel.className = 'mr-2';
      countLabel.textContent = this.t('annotations.authors.annotationCount', { count });

      const shown = document.createElement('input');
      shown.type = 'checkbox';
      shown.disabled = true;
      shown.checked = config.shown;
      const shownLabel = document.createElement('label');
      shownLabel.className = 'text-small ml-1 mr-3';
      shownLabel.textContent = this.t('annotations.authors.show');

      const ignore = document.createElement('input');
      ignore.type = 'checkbox';
      ignore.checked = config.ignoreCustomStyling;
      ignore.addEventListener('change', () => this._toggleAuthorIgnoreCustomStyling(author));
      const ignoreLabel = document.createElement('label');
      ignoreLabel.className = 'text-small ml-1';
      ignoreLabel.textContent = this.t('annotations.authors.ignoreStyling');

      toggles.append(countLabel, shown, shownLabel, ignore, ignoreLabel);

      const controls = document.createElement('div');
      controls.className = 'ml-4';

      const colorRow = document.createElement('div');
      colorRow.className = 'd-flex align-items-center mb-1';
      const colorLabel = document.createElement('label');
      colorLabel.className = 'text-small mr-2';
      colorLabel.style.minWidth = '60px';
      colorLabel.textContent = this.t('annotations.authors.color');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = config.borderColor;
      colorInput.className = 'form-control form-control-sm';
      colorInput.style.width = '50px';
      colorInput.style.height = '25px';
      colorInput.style.padding = '1px';
      colorInput.addEventListener('change', () => this._updateAuthorBorderColor(author, colorInput.value));
      colorRow.append(colorLabel, colorInput);

      const dashRow = document.createElement('div');
      dashRow.className = 'd-flex align-items-center';
      const dashLabel = document.createElement('label');
      dashLabel.className = 'text-small mr-2';
      dashLabel.style.minWidth = '60px';
      dashLabel.textContent = this.t('annotations.authors.dash');
      const dashInput = document.createElement('input');
      dashInput.type = 'range';
      dashInput.min = '1';
      dashInput.max = '50';
      dashInput.value = config.borderDashing;
      dashInput.className = 'form-control-range flex-grow-1 mr-2';
      const dashValue = document.createElement('span');
      dashValue.className = 'text-small';
      dashValue.style.minWidth = '20px';
      dashValue.textContent = `${config.borderDashing}`;
      dashInput.addEventListener('input', () => {
        dashValue.textContent = dashInput.value;
      });
      dashInput.addEventListener('change', () => this._updateAuthorBorderDashing(author, dashInput.value));
      dashRow.append(dashLabel, dashInput, dashValue);

      controls.append(colorRow, dashRow);
      wrapper.append(head, toggles, controls);
      authorListContainer.appendChild(wrapper);
    });
  }
};
