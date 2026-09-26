const fs = require('fs');
const path = require('path');
const p = 'd:\\Projects\\labrepo\\clerk-astro\\src\\pages\\admin.astro';
let content = fs.readFileSync(p, 'utf-8');

// 1. Add Tab Button
if (!content.includes('data-tab="announcements"')) {
  content = content.replace(
    '<button class="admin-tab" data-tab="users">',
    '<button class="admin-tab" data-tab="announcements"><i class="bi bi-megaphone"></i> Announcements</button>\n          <button class="admin-tab" data-tab="users">'
  );
}

// 2. Add Section Content
const sectionHtml = `
        <!-- Announcements Tab -->
        <div id="tab-announcements" class="admin-tab-content" style="display: none;">
          <div class="flex items-center justify-between" style="margin-bottom: 2rem;">
            <h2 class="text-display-lg"><i class="bi bi-megaphone text-muted" style="margin-right: 12px;"></i>Announcements</h2>
            <button class="btn btn--primary" id="btn-create-announcement"><i class="bi bi-plus-lg"></i> New Announcement</button>
          </div>

          <div id="announcement-form-container" class="admin-card mb-6" style="display: none; text-align: left;">
            <h3 class="text-body-strong mb-4" id="announcement-form-title">Create Announcement</h3>
            <form id="announcement-form" class="stack">
              <input type="hidden" id="announcement-id" />
              <div class="form-group">
                <label class="form-label">Title <span class="text-danger">*</span></label>
                <input type="text" id="announcement-title" class="form-input" required />
              </div>
              <div class="form-group">
                <label class="form-label">Message <span class="text-danger">*</span></label>
                <textarea id="announcement-message" class="form-input" rows="2" required></textarea>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <select id="announcement-type" class="form-input">
                    <option value="info">Info</option>
                    <option value="success">Success</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Status</label>
                  <select id="announcement-status" class="form-input">
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="form-group">
                  <label class="form-label">Action URL (Optional)</label>
                  <input type="url" id="announcement-url" class="form-input" placeholder="https://..." />
                </div>
                <div class="form-group">
                  <label class="form-label">Action Label</label>
                  <input type="text" id="announcement-url-label" class="form-input" placeholder="Learn more" />
                </div>
              </div>
              <div class="flex gap-2 mt-4">
                <button type="submit" class="btn btn--primary" id="btn-save-announcement">Save</button>
                <button type="button" class="btn btn--secondary" id="btn-cancel-announcement">Cancel</button>
              </div>
            </form>
          </div>

          <div class="admin-card" style="padding: 0; overflow: hidden; text-align: left;">
            <div id="announcements-list">
              <div class="admin-list__placeholder text-muted text-caption">Loading announcements...</div>
            </div>
          </div>
        </div>
`;

if (!content.includes('id="tab-announcements"')) {
  content = content.replace(
    '<div id="tab-users" class="admin-tab-content"',
    sectionHtml + '\n        <div id="tab-users" class="admin-tab-content"'
  );
}

