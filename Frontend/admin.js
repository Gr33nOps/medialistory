const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '/api';

let authToken   = localStorage.getItem('authToken');
let currentUser = (typeof getStoredUser === 'function') ? getStoredUser() : null;

let usersPage    = 1;
let activityPage = 1;
const itemsPerPage = 20;

let banUserId    = null;
let deleteUserId = null;

(async function bootAdmin() {
    if (typeof ensureSession === 'function') {
        try { await ensureSession(); } catch (_) {}
    }
    authToken = localStorage.getItem('authToken');
    currentUser = (typeof getStoredUser === 'function') ? getStoredUser() : null;
    if (!authToken) {
        window.location.href = (typeof authUrlWithNext === 'function' ? authUrlWithNext() : 'auth.html');
        return;
    }
    verifyAdmin();
})();

async function verifyAdmin() {
    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            credentials: 'same-origin',
            cache: 'no-store'
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            localStorage.setItem('currentUser', JSON.stringify(data.user));

            if (!currentUser.is_admin) {
                notify('Access denied. Admin privileges required.');
                window.location.href = currentUser.is_moderator
                    ? 'moderator.html'
                    : 'home.html';
                return;
            }

            initPage();
        } else if (response.status === 401 || response.status === 403) {
            logout();
        } else if (currentUser && currentUser.is_admin) {
            initPage();
        }
    } catch (error) {
        console.error('Verify token error:', error);
        if (currentUser && currentUser.is_admin) initPage();
    }
}

function initPage() {
    document.querySelectorAll('.admin-tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            switchTab(btn.dataset.tab);
        });
    });

    document.getElementById('confirmBan').addEventListener('click', handleBanUser);
    document.getElementById('cancelBan').addEventListener('click', closeBanModal);
    document.getElementById('closeBanModal').addEventListener('click', closeBanModal);

    document.getElementById('confirmDeleteUser').addEventListener('click', handleDeleteUser);
    document.getElementById('cancelDeleteUser').addEventListener('click', closeDeleteUserModal);
    document.getElementById('closeDeleteUserModal').addEventListener('click', closeDeleteUserModal);

    document.getElementById('searchUsersBtn').addEventListener('click', function() {
        usersPage = 1;
        loadUsers();
    });

    document.getElementById('filterActivityBtn').addEventListener('click', function() {
        activityPage = 1;
        loadActivity();
    });

    document.getElementById('searchUsers').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            usersPage = 1;
            loadUsers();
        }
    });

    document.getElementById('prevUsersPage').addEventListener('click', function() {
        if (usersPage > 1) {
            usersPage--;
            loadUsers();
        }
    });

    document.getElementById('nextUsersPage').addEventListener('click', function() {
        usersPage++;
        loadUsers();
    });

    document.getElementById('prevActivityPage').addEventListener('click', function() {
        if (activityPage > 1) {
            activityPage--;
            loadActivity();
        }
    });

    document.getElementById('nextActivityPage').addEventListener('click', function() {
        activityPage++;
        loadActivity();
    });

    if (typeof bindModal === 'function') {
        bindModal('banModal', 'closeBanModal');
        bindModal('deleteUserModal', 'closeDeleteUserModal');
    } else {
        document.getElementById('banModal').addEventListener('click', function(e) {
            if (e.target.id === 'banModal') closeBanModal();
        });
        document.getElementById('deleteUserModal').addEventListener('click', function(e) {
            if (e.target.id === 'deleteUserModal') closeDeleteUserModal();
        });
    }

    loadStats();
    loadUsers();
}

function switchTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach(function(btn) {
        btn.classList.remove('active');
    });
    document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');

    document.querySelectorAll('.admin-section').forEach(function(section) {
        section.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    if (tabName === 'manage-users') loadUsers();
    if (tabName === 'activity-log') loadActivity();
}

async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/admin/stats`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const stats = await response.json();
            document.getElementById('totalUsers').textContent      = stats.totalUsers      || 0;
            document.getElementById('totalModerators').textContent = stats.totalModerators || 0;
            document.getElementById('bannedUsers').textContent     = stats.bannedUsers     || 0;
        }
    } catch (error) {
        console.error('Load stats error:', error);
    }
}

async function loadUsers() {
    const tbody   = document.getElementById('usersTableBody');
    const loading = document.getElementById('usersTableLoading');
    const search  = document.getElementById('searchUsers').value.trim();

    loading.style.display = 'flex';
    tbody.innerHTML = '';

    try {
        const offset = (usersPage - 1) * itemsPerPage;
        const params = new URLSearchParams({ limit: itemsPerPage, offset: offset });
        if (search) params.append('search', search);

        const response = await fetch(`${API_BASE}/admin/users?${params}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            displayUsers(data.users);
            updateUsersPagination(data.users.length === itemsPerPage);
        } else {
            const err = await response.json().catch(function() { return { error: 'Unknown error' }; });
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Error: ' + esc(err.error) + '</td></tr>';
        }
    } catch (error) {
        console.error('Load users error:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Network Error: ' + esc(error.message) + '</td></tr>';
    } finally {
        loading.style.display = 'none';
    }
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(function(user) {
        const userId      = user.id;
        const username    = esc(user.username || '');
        const email       = esc(user.email || 'N/A');
        const displayName = esc(user.display_name || 'N/A');
        const joinDate    = user.created_at   ? esc(new Date(user.created_at).toLocaleDateString()) : 'N/A';

        const isCurrentUser = userId === currentUser.id;
        const isBanned      = user.is_banned;
        const isModerator   = user.is_moderator;
        const isAdmin       = user.is_admin;

        var statusBadge;
        if (isBanned) {
            const bannedDate = user.banned_at ? esc(new Date(user.banned_at).toLocaleDateString()) : '';
            statusBadge = '<span class="banned-badge" title="Banned on ' + bannedDate + '">Banned</span>';
        } else {
            statusBadge = '<span style="color:#22c55e;">Active</span>';
        }

        var roleBadge;
        if (isAdmin)          roleBadge = '<span class="admin-badge">Admin</span>';
        else if (isModerator) roleBadge = '<span class="moderator-badge">Moderator</span>';
        else                  roleBadge = '<span style="color:#94a3b8;">User</span>';

        var actionButtons;
        if (isCurrentUser) {
            actionButtons = '<span style="color:#94a3b8;font-size:0.85rem;">Current User</span>';
        } else if (isAdmin) {
            actionButtons = '<span style="color:#fbbf24;font-size:0.85rem;">Admin (Protected)</span>';
        } else {
            const banBtn = isBanned
                ? '<button class="btn btn-success btn-sm" data-action="unban"   data-user-id="' + esc(userId) + '" data-username="' + username + '">Unban</button>'
                : '<button class="btn btn-warning btn-sm" data-action="ban"     data-user-id="' + esc(userId) + '" data-username="' + username + '">Ban</button>';
            const roleBtn = isModerator
                ? '<button class="btn btn-secondary btn-sm" data-action="demote"  data-user-id="' + esc(userId) + '" data-username="' + username + '">Demote</button>'
                : '<button class="btn btn-primary btn-sm"   data-action="promote" data-user-id="' + esc(userId) + '" data-username="' + username + '">Promote</button>';
            const deleteBtn = '<button class="btn btn-danger btn-sm" data-action="delete" data-user-id="' + esc(userId) + '" data-username="' + username + '">Delete</button>';

            actionButtons = banBtn + ' ' + roleBtn + ' ' + deleteBtn;
        }

        return '<tr class="admin-user-row">' +
            '<td data-label="ID" class="cell-id" title="' + esc(userId) + '">' + esc(userId.substring(0, 8)) + '...</td>' +
            '<td data-label="Username"><strong>' + username + '</strong></td>' +
            '<td data-label="Email">' + email + '</td>' +
            '<td data-label="Display">' + displayName + '</td>' +
            '<td data-label="Role">' + roleBadge + '</td>' +
            '<td data-label="Status">' + statusBadge + '</td>' +
            '<td data-label="Joined">' + joinDate + '</td>' +
            '<td data-label="Actions" class="cell-actions">' + actionButtons + '</td>' +
            '</tr>';
    }).join('');

    tbody.querySelectorAll('button[data-action]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const action   = btn.dataset.action;
            const userId   = btn.dataset.userId;
            const username = btn.dataset.username;

            if (action === 'ban')     confirmBanUser(userId, username);
            if (action === 'unban')   unbanUser(userId, username);
            if (action === 'promote') promoteModerator(userId, username);
            if (action === 'demote')  demoteModerator(userId, username);
            if (action === 'delete')  confirmDeleteUser(userId, username);
        });
    });
}