// 3. Add JS functions
const jsHtml = `
        // ===== Announcements =====
        async function loadAnnouncements() {
          const list = document.getElementById('announcements-list');
          if (!list) return;
          list.innerHTML = '<div class="admin-list__placeholder text-muted text-caption">Loading...</div>';
          try {
            const res = await api.getAdminAnnouncements();
            if (!res.announcements || res.announcements.length === 0) {
              list.innerHTML = '<div class="admin-list__placeholder text-muted text-caption">No announcements found.</div>';
              return;
            }
            list.innerHTML = res.announcements.map((a) => \`
              <div class="border-b border-white/10 p-4 flex items-center justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2 mb-1">
                    <span class="hawkins-badge" style="background: var(--color-surface-hover); color: var(--color-ink-muted); font-size: 0.6rem; padding: 2px 8px;">\${a.type.toUpperCase()}</span>
                    <strong class="text-body-strong">\${a.title}</strong>
                    \${a.isActive ? '<span style="color: #49b87a; font-size: 0.8rem;"><i class="bi bi-check-circle-fill"></i> Active</span>' : '<span class="text-muted" style="font-size: 0.8rem;">Inactive</span>'}
                  </div>
                  <p class="text-caption text-muted">\${a.message}</p>
                </div>
                <div class="flex gap-2 shrink-0">
                  <button class="btn btn--secondary-pill btn--sm btn-edit-ann" data-id="\${a.id}" data-json='\${JSON.stringify(a).replace(/'/g, "&#39;")}'>Edit</button>
                  <button class="btn btn--ghost btn--sm btn-delete-ann" data-id="\${a.id}" style="color: #ff6666;"><i class="bi bi-trash3"></i></button>
                </div>
              </div>
            \`).join('');

            list.querySelectorAll('.btn-edit-ann').forEach((btn) => {
              btn.addEventListener('click', () => {
                const data = JSON.parse(btn.getAttribute('data-json'));
                document.getElementById('announcement-id').value = data.id;
                document.getElementById('announcement-title').value = data.title;
                document.getElementById('announcement-message').value = data.message;
                document.getElementById('announcement-type').value = data.type;
                document.getElementById('announcement-status').value = data.isActive ? '1' : '0';
                document.getElementById('announcement-url').value = data.url || '';
                document.getElementById('announcement-url-label').value = data.urlLabel || '';
                document.getElementById('announcement-form-title').textContent = 'Edit Announcement';
                document.getElementById('announcement-form-container').style.display = 'block';
              });
            });

            list.querySelectorAll('.btn-delete-ann').forEach((btn) => {
              btn.addEventListener('click', async () => {
                if (confirm('Delete this announcement?')) {
                  const id = btn.getAttribute('data-id');
                  await api.deleteAdminAnnouncement(id);
                  showToast('Announcement deleted', 'success');
                  loadAnnouncements();
                }
              });
            });
          } catch (e) {
            list.innerHTML = '<div class="admin-list__placeholder text-danger text-caption">Failed to load announcements.</div>';
          }
        }

        document.getElementById('btn-create-announcement')?.addEventListener('click', () => {
          document.getElementById('announcement-form').reset();
          document.getElementById('announcement-id').value = '';
          document.getElementById('announcement-form-title').textContent = 'Create Announcement';
          document.getElementById('announcement-form-container').style.display = 'block';
        });

        document.getElementById('btn-cancel-announcement')?.addEventListener('click', () => {
          document.getElementById('announcement-form-container').style.display = 'none';
        });

        document.getElementById('announcement-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const id = document.getElementById('announcement-id').value;
          const data = {
            title: document.getElementById('announcement-title').value,
            message: document.getElementById('announcement-message').value,
            type: document.getElementById('announcement-type').value,
            isActive: parseInt(document.getElementById('announcement-status').value) === 1,
            url: document.getElementById('announcement-url').value || null,
            urlLabel: document.getElementById('announcement-url-label').value || null,
          };
          try {
            if (id) {
              await api.updateAdminAnnouncement(id, data);
              showToast('Announcement updated', 'success');
            } else {
              await api.createAdminAnnouncement(data);
              showToast('Announcement created', 'success');
            }
            document.getElementById('announcement-form-container').style.display = 'none';
            loadAnnouncements();
          } catch (err) {
            showToast('Failed to save announcement', 'error');
          }
        });
`;

if (!content.includes('loadAnnouncements()')) {
  content = content.replace(
    '// ===== Users list =====',
    jsHtml + '\n\n        // ===== Users list ====='
  );
}

// Add loadAnnouncements() to initial load
if (!content.includes('await loadAnnouncements();')) {
  content = content.replace(
    'await loadOverview();',
    'await loadOverview();\n        await loadAnnouncements();'
  );
}

// Add tab listener logic
if (!content.includes('if (tabId === "announcements") loadAnnouncements();')) {
  content = content.replace(
    'if (tabId === "overview") loadOverview();',
    'if (tabId === "overview") loadOverview();\n            if (tabId === "announcements") loadAnnouncements();'
  );
}

fs.writeFileSync(p, content);
console.log('Injected announcements logic to admin.astro');