function updateUsersPagination(hasMore) {
    document.getElementById('prevUsersPage').disabled = usersPage === 1;
    document.getElementById('nextUsersPage').disabled = !hasMore;
    document.getElementById('usersPageInfo').textContent = 'Page ' + usersPage;
}

async function promoteModerator(userId, username) {
    const name = username.replace(/&#39;/g, "'");
    var ok = typeof confirmAction === 'function'
        ? await confirmAction({
            title: 'Promote to Moderator',
            message: 'Promote "' + name + '" to Moderator?\n\nThey will be able to:\n- Ban/unban regular users\n- Manage games\n- View activity logs',
            confirmLabel: 'Promote'
          })
        : window.confirm('Promote "' + name + '" to Moderator?');
    if (!ok) return;

    try {
        const r = await fetch(`${API_BASE}/admin/users/${userId}/promote`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (r.ok) {
            loadUsers();
            loadStats();
        } else {
            const d = await r.json();
            notify(d.error || 'Failed to promote user');
        }
    } catch (e) {
        notify('Network error. Please try again.');
    }
}

async function demoteModerator(userId, username) {
    const name = username.replace(/&#39;/g, "'");
    var ok = typeof confirmAction === 'function'
        ? await confirmAction({
            title: 'Demote moderator',
            message: 'Demote "' + name + '" to regular user?\n\nThey will lose moderator privileges.',
            confirmLabel: 'Demote',
            danger: true
          })
        : window.confirm('Demote "' + name + '" to regular user?');
    if (!ok) return;

    try {
        const r = await fetch(`${API_BASE}/admin/users/${userId}/demote`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (r.ok) {
            loadUsers();
            loadStats();
        } else {
            const d = await r.json();
            notify(d.error || 'Failed to demote moderator');
        }
    } catch (e) {
        notify('Network error. Please try again.');
    }
}

function confirmBanUser(userId, username) {
    banUserId = userId;
    document.getElementById('banUsername').textContent = username.replace(/&#39;/g, "'");
    document.getElementById('banReason').value         = '';
    document.getElementById('banMessage').innerHTML    = '';
    if (typeof openModal === 'function') {
        openModal('banModal', {
            focusSelector: '#banReason',
            titleId: 'banModalTitle',
            onClose: function() { banUserId = null; }
        });
    } else {
        document.getElementById('banModal').style.display = 'flex';
    }
}

async function handleBanUser() {
    if (!banUserId) return;

    const reason     = document.getElementById('banReason').value.trim();
    const btn        = document.getElementById('confirmBan');
    const messageDiv = document.getElementById('banMessage');

    btn.disabled    = true;
    btn.textContent = 'Banning...';
    messageDiv.innerHTML = '';

    try {
        const r = await fetch(`${API_BASE}/admin/users/${banUserId}/ban`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ reason: reason || null })
        });
        const d = await r.json();

        if (r.ok) {
            showSuccess(messageDiv, 'User banned successfully!');
            setTimeout(function() {
                closeBanModal();
                loadUsers();
                loadStats();
            }, 1500);
        } else {
            showError(messageDiv, d.error || 'Failed to ban user');
            btn.disabled    = false;
            btn.textContent = 'Ban User';
        }
    } catch (e) {
        showError(messageDiv, 'Network error. Please try again.');
        btn.disabled    = false;
        btn.textContent = 'Ban User';
    }
}

async function unbanUser(userId, username) {
    const name = username.replace(/&#39;/g, "'");
    var ok = typeof confirmAction === 'function'
        ? await confirmAction({
            title: 'Unban user',
            message: 'Unban "' + name + '"?',
            confirmLabel: 'Unban'
          })
        : window.confirm('Unban "' + name + '"?');
    if (!ok) return;

    try {
        const r = await fetch(`${API_BASE}/admin/users/${userId}/unban`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (r.ok) {
            loadUsers();
            loadStats();
        } else {
            const d = await r.json();
            notify(d.error || 'Failed to unban user');
        }
    } catch (e) {
        notify('Network error. Please try again.');
    }
}

function closeBanModal() {
    if (typeof closeModal === 'function') closeModal('banModal');
    else document.getElementById('banModal').style.display = 'none';
    banUserId = null;
    document.getElementById('banReason').value      = '';
    document.getElementById('banMessage').innerHTML = '';
    const btn = document.getElementById('confirmBan');
    btn.disabled    = false;
    btn.textContent = 'Ban User';
}

function confirmDeleteUser(userId, username) {
    deleteUserId = userId;
    const name = username.replace(/&#39;/g, "'");
    document.getElementById('deleteUserMessage').textContent =
        'Are you sure you want to PERMANENTLY DELETE "' + name + '"? This will delete ALL their data and cannot be undone.';
    if (typeof openModal === 'function') {
        openModal('deleteUserModal', { onClose: function() { deleteUserId = null; } });
    } else {
        document.getElementById('deleteUserModal').style.display = 'flex';
    }
}

async function handleDeleteUser() {
    if (!deleteUserId) return;

    const btn = document.getElementById('confirmDeleteUser');
    btn.disabled    = true;
    btn.textContent = 'Deleting...';

    try {
        const r = await fetch(`${API_BASE}/admin/users/${deleteUserId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (r.ok) {
            closeDeleteUserModal();
            loadUsers();
            loadStats();
        } else {
            const d = await r.json();
            notify(d.error || 'Failed to delete user');
            btn.disabled    = false;
            btn.textContent = 'Delete Permanently';
        }
    } catch (e) {
        notify('Network error. Please try again.');
        btn.disabled    = false;
        btn.textContent = 'Delete Permanently';
    }
}

function closeDeleteUserModal() {
    if (typeof closeModal === 'function') closeModal('deleteUserModal');
    else document.getElementById('deleteUserModal').style.display = 'none';
    deleteUserId = null;
    const btn = document.getElementById('confirmDeleteUser');
    btn.disabled    = false;
    btn.textContent = 'Delete Permanently';
}

async function loadActivity() {
    const tbody   = document.getElementById('activityTableBody');
    const loading = document.getElementById('activityTableLoading');
    const filter  = document.getElementById('activityFilter').value;

    loading.style.display = 'flex';
    tbody.innerHTML = '';

    try {
        const offset = (activityPage - 1) * itemsPerPage;
        const params = new URLSearchParams({ limit: itemsPerPage, offset: offset });
        if (filter) params.append('action_type', filter);

        const r = await fetch(`${API_BASE}/admin/activity?${params}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (r.ok) {
            const data = await r.json();
            displayActivity(data.activities || []);
            updateActivityPagination((data.activities || []).length === itemsPerPage);
        } else {
            const err = await r.json().catch(function() { return { error: 'Unknown error' }; });
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Error: ' + esc(err.error) + '</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Network Error: ' + esc(e.message) + '</td></tr>';
    } finally {
        loading.style.display = 'none';
    }
}

function displayActivity(activities) {
    const tbody = document.getElementById('activityTableBody');

    if (!activities || activities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No activity found</td></tr>';
        return;
    }

    tbody.innerHTML = activities.map(function(a) {
        const dateStr = esc(new Date(a.created_at).toLocaleString());
        var rawDetails = a.details || '-';
        var details = esc(rawDetails);
        var target  = esc(a.target_username || a.target_name || ('ID: ' + a.target_id));

        switch (a.action_type) {
            case 'seed_games': {
                target = '<span style="color:#a5b4fc;font-weight:600;">Automatic Import</span>';
                const m = String(rawDetails).match(/Pages:\s*(\d+)\s*to\s*(\d+).*Added:\s*(\d+)/);
                if (m) {
                    details = '<div style="line-height:1.8;"><strong style="color:#a5b4fc;">Imported pages ' + esc(m[1]) + '-' + esc(m[2]) + '</strong><br><span style="color:#86efac;">' + esc(m[3]) + ' games added</span></div>';
                } else {
                    details = '<span style="color:#a5b4fc;">' + details + '</span>';
                }
                break;
            }
            case 'add_game':
                target  = '<span style="color:#86efac;">' + esc(a.target_name || a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#cbd5e1;">' + (rawDetails !== '-' ? details : 'Added manually') + '</span>';
                break;
            case 'edit_game':
                target  = '<span style="color:#fbbf24;">' + esc(a.target_name || a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#cbd5e1;">' + details + '</span>';
                break;
            case 'delete_game':
                target  = '<span style="color:#fca5a5;">' + esc(a.target_name || a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#cbd5e1;">' + details + '</span>';
                break;
            case 'ban_user':
                target  = '<span style="color:#fca5a5;">' + esc(a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#fca5a5;">Reason: ' + details + '</span>';
                break;
            case 'unban_user':
                target  = '<span style="color:#86efac;">' + esc(a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#86efac;">' + details + '</span>';
                break;
            case 'promote_moderator':
            case 'demote_moderator':
                target  = '<span style="color:#a5b4fc;">' + esc(a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#cbd5e1;">' + details + '</span>';
                break;
            case 'delete_user':
                target  = '<span style="color:#ef4444;">' + esc(a.target_username || ('ID: ' + a.target_id)) + '</span>';
                details = '<span style="color:#fca5a5;">' + details + '</span>';
                break;
        }

        return '<tr>' +
            '<td style="white-space:nowrap;">' + dateStr + '</td>' +
            '<td><strong style="color:#e2e8f0;">' + esc(a.moderator_username || 'Unknown') + '</strong></td>' +
            '<td><span class="action-badge">' + esc(formatActionType(a.action_type)) + '</span></td>' +
            '<td>' + target + '</td>' +
            '<td style="max-width:450px;word-wrap:break-word;">' + details + '</td>' +
            '</tr>';
    }).join('');
}

function updateActivityPagination(hasMore) {
    document.getElementById('prevActivityPage').disabled = activityPage === 1;
    document.getElementById('nextActivityPage').disabled = !hasMore;
    document.getElementById('activityPageInfo').textContent = 'Page ' + activityPage;
}

function formatActionType(actionType) {
    const map = {
        ban_user:          'Ban User',
        unban_user:        'Unban User',
        add_game:          'Add Game',
        edit_game:         'Edit Game',
        delete_game:       'Delete Game',
        seed_games:        'Bulk Import',
        promote_moderator: 'Promote Mod',
        demote_moderator:  'Demote Mod',
        delete_user:       'Delete User'
    };
    return map[actionType] || actionType;
}

function logout() {
    if (typeof logoutToAuth === 'function') logoutToAuth();
    else {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.location.href = 'auth.html';
    }
}

function showError(el, msg) {
    el.innerHTML = '<div class="error" style="padding:12px;background:rgba(239,68,68,.1);border:1px solid #ef4444;border-radius:6px;color:#fca5a5;margin:15px 0;">' + esc(msg) + '</div>';
}

function showSuccess(el, msg) {
    el.innerHTML = '<div class="success" style="padding:12px;background:rgba(34,197,94,.1);border:1px solid #22c55e;border-radius:6px;color:#86efac;margin:15px 0;">' + esc(msg) + '</div>';
}