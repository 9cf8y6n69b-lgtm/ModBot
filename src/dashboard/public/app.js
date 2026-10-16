/**
 * ModBot — Modern Arabic Minimalist Glassmorphism Controller
 * 1:1 Clean Reactive Architecture & Multi-Tenant Discord OAuth2 Engine
 */

// ----------------------------------------------------
// Global Client State & Multi-Tenant Store
// ----------------------------------------------------
const AppState = {
    isAuthenticated: false,
    currentUser: null,
    currentGuildId: null,
    userGuilds: [],
    activeTab: 'overview',
    isGuildSwitching: false,
    lastRateLimitAlert: 0,
    pollingInterval: null,
    getActiveGuild() {
        if (!this.currentGuildId || !Array.isArray(this.userGuilds)) return null;
        return this.userGuilds.find(g => String(g.id) === String(this.currentGuildId)) || null;
    }
};
window.AppState = AppState;

// ----------------------------------------------------
// Unified API Fetch Interceptor & Error Handler
// ----------------------------------------------------
const nativeFetch = window.fetch.bind(window);

async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (AppState.currentGuildId && !headers.has('x-guild-id')) {
        headers.set('x-guild-id', String(AppState.currentGuildId));
    }
    if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
    }
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        body = JSON.stringify(body);
    }
    const config = {
        ...options,
        headers,
        body,
        credentials: 'same-origin'
    };
    try {
        const response = await nativeFetch(url, config);
        if (!response.ok) {
            handleApiError(response.status, url);
        }
        return response;
    } catch (networkError) {
        console.error(`[API Network Error] ${url}:`, networkError);
        if (networkError.name !== 'AbortError') {
            showToast('خطأ في الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت', 'error');
        }
        throw networkError;
    }
}
window.apiFetch = apiFetch;
window.fetch = async function(url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api')) {
        return apiFetch(url, options);
    }
    return nativeFetch(url, options);
};

function handleApiError(status, url) {
    switch (status) {
        case 401:
            stopBackgroundPolling();
            AppState.isAuthenticated = false;
            AppState.currentUser = null;
            renderAuthState(false);
            const expiredModal = document.getElementById('sessionExpiredModal');
            if (expiredModal) expiredModal.style.display = 'flex';
            break;
        case 403:
            showToast('ليس لديك صلاحيات كافية في هذا السيرفر لإتمام الإجراء', 'error');
            break;
        case 429:
            const now = Date.now();
            if (now - AppState.lastRateLimitAlert > 4000) {
                AppState.lastRateLimitAlert = now;
                showToast('تم تجاوز الحد المسموح به من الطلبات (30 طلب/دقيقة). يرجى الانتظار قليلاً.', 'warning');
            }
            break;
    }
}

function startBackgroundPolling() {
    stopBackgroundPolling();
    AppState.pollingInterval = setInterval(() => {
        if (AppState.isAuthenticated && document.visibilityState !== 'hidden') {
            fetchStats(true);
            fetchCases(true);
        }
    }, 5000);
}

function stopBackgroundPolling() {
    if (AppState.pollingInterval) {
        clearInterval(AppState.pollingInterval);
        AppState.pollingInterval = null;
    }
}

let allCases = [];
let allWarnings = [];
let allTickets = [];
let activeCaseFilter = 'all';
let casesSearchQuery = '';
let warnsSearchQuery = '';
let ticketsSearchQuery = '';
let filteredWordsList = [];
let currentGuildConfig = null;
let currentDefaultConfig = null;
let cachedConfigPayload = null;
let currentAnalyticsDays = 7;
let analyticsChartInstance = null;
let activeTranscriptText = '';

let embedStudioFields = [];
let embedStudioButtons = [];
let savedEmbedTemplates = [];

const PAGE_META = {
    overview: {
        title: 'الرئيسية والتحليلات',
        sub: 'نظرة شاملة على نشاط السيرفر، المقاييس الحية، ومخططات المخالفات.'
    },
    'embed-studio': {
        title: 'استوديو الإمبد والبث',
        sub: 'تصميم ونشر رسائل الإمبد التفاعلية مع معاينة حية 1:1 ونشر فوري.'
    },
    security: {
        title: 'إعدادات البروتكشن والأوتومود',
        sub: 'تخصيص الفلاتر التلقائية، درع مكافحة التخريب (Anti-Nuke)، وعزل النصابين والسكامرز.'
    },
    cases: {
        title: 'سجل الرقابة والعقوبات',
        sub: 'أرشيف كامل وقابل للبحث لعمليات الحظر، الكتم، الطرد، والتحذيرات السارية.'
    },
    tickets: {
        title: 'نظام التكتات والدعم',
        sub: 'متابعة تكتات الأعضاء، مراجعة المحادثات المؤرشفة، وضبط إعدادات الدعم.'
    },
    settings: {
        title: 'الإعدادات والباك اب',
        sub: 'ربط قنوات السجلات، إدارة الرتب الأساسية والتحقق، وإدارة الباك اب.'
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSidebarToggle();
    initFilters();
    initSearch();
    initBannedWordsManager();
    initActionButtons();
    initExportButtons();
    initDirtyStateListeners();
    initEmbedStudio();
    initGuildSelector();

    // Authenticate and Bootstrap
    bootstrapAuth();
});

// ----------------------------------------------------
// Authentication & Guild Bootstrap Lifecycle
// ----------------------------------------------------
async function bootstrapAuth() {
    try {
        const res = await nativeFetch('/auth/me', { credentials: 'same-origin' });
        if (!res.ok) {
            renderAuthState(false);
            return;
        }
        const data = await res.json();
        if (data && data.authenticated && data.user) {
            AppState.isAuthenticated = true;
            AppState.currentUser = data.user;
            AppState.userGuilds = data.guilds || [];

            let activeId = data.activeGuildId;
            if (!activeId && AppState.userGuilds.length > 0) {
                const joined = AppState.userGuilds.find(g => g.botPresent);
                activeId = joined ? joined.id : AppState.userGuilds[0].id;
            }
            AppState.currentGuildId = activeId;

            renderAuthState(true);
            renderGuildSelectorDropdown();
            await fetchAllData();
            startBackgroundPolling();
        } else {
            AppState.isAuthenticated = false;
            AppState.currentUser = null;
            AppState.userGuilds = [];
            AppState.currentGuildId = null;
            renderAuthState(false);
        }
    } catch (err) {
        console.error('[Bootstrap Auth Error]:', err);
        renderAuthState(false);
    }
}

function renderAuthState(isAuthenticated) {
    const unauthNav = document.getElementById('navAuthUnauthenticated');
    const authNav = document.getElementById('navAuthAuthenticated');
    const authGate = document.getElementById('authGateOverlay');
    const userAvatar = document.getElementById('userNavAvatar');
    const userName = document.getElementById('userNavName');
    const userRole = document.getElementById('userNavRole');

    if (isAuthenticated && AppState.currentUser) {
        if (unauthNav) unauthNav.style.display = 'none';
        if (authNav) authNav.style.display = 'flex';
        if (authGate) authGate.style.display = 'none';

        if (userAvatar && AppState.currentUser.avatarUrl) {
            userAvatar.src = AppState.currentUser.avatarUrl;
        }
        if (userName) {
            userName.textContent = AppState.currentUser.globalName || AppState.currentUser.username || 'مستخدم';
        }
        if (userRole) {
            const activeGuild = AppState.getActiveGuild();
            userRole.textContent = activeGuild?.owner ? 'مالك السيرفر' : 'مدير معتمد';
        }
    } else {
        if (unauthNav) unauthNav.style.display = 'flex';
        if (authNav) authNav.style.display = 'none';
        if (authGate) authGate.style.display = 'flex';
    }
}

function initGuildSelector() {
    const wrapper = document.getElementById('guildSelectorWrapper');
    const trigger = document.getElementById('guildSelectorBtn');
    const searchInput = document.getElementById('guildSearchInput');
    const clearBtn = document.getElementById('btnGuildSearchClear');

    if (!trigger || !wrapper) return;

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.toggle('open');
        trigger.setAttribute('aria-expanded', String(isOpen));
        if (isOpen && searchInput) {
            searchInput.focus();
        }
    });

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            wrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
            filterGuildList(query);
        });
    }

    if (clearBtn && searchInput) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            filterGuildList('');
            searchInput.focus();
        });
    }
}

function filterGuildList(query) {
    const container = document.getElementById('guildListContainer');
    const emptyState = document.getElementById('guildEmptyState');
    if (!container) return;

    const items = container.querySelectorAll('.guild-item');
    let visibleCount = 0;

    items.forEach(item => {
        const name = (item.dataset.guildName || '').toLowerCase();
        const matches = !query || name.includes(query);
        item.style.display = matches ? 'flex' : 'none';
        if (matches) visibleCount++;
    });

    if (emptyState) {
        emptyState.style.display = visibleCount === 0 && query ? 'flex' : 'none';
    }
}

function renderGuildSelectorDropdown() {
    const listContainer = document.getElementById('guildListContainer');
    const nameEl = document.getElementById('selectedGuildName');
    const iconEl = document.getElementById('selectedGuildIcon');
    const initialsEl = document.getElementById('selectedGuildInitials');
    const badgeEl = document.getElementById('selectedGuildBadgeText');

    if (!listContainer) return;

    const activeGuild = AppState.getActiveGuild();
    if (activeGuild) {
        if (nameEl) nameEl.textContent = activeGuild.name;
        if (activeGuild.iconUrl && iconEl) {
            iconEl.src = activeGuild.iconUrl;
            iconEl.style.display = 'block';
            if (initialsEl) initialsEl.style.display = 'none';
        } else if (initialsEl) {
            if (iconEl) iconEl.style.display = 'none';
            initialsEl.textContent = (activeGuild.name || 'MB').slice(0, 2);
            initialsEl.style.display = 'block';
        }
        if (badgeEl) badgeEl.textContent = activeGuild.botPresent ? 'متصل' : 'غير مضاف';
    } else {
        if (nameEl) nameEl.textContent = 'اختر سيرفراً...';
        if (badgeEl) badgeEl.textContent = 'غير متصل';
    }

    listContainer.innerHTML = '';
    if (!AppState.userGuilds || AppState.userGuilds.length === 0) {
        listContainer.innerHTML = '<div class="guild-loading-placeholder"><span>لا توجد سيرفرات بإدارة حسابك</span></div>';
        return;
    }

    AppState.userGuilds.forEach(guild => {
        const isActive = String(guild.id) === String(AppState.currentGuildId);
        const item = document.createElement('div');
        item.className = `guild-item ${isActive ? 'active' : ''} ${guild.botPresent ? '' : 'unjoined'}`;
        item.dataset.guildId = guild.id;
        item.dataset.guildName = guild.name;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(isActive));
        item.tabIndex = 0;

        const initials = (guild.name || 'G').slice(0, 2);
        const iconHtml = guild.iconUrl
            ? `<img class="guild-item-icon-img" src="${guild.iconUrl}" alt="${guild.name}" loading="lazy">`
            : `<span class="guild-item-initials">${initials}</span>`;

        const badgeBotHtml = guild.botPresent
            ? `<span class="badge-bot-status joined"><span class="status-dot online"></span><span class="badge-text">متصل</span></span>`
            : `<span class="badge-bot-status unjoined"><span class="status-dot offline"></span><span class="badge-text">غير مضاف</span></span>`;

        const roleBadgeHtml = guild.owner
            ? `<span class="badge-role-owner">مالك</span>`
            : `<span class="badge-role-admin">مسؤول</span>`;

        const actionHtml = guild.botPresent
            ? (isActive ? `<svg class="guild-active-checkmark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>` : '')
            : `<a href="https://discord.com/oauth2/authorize?client_id=1555744745609887786&scope=bot%20applications.commands&permissions=8&guild_id=${guild.id}" target="_blank" rel="noopener noreferrer" class="btn-guild-invite" title="إضافة البوت لهذا السيرفر" onclick="event.stopPropagation();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>إضافة</span></a>`;

        item.innerHTML = `
            <div class="guild-item-icon-wrap">${iconHtml}</div>
            <div class="guild-item-info">
                <span class="guild-item-name" title="${guild.name}">${guild.name}</span>
                <div class="guild-item-badges">${badgeBotHtml}${roleBadgeHtml}</div>
            </div>
            <div class="guild-item-action">${actionHtml}</div>
        `;

        item.addEventListener('click', () => {
            if (guild.botPresent) {
                switchActiveGuild(guild.id);
            } else {
                window.open(`https://discord.com/oauth2/authorize?client_id=1555744745609887786&scope=bot%20applications.commands&permissions=8&guild_id=${guild.id}`, '_blank');
            }
        });

        listContainer.appendChild(item);
    });
}

async function switchActiveGuild(guildId) {
    if (AppState.isGuildSwitching || String(guildId) === String(AppState.currentGuildId)) return;
    AppState.isGuildSwitching = true;
    try {
        const res = await apiFetch('/api/guild/select', {
            method: 'POST',
            body: { guildId }
        });
        if (res.ok) {
            AppState.currentGuildId = guildId;
            const guild = AppState.getActiveGuild();
            renderGuildSelectorDropdown();
            const wrapper = document.getElementById('guildSelectorWrapper');
            if (wrapper) wrapper.classList.remove('open');
            showToast(`تم التبديل إلى سيرفر: ${guild?.name || guildId}`, 'success');
            await fetchAllData();
        }
    } catch (e) {
        console.error('Error switching guild:', e);
    } finally {
        AppState.isGuildSwitching = false;
    }
}

// ----------------------------------------------------
// Navigation & Breadcrumbs
// ----------------------------------------------------
function initNavigation() {
    const navLinks = document.querySelectorAll('.sidebar-item');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tab = link.dataset.tab;
            if (tab) switchTab(tab);
        });
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.sidebar-item').forEach(link => {
        link.classList.toggle('active', link.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });

    const meta = PAGE_META[tabId] || PAGE_META.overview;
    const titleEl = document.getElementById('viewTitle');
    const subEl = document.getElementById('viewSubtitle');
    const crumbActiveEl = document.getElementById('topCrumbActive');

    if (titleEl) titleEl.textContent = meta.title;
    if (subEl) subEl.textContent = meta.sub;
    if (crumbActiveEl) crumbActiveEl.textContent = meta.title;

    if (tabId === 'overview') {
        fetchStats();
        fetchAnalytics();
        fetchCases();
    }
    if (tabId === 'embed-studio') {
        fetchEmbedTemplates();
        fetchConfig();
    }
    if (tabId === 'security') {
        fetchConfig();
    }
    if (tabId === 'cases') {
        fetchCases();
        fetchWarnings();
    }
    if (tabId === 'tickets') {
        fetchTickets();
        fetchConfig();
    }
    if (tabId === 'settings') {
        fetchConfig();
        fetchBackups();
    }
}
window.switchTab = switchTab;

// ----------------------------------------------------
// Sidebar Collapsible Controller
// ----------------------------------------------------
function initSidebarToggle() {
    const sidebar = document.getElementById('devSidebar');
    const toggleBtns = [
        document.getElementById('btnToggleSidebar'),
        document.getElementById('btnToggleSidebarNav')
    ].filter(Boolean);

    if (!sidebar || toggleBtns.length === 0) return;

    const updateTooltips = (collapsed) => {
        document.querySelectorAll('.sidebar-item').forEach(item => {
            if (collapsed) {
                item.setAttribute('title', item.dataset.tooltip || '');
            } else {
                item.removeAttribute('title');
            }
        });
    };

    const isCollapsed = localStorage.getItem('dev_sidebar_collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        toggleBtns.forEach(b => b.setAttribute('title', 'توسيع القائمة'));
        updateTooltips(true);
    }

    toggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('collapsed');
            const collapsedNow = sidebar.classList.contains('collapsed');
            localStorage.setItem('dev_sidebar_collapsed', collapsedNow);
            toggleBtns.forEach(b => {
                b.setAttribute('title', collapsedNow ? 'توسيع القائمة' : 'طي القائمة');
            });
            updateTooltips(collapsedNow);
        });
    });
}

// ----------------------------------------------------
// Toast Notification
// ----------------------------------------------------
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `discord-toast ${type}`;

    const icon = typeof window.coolicon === 'function'
        ? (type === 'success' ? window.coolicon('circle-check', 16) : window.coolicon('triangle-warning', 16))
        : (type === 'success'
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>');

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}
window.showToast = showToast;

// ----------------------------------------------------
// Dirty State Tracking & Floating Save Bar
// ----------------------------------------------------
function getCurrentFormPayload() {
    return {
        automodEnabled: document.getElementById('toggleAutomod')?.checked ?? true,
        antiSpam: document.getElementById('toggleAntiSpam')?.checked ?? true,
        antiRaid: document.getElementById('toggleAntiRaid')?.checked ?? true,
        voiceHopProtection: document.getElementById('toggleVoiceHop')?.checked ?? true,
        antiNukeEnabled: document.getElementById('toggleAntiNuke')?.checked ?? true,
        altQuarantineEnabled: document.getElementById('toggleAltQuarantine')?.checked ?? false,

        logChannelId: document.getElementById('selectLogChannel')?.value || '',
        welcomeChannelId: document.getElementById('selectWelcomeChannel')?.value || '',
        voiceLogsChannelId: document.getElementById('selectVoiceLogsChannel')?.value || '',

        modRoleId: document.getElementById('selectModRole')?.value || '',
        bypassRoleId: document.getElementById('selectBypassRole')?.value || '',
        quarantineRoleId: document.getElementById('selectQuarantineRole')?.value || '',
        verifyRoleId: document.getElementById('selectVerifyRole')?.value || '',
        autoroleHumanId: document.getElementById('selectAutoroleHuman')?.value || '',
        autoroleBotId: document.getElementById('selectAutoroleBot')?.value || '',
        ticketCategoryId: document.getElementById('selectTicketCategory')?.value || '',
        ticketSupportRoleId: document.getElementById('selectTicketSupportRole')?.value || '',

        filteredWords: [...filteredWordsList],
        maxMentions: Number(document.getElementById('inputMaxMentions')?.value) || 5,
        maxEmojis: Number(document.getElementById('inputMaxEmojis')?.value) || 15,
        maxLines: Number(document.getElementById('inputMaxLines')?.value) || 20,
        antiNukeThreshold: Number(document.getElementById('inputAntiNukeThreshold')?.value) || 3,
        altMinAgeDays: Number(document.getElementById('inputAltMinAge')?.value) || 3,
        defaultMuteDuration: document.getElementById('selectMuteDuration')?.value || '1h'
    };
}

function checkDirtyState() {
    if (!cachedConfigPayload) return;
    const current = getCurrentFormPayload();
    const isDirty = JSON.stringify(current) !== JSON.stringify(cachedConfigPayload);
    const bar = document.getElementById('floatingSaveBar');
    if (bar) bar.classList.toggle('visible', isDirty);
}

function initDirtyStateListeners() {
    const selector = 'input, select, textarea';
    document.querySelectorAll(selector).forEach(el => {
        // Exclude embed studio and modals
        if (el.closest('#tab-embed-studio') || el.closest('.modal-dialog')) return;
        el.addEventListener('change', checkDirtyState);
        el.addEventListener('input', checkDirtyState);
    });

    const resetBtn = document.getElementById('btnResetConfig');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (cachedConfigPayload) {
                populateFormFromPayload(cachedConfigPayload);
                checkDirtyState();
                showToast('تم التراجع عن التعديلات غير المحفوظة');
            }
        });
    }

    const saveBtn = document.getElementById('btnSaveFloatingConfig');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveAllConfig);
    }
}

function populateFormFromPayload(p) {
    if (!p) return;
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };

    setCheck('toggleAutomod', p.automodEnabled);
    setCheck('toggleAntiSpam', p.antiSpam);
    setCheck('toggleAntiRaid', p.antiRaid);
    setCheck('toggleVoiceHop', p.voiceHopProtection);
    setCheck('toggleAntiNuke', p.antiNukeEnabled);
    setCheck('toggleAltQuarantine', p.altQuarantineEnabled);

    setVal('selectLogChannel', p.logChannelId);
    setVal('selectWelcomeChannel', p.welcomeChannelId);
    setVal('selectVoiceLogsChannel', p.voiceLogsChannelId);

    setVal('selectModRole', p.modRoleId);
    setVal('selectBypassRole', p.bypassRoleId);
    setVal('selectQuarantineRole', p.quarantineRoleId);
    setVal('selectVerifyRole', p.verifyRoleId);
    setVal('selectAutoroleHuman', p.autoroleHumanId);
    setVal('selectAutoroleBot', p.autoroleBotId);
    setVal('selectTicketCategory', p.ticketCategoryId);
    setVal('selectTicketSupportRole', p.ticketSupportRoleId);

    setVal('inputMaxMentions', p.maxMentions);
    setVal('inputMaxEmojis', p.maxEmojis);
    setVal('inputMaxLines', p.maxLines);
    setVal('inputAntiNukeThreshold', p.antiNukeThreshold);
    setVal('inputAltMinAge', p.altMinAgeDays);
    setVal('selectMuteDuration', p.defaultMuteDuration);

    if (Array.isArray(p.filteredWords)) {
        filteredWordsList = [...p.filteredWords];
        renderBannedWords();
    }
}

async function saveAllConfig() {
    const payload = getCurrentFormPayload();
    try {
        showToast('جاري حفظ التغييرات...');
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('تم حفظ كافة الإعدادات بنجاح!');
            cachedConfigPayload = JSON.parse(JSON.stringify(payload));
            checkDirtyState();
            fetchConfig();
            fetchStats();
        } else {
            showToast(data.error || 'تعذر حفظ الإعدادات', 'error');
        }
    } catch {
        showToast('خطأ في الاتصال بالخادم أثناء الحفظ', 'error');
    }
}

// ----------------------------------------------------
// Data Fetching
// ----------------------------------------------------
async function fetchAllData() {
    await Promise.all([
        fetchStats(),
        fetchAnalytics(),
        fetchCases(),
        fetchWarnings(),
        fetchTickets(),
        fetchConfig(),
        fetchBackups()
    ]);
}

async function fetchStats(isBackground = false) {
    try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const data = await res.json();

        // Bot profile & status
        if (data.bot) {
            const nameEl = document.getElementById('botName');
            const tagEl = document.getElementById('botTag');
            const bannerName = document.getElementById('bannerBotName');
            const crumbName = document.getElementById('breadcrumbAppName');

            if (nameEl) nameEl.textContent = data.bot.tag.split('#')[0] || data.bot.tag;
            if (tagEl) tagEl.textContent = `#${data.bot.tag.split('#')[1] || '0000'}`;
            if (bannerName) bannerName.textContent = data.bot.tag;
            if (crumbName) crumbName.textContent = data.bot.tag.split('#')[0] || data.bot.tag;

            if (data.bot.avatar) {
                const a1 = document.getElementById('botAvatar');
                const a2 = document.getElementById('botAvatarSmall');
                const a3 = document.getElementById('bannerBotAvatar');
                if (a1) a1.src = data.bot.avatar;
                if (a2) a2.src = data.bot.avatar;
                if (a3) a3.src = data.bot.avatar;
            }

            const pingEl = document.getElementById('pingVal');
            if (pingEl) pingEl.textContent = data.bot.ping >= 0 ? `${data.bot.ping} ms` : 'متصل';

            const memEl = document.getElementById('statMembers');
            if (memEl) memEl.textContent = (data.bot.memberCount || 0).toLocaleString('ar-EG');
        }

        // Moderation stats
        if (data.moderation) {
            const tc = document.getElementById('statTotalCases');
            const aw = document.getElementById('statActiveWarns');
            const nc = document.getElementById('navCasesCount');

            if (tc) tc.textContent = (data.moderation.totalCases || 0).toLocaleString('ar-EG');
            if (aw) aw.textContent = (data.moderation.activeWarnings || 0).toLocaleString('ar-EG');
            if (nc) nc.textContent = data.moderation.totalCases || 0;
        }

    } catch (err) {
        if (!isBackground) console.error('Error in fetchStats:', err);
    }
}

async function fetchAnalytics(days = currentAnalyticsDays) {
    try {
        const res = await fetch(`/api/analytics?days=${days}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
            renderAnalyticsTimeline(data.daily, days);
            renderAnalyticsBreakdown(data.breakdown);
        }
    } catch (err) {
        console.error('Error in fetchAnalytics:', err);
    }
}

function renderAnalyticsTimeline(dailyData, days) {
    const canvas = document.getElementById('analyticsChartCanvas');
    if (!canvas) return;

    const dateMap = {};
    const labels = [];
    const counts = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        dateMap[iso] = 0;
        labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }

    (dailyData || []).forEach(item => {
        if (dateMap[item.date] !== undefined) {
            dateMap[item.date] += Number(item.count || 0);
        }
    });

    Object.keys(dateMap).sort().forEach(key => {
        counts.push(dateMap[key]);
    });

    if (window.Chart) {
        if (analyticsChartInstance) {
            analyticsChartInstance.destroy();
        }

        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 220);
        gradient.addColorStop(0, 'rgba(88, 101, 242, 0.35)');
        gradient.addColorStop(1, 'rgba(88, 101, 242, 0.0)');

        analyticsChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'إجمالي المخالفات',
                    data: counts,
                    borderColor: '#5865F2',
                    borderWidth: 2.5,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.35,
                    pointBackgroundColor: '#5865F2',
                    pointBorderColor: '#ffffff',
                    pointRadius: days <= 14 ? 4 : 2,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0e1017',
                        titleColor: '#ffffff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 10,
                        titleFont: { family: 'Readex Pro' },
                        bodyFont: { family: 'Readex Pro' }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono' } }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: '#94a3b8', font: { family: 'JetBrains Mono' } },
                        grid: { color: 'rgba(255, 255, 255, 0.04)' }
                    }
                }
            }
        });
    }
}

function renderAnalyticsBreakdown(breakdown) {
    const container = document.getElementById('analyticsBreakdownContainer');
    if (!container) return;

    if (!breakdown || breakdown.length === 0) {
        container.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-dim);">لا توجد مخالفات مسجلة في هذا النطاق الزمني.</span>';
        return;
    }

    const total = breakdown.reduce((sum, b) => sum + Number(b.count || 0), 0) || 1;
    const actionArabic = {
        ban: 'حظر',
        kick: 'طرد',
        mute: 'كتم',
        warn: 'تحذير',
        automod: 'أوتومود',
        unban: 'إلغاء حظر',
        unmute: 'إلغاء كتم'
    };

    container.innerHTML = breakdown.map(item => {
        const count = Number(item.count || 0);
        const percent = Math.round((count / total) * 100);
        const label = actionArabic[item.action] || item.action;

        return `
            <div class="breakdown-row">
                <div class="breakdown-meta">
                    <span style="font-weight: 600; color: var(--text-primary);">${label}</span>
                    <span style="font-family: var(--font-code); color: var(--text-muted);">${count} (${percent}%)</span>
                </div>
            </div>
        `;
    }).join('');
}

async function fetchCases(isBackground = false) {
    try {
        const res = await fetch('/api/cases');
        if (!res.ok) return;
        allCases = await res.json();
        renderCases();
        renderOverviewCases();
    } catch (err) {
        if (!isBackground) console.error('Error in fetchCases:', err);
    }
}

async function fetchWarnings() {
    try {
        const res = await fetch('/api/warnings');
        if (!res.ok) return;
        allWarnings = await res.json();
        renderWarnings();
    } catch (err) {
        console.error('Error in fetchWarnings:', err);
    }
}

async function fetchTickets() {
    try {
        const res = await fetch('/api/tickets');
        if (!res.ok) return;
        allTickets = await res.json();
        renderTickets();
    } catch (err) {
        console.error('Error in fetchTickets:', err);
    }
}

async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = await res.json();
        currentGuildConfig = data.config || {};
        currentDefaultConfig = data.defaultConfig || {};

        // Channels dropdowns
        const chSelectors = [
            { id: 'selectLogChannel', val: currentGuildConfig.log_channel_id || currentGuildConfig.logChannelId },
            { id: 'selectWelcomeChannel', val: currentGuildConfig.welcome_channel_id || currentGuildConfig.welcomeChannelId },
            { id: 'selectVoiceLogsChannel', val: currentGuildConfig.voice_logs_channel_id || currentGuildConfig.voiceLogsChannelId }
        ];

        chSelectors.forEach(({ id, val }) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = '<option value="">-- لم يتم التحديد --</option>';
            (data.channels || []).forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = `# ${ch.name}`;
                if (val === ch.id) opt.selected = true;
                el.appendChild(opt);
            });
        });

        // Embed Studio Channel selector
        const embedChSelect = document.getElementById('embedChannelSelect');
        if (embedChSelect) {
            const curVal = embedChSelect.value;
            embedChSelect.innerHTML = '<option value="">اختر القناة النصية...</option>';
            (data.channels || []).forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = `# ${ch.name}`;
                if (curVal === ch.id) opt.selected = true;
                embedChSelect.appendChild(opt);
            });
        }

        // Categories dropdown
        const catSelect = document.getElementById('selectTicketCategory');
        if (catSelect) {
            catSelect.innerHTML = '<option value="">-- بدون فئة (المستوى الجذري) --</option>';
            (data.categories || []).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                if (currentGuildConfig.ticket_category_id === cat.id || currentGuildConfig.ticketCategoryId === cat.id) {
                    opt.selected = true;
                }
                catSelect.appendChild(opt);
            });
        }

        // Roles dropdowns
        const roleSelectors = [
            { id: 'selectModRole', val: currentGuildConfig.mod_role_id || currentGuildConfig.modRoleId },
            { id: 'selectBypassRole', val: currentGuildConfig.bypass_role_id || currentGuildConfig.bypassRoleId },
            { id: 'selectQuarantineRole', val: currentGuildConfig.quarantine_role_id || currentGuildConfig.quarantineRoleId },
            { id: 'selectVerifyRole', val: currentGuildConfig.verify_role_id || currentGuildConfig.verifyRoleId },
            { id: 'selectAutoroleHuman', val: currentGuildConfig.autorole_human_id || currentGuildConfig.autoroleHumanId },
            { id: 'selectAutoroleBot', val: currentGuildConfig.autorole_bot_id || currentGuildConfig.autoroleBotId },
            { id: 'selectTicketSupportRole', val: currentGuildConfig.ticket_support_role_id || currentGuildConfig.ticketSupportRoleId }
        ];

        roleSelectors.forEach(({ id, val }) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = '<option value="">-- لم يتم التحديد --</option>';
            (data.roles || []).forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `@ ${r.name}`;
                if (val === r.id) opt.selected = true;
                el.appendChild(opt);
            });
        });

        // Toggles
        const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
        setCheck('toggleAutomod', currentGuildConfig.automod_enabled !== undefined ? currentGuildConfig.automod_enabled === 1 : (currentDefaultConfig.automod?.enabled ?? true));
        setCheck('toggleAntiSpam', currentGuildConfig.anti_spam === 1 || currentGuildConfig.antiSpam === 1);
        setCheck('toggleAntiRaid', currentGuildConfig.anti_raid !== undefined ? currentGuildConfig.anti_raid === 1 : true);
        setCheck('toggleAntiNuke', currentGuildConfig.anti_nuke_enabled !== 0);
        setCheck('toggleAltQuarantine', currentGuildConfig.alt_quarantine_enabled === 1);
        setCheck('toggleVoiceHop', currentGuildConfig.voice_hop_protection !== 0);

        // Numeric Inputs
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
        setVal('inputMaxMentions', currentGuildConfig.max_mentions || currentGuildConfig.maxMentions || 5);
        setVal('inputMaxEmojis', currentGuildConfig.max_emojis || currentGuildConfig.maxEmojis || 15);
        setVal('inputMaxLines', currentGuildConfig.max_lines || currentGuildConfig.maxLines || 20);
        setVal('inputAntiNukeThreshold', currentGuildConfig.anti_nuke_threshold || 3);
        setVal('inputAltMinAge', currentGuildConfig.alt_min_age_days || 3);
        setVal('selectMuteDuration', currentGuildConfig.default_mute_duration || currentGuildConfig.defaultMuteDuration || '1h');

        // Banned words list
        filteredWordsList = [];
        if (currentGuildConfig.filteredWords) {
            try {
                const parsed = JSON.parse(currentGuildConfig.filteredWords);
                if (Array.isArray(parsed)) filteredWordsList = parsed;
            } catch {
                if (typeof currentGuildConfig.filteredWords === 'string') {
                    filteredWordsList = currentGuildConfig.filteredWords.split(',').map(s => s.trim()).filter(Boolean);
                }
            }
        }
        if (filteredWordsList.length === 0 && Array.isArray(currentDefaultConfig.automod?.defaultFilteredWords)) {
            filteredWordsList = [...currentDefaultConfig.automod.defaultFilteredWords];
        }
        renderBannedWords();

        // Cache initial payload for dirty-checking
        cachedConfigPayload = getCurrentFormPayload();
        checkDirtyState();

    } catch (err) {
        console.error('Error in fetchConfig:', err);
    }
}

async function fetchBackups() {
    try {
        const res = await fetch('/api/backups');
        if (!res.ok) return;
        const backups = await res.json();
        renderBackups(backups);
    } catch (err) {
        console.error('Error in fetchBackups:', err);
    }
}

// ----------------------------------------------------
// Rendering Tables & UI
// ----------------------------------------------------
function renderCases() {
    const tbody = document.getElementById('casesTbody');
    if (!tbody) return;

    let filtered = allCases.slice();
    if (activeCaseFilter !== 'all') {
        filtered = filtered.filter(c => c.action === activeCaseFilter);
    }
    if (casesSearchQuery.trim()) {
        const q = casesSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(c =>
            String(c.case_number).includes(q) ||
            String(c.user_id).includes(q) ||
            String(c.reason || '').toLowerCase().includes(q)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2rem;">لا توجد حالات رقابية مطابقة.</td></tr>';
        return;
    }

    const actionArabic = {
        ban: 'حظر',
        kick: 'طرد',
        mute: 'كتم',
        warn: 'تحذير',
        automod: 'أوتومود',
        unban: 'إلغاء حظر',
        unmute: 'إلغاء كتم'
    };

    tbody.innerHTML = filtered.map(c => {
        const timeAgo = formatTimeAgo(new Date(c.created_at));
        const canUndo = (c.action === 'mute' || c.action === 'warn') && c.active === 1;
        const actLabel = actionArabic[c.action] || c.action;

        return `
            <tr>
                <td style="font-family: var(--font-code); font-weight: 700; color: #818CF8;">#${c.case_number}</td>
                <td><span class="badge-action badge-${c.action}">${actLabel}</span></td>
                <td><code>&lt;@${c.user_id}&gt;</code></td>
                <td><code style="color: var(--text-dim);">&lt;@${c.moderator_id}&gt;</code></td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.reason || 'بدون سبب')}">
                    ${escapeHtml(c.reason || 'بدون سبب')}
                </td>
                <td><span style="font-size: 0.78rem; color: var(--text-muted);">${timeAgo}</span></td>
                <td>
                    ${canUndo ? `
                        <button type="button" class="btn btn-sm btn-glass" onclick="handleUndo(${c.case_number}, '${c.user_id}', '${c.action}')">
                            تراجع
                        </button>
                    ` : '<span style="color: var(--text-dim); font-size: 0.75rem;">—</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function renderOverviewCases() {
    const tbody = document.getElementById('overviewCasesTbody');
    if (!tbody) return;

    const recent = allCases.slice(0, 5);
    if (recent.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">لا توجد عمليات إشرافية مسجلة حتى الآن.</td></tr>';
        return;
    }

    const actionArabic = {
        ban: 'حظر',
        kick: 'طرد',
        mute: 'كتم',
        warn: 'تحذير',
        automod: 'أوتومود',
        unban: 'إلغاء حظر',
        unmute: 'إلغاء كتم'
    };

    tbody.innerHTML = recent.map(c => {
        const timeAgo = formatTimeAgo(new Date(c.created_at));
        const actLabel = actionArabic[c.action] || c.action;
        return `
            <tr>
                <td style="font-family: var(--font-code); font-weight: 700; color: #818CF8;">#${c.case_number}</td>
                <td><span class="badge-action badge-${c.action}">${actLabel}</span></td>
                <td><code>&lt;@${c.user_id}&gt;</code></td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.reason || 'بدون سبب')}">
                    ${escapeHtml(c.reason || 'بدون سبب')}
                </td>
                <td><span style="font-size: 0.78rem; color: var(--text-muted);">${timeAgo}</span></td>
            </tr>
        `;
    }).join('');
}

function renderWarnings() {
    const tbody = document.getElementById('warningsTbody');
    if (!tbody) return;

    let filtered = allWarnings.slice();
    if (warnsSearchQuery.trim()) {
        const q = warnsSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(w =>
            String(w.id).includes(q) ||
            String(w.user_id).includes(q) ||
            String(w.reason || '').toLowerCase().includes(q)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">لا توجد تحذيرات مسجلة.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(w => {
        const timeAgo = formatTimeAgo(new Date(w.created_at));
        return `
            <tr>
                <td style="font-family: var(--font-code); font-weight: 700; color: var(--yellow);">#${w.id}</td>
                <td><code>&lt;@${w.user_id}&gt;</code></td>
                <td><code style="color: var(--text-dim);">&lt;@${w.moderator_id}&gt;</code></td>
                <td>${escapeHtml(w.reason || 'بدون سبب')}</td>
                <td><span style="font-size: 0.78rem; color: var(--text-muted);">${timeAgo}</span></td>
                <td>
                    ${w.active === 1 ? `
                        <button type="button" class="btn btn-sm btn-danger-glass" onclick="handleDismissWarning(${w.id}, '${w.user_id}')">
                            إسقاط
                        </button>
                    ` : '<span style="color: var(--text-dim); font-size: 0.75rem;">منتهي</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function renderTickets() {
    const tbody = document.getElementById('ticketsTbody');
    if (!tbody) return;

    let filtered = allTickets.slice();
    if (ticketsSearchQuery.trim()) {
        const q = ticketsSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(t =>
            String(t.ticket_id).includes(q) ||
            String(t.user_id).includes(q) ||
            String(t.channel_id).includes(q)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">لا توجد تكتات مسجلة حالياً.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        const openTime = formatTimeAgo(new Date(t.created_at));
        const closeTime = t.closed_at ? formatTimeAgo(new Date(t.closed_at)) : '—';
        const isOpen = t.status === 'open';

        return `
            <tr>
                <td style="font-family: var(--font-code); font-weight: 700; color: #818CF8;">#${t.ticket_id}</td>
                <td><code>&lt;@${t.user_id}&gt;</code></td>
                <td>
                    <span class="badge-tag" style="${isOpen ? '' : 'background: rgba(255,255,255,0.06); color: var(--text-muted); border-color: var(--border-glass);'}">
                        ${isOpen ? 'تكت مفتوح' : 'تكت مغلق'}
                    </span>
                </td>
                <td><span style="font-size: 0.78rem; color: var(--text-muted);">${openTime}</span></td>
                <td><span style="font-size: 0.78rem; color: var(--text-muted);">${closeTime}</span></td>
                <td>
                    <button type="button" class="btn btn-sm btn-glass" onclick="viewTranscript(${t.ticket_id})">
                        عرض السجل
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderBackups(backups) {
    const container = document.getElementById('backupsListContainer');
    if (!container) return;

    if (!backups || backups.length === 0) {
        container.innerHTML = '<p style="color: var(--text-dim);">لا توجد ملفات باك اب مخزنة حالياً.</p>';
        return;
    }

    container.innerHTML = backups.map(b => {
        const sizeKb = (b.size / 1024).toFixed(1);
        const timeAgo = formatTimeAgo(new Date(b.time));
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.1rem; border-bottom: 1px solid var(--border-glass); background: rgba(255, 255, 255, 0.02); margin-bottom: 0.5rem; border-radius: var(--radius-md);">
                <div>
                    <div style="font-weight: 600; color: var(--text-primary); font-family: var(--font-code); font-size: 0.85rem;">${escapeHtml(b.name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">${sizeKb} ك.ب • تم الإنشاء ${timeAgo}</div>
                </div>
                <span class="badge-tag">جاهزة</span>
            </div>
        `;
    }).join('');
}

function renderBannedWords() {
    const container = document.getElementById('bannedWordsTagsList');
    if (!container) return;

    if (filteredWordsList.length === 0) {
        container.innerHTML = '<span style="font-size: 0.78rem; color: var(--text-dim);">لم يتم إضافة كلمات محظورة بعد.</span>';
        return;
    }

    container.innerHTML = filteredWordsList.map((word, index) => `
        <span class="tag-badge">
            <span>${escapeHtml(word)}</span>
            <span class="tag-remove-btn" onclick="removeBannedWord(${index})">&times;</span>
        </span>
    `).join('');
}

function initBannedWordsManager() {
    const input = document.getElementById('inputBannedWord');
    const btn = document.getElementById('btnAddBannedWord');

    const addWord = () => {
        if (!input) return;
        const val = input.value.trim().toLowerCase();
        if (!val) return;
        if (filteredWordsList.includes(val)) {
            showToast('الكلمة موجودة بالفعل في قائمة الحظر', 'error');
            return;
        }
        filteredWordsList.push(val);
        input.value = '';
        renderBannedWords();
        checkDirtyState();
    };

    if (btn) btn.addEventListener('click', addWord);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addWord();
            }
        });
    }
}

function removeBannedWord(index) {
    if (index >= 0 && index < filteredWordsList.length) {
        filteredWordsList.splice(index, 1);
        renderBannedWords();
        checkDirtyState();
    }
}
window.removeBannedWord = removeBannedWord;

// ----------------------------------------------------
// Transcripts Modal
// ----------------------------------------------------
async function viewTranscript(ticketId) {
    const modal = document.getElementById('transcriptModal');
    const content = document.getElementById('transcriptModalContent');
    const title = document.getElementById('transcriptModalTitle');
    if (!modal || !content) return;

    title.textContent = `سجل محادثة التكت #${ticketId}`;
    content.textContent = 'جاري استرجاع المحادثة المؤرشفة...';
    modal.classList.add('show');

    try {
        const res = await fetch(`/api/tickets/${ticketId}/transcript`);
        const data = await res.json();
        if (data && data.transcript) {
            activeTranscriptText = data.transcript;
            content.textContent = data.transcript;
        } else {
            content.textContent = 'لا يوجد نص محادثة محفوظ لهذا التكت.';
        }
    } catch {
        content.textContent = 'خطأ في الاتصال أثناء جلب نص المحادثة.';
    }
}
window.viewTranscript = viewTranscript;

function closeTranscriptModal() {
    const modal = document.getElementById('transcriptModal');
    if (modal) modal.classList.remove('show');
}
window.closeTranscriptModal = closeTranscriptModal;

// ----------------------------------------------------
// Handlers (Filters, Search, Action Buttons)
// ----------------------------------------------------
function initFilters() {
    const filters = [
        { id: 'btnFilterAll', val: 'all' },
        { id: 'btnFilterBan', val: 'ban' },
        { id: 'btnFilterMute', val: 'mute' },
        { id: 'btnFilterKick', val: 'kick' },
        { id: 'btnFilterWarn', val: 'warn' }
    ];

    filters.forEach(({ id, val }) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
            filters.forEach(f => document.getElementById(f.id)?.classList.remove('active'));
            btn.classList.add('active');
            activeCaseFilter = val;
            renderCases();
        });
    });
}

function initSearch() {
    const cSearch = document.getElementById('inputSearchCases');
    if (cSearch) {
        cSearch.addEventListener('input', (e) => {
            casesSearchQuery = e.target.value;
            renderCases();
        });
    }

    const wSearch = document.getElementById('inputSearchWarns');
    if (wSearch) {
        wSearch.addEventListener('input', (e) => {
            warnsSearchQuery = e.target.value;
            renderWarnings();
        });
    }

    const tSearch = document.getElementById('inputSearchTickets');
    if (tSearch) {
        tSearch.addEventListener('input', (e) => {
            ticketsSearchQuery = e.target.value;
            renderTickets();
        });
    }

    // Analytics days buttons
    const btn7 = document.getElementById('btnAnalyticsDays7');
    const btn30 = document.getElementById('btnAnalyticsDays30');
    if (btn7) {
        btn7.addEventListener('click', () => {
            btn7.classList.add('active');
            if (btn30) btn30.classList.remove('active');
            currentAnalyticsDays = 7;
            fetchAnalytics(7);
        });
    }
    if (btn30) {
        btn30.addEventListener('click', () => {
            btn30.classList.add('active');
            if (btn7) btn7.classList.remove('active');
            currentAnalyticsDays = 30;
            fetchAnalytics(30);
        });
    }
}

function initActionButtons() {
    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            fetchAllData();
            showToast('تمت مزامنة كافة البيانات والإحصائيات');
        });
    }

    const btnQuickBackup = document.getElementById('btnQuickBackup');
    if (btnQuickBackup) btnQuickBackup.addEventListener('click', triggerBackup);

    const btnTriggerBackup = document.getElementById('btnTriggerBackup');
    if (btnTriggerBackup) btnTriggerBackup.addEventListener('click', triggerBackup);

    const btnDlTxt = document.getElementById('btnDownloadTranscript');
    if (btnDlTxt) {
        btnDlTxt.addEventListener('click', () => {
            if (!activeTranscriptText) return;
            downloadBlob(activeTranscriptText, 'text/plain', `ticket-transcript.txt`);
        });
    }

    const btnDlHtml = document.getElementById('btnDownloadTranscriptHtml');
    if (btnDlHtml) {
        btnDlHtml.addEventListener('click', () => {
            if (!activeTranscriptText) return;
            const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>سجل التكت</title><style>body{font-family:sans-serif;background:#090a0f;color:#cbd5e1;padding:2rem;line-height:1.6;white-space:pre-wrap;}</style></head><body>${escapeHtml(activeTranscriptText)}</body></html>`;
            downloadBlob(html, 'text/html', `ticket-transcript.html`);
        });
    }
}

function initExportButtons() {
    const expCasesCsv = document.getElementById('btnExportCasesCsv');
    if (expCasesCsv) expCasesCsv.addEventListener('click', () => window.open('/api/export/cases?format=csv', '_blank'));

    const expCasesJson = document.getElementById('btnExportCasesJson');
    if (expCasesJson) expCasesJson.addEventListener('click', () => window.open('/api/export/cases?format=json', '_blank'));

    const expWarnsCsv = document.getElementById('btnExportWarnsCsv');
    if (expWarnsCsv) expWarnsCsv.addEventListener('click', () => window.open('/api/export/warnings?format=csv', '_blank'));
}

async function triggerBackup() {
    try {
        showToast('جاري أخذ الباك اب الآن...');
        const res = await fetch('/api/backup/now', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('تم أخذ الباك اب بنجاح!');
            fetchStats();
            fetchBackups();
        } else {
            showToast(data.error || 'فشل في إنشاء الباك اب', 'error');
        }
    } catch {
        showToast('خطأ في الاتصال بالخادم أثناء أخذ الباك اب', 'error');
    }
}
window.triggerBackup = triggerBackup;

async function handleUndo(caseNumber, userId, action) {
    if (!confirm(`هل أنت متأكد من رغبتك في التراجع عن القضية #${caseNumber} (${action})؟`)) return;

    try {
        const res = await fetch('/api/action/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caseNumber, userId, action })
        });
        const data = await res.json();
        if (data.success) {
            showToast('تم التراجع عن الإجراء بنجاح');
            fetchCases();
            fetchStats();
            fetchAnalytics();
        } else {
            showToast(data.error || 'تعذر التراجع عن الحالة', 'error');
        }
    } catch {
        showToast('خطأ في الاتصال بالخادم أثناء التراجع', 'error');
    }
}
window.handleUndo = handleUndo;

async function handleDismissWarning(warningId, userId) {
    if (!confirm(`هل أنت متأكد من إسقاط التحذير #${warningId}؟`)) return;

    try {
        const res = await fetch('/api/action/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ warningId, userId, action: 'warn' })
        });
        const data = await res.json();
        if (data.success) {
            showToast('تم إسقاط التحذير بنجاح');
            fetchWarnings();
            fetchStats();
        } else {
            showToast(data.error || 'تعذر إسقاط التحذير', 'error');
        }
    } catch {
        showToast('خطأ في الاتصال أثناء إسقاط التحذير', 'error');
    }
}
window.handleDismissWarning = handleDismissWarning;

// ----------------------------------------------------
// Visual Embed Studio Logic (1:1 Live Preview)
// ----------------------------------------------------
function initEmbedStudio() {
    // 1. Color Swatches & Picker Sync
    const swatchBtns = document.querySelectorAll('#embedColorSwatches .swatch-btn');
    const colorPicker = document.getElementById('embedColorPicker');
    const colorHexInput = document.getElementById('embedColorHex');

    swatchBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            swatchBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const color = btn.getAttribute('data-color');
            if (colorPicker) colorPicker.value = color.toLowerCase();
            if (colorHexInput) colorHexInput.value = color.toUpperCase();
            renderEmbedPreview();
        });
    });

    if (colorPicker) {
        colorPicker.addEventListener('input', (e) => {
            const val = e.target.value.toUpperCase();
            if (colorHexInput) colorHexInput.value = val;
            swatchBtns.forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-color').toUpperCase() === val);
            });
            renderEmbedPreview();
        });
    }

    if (colorHexInput) {
        colorHexInput.addEventListener('input', (e) => {
            let val = e.target.value.trim();
            if (!val.startsWith('#') && val.length > 0) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                if (colorPicker) colorPicker.value = val.toLowerCase();
                swatchBtns.forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-color').toUpperCase() === val.toUpperCase());
                });
                renderEmbedPreview();
            }
        });
    }

    // 2. Input Listeners for Live Preview
    const previewInputIds = [
        'embedChannelSelect',
        'embedPlainContent',
        'embedAuthorName',
        'embedAuthorIcon',
        'embedAuthorUrl',
        'embedTitle',
        'embedTitleUrl',
        'embedDescription',
        'embedThumbnailUrl',
        'embedImageUrl',
        'embedFooterText',
        'embedFooterIcon',
        'embedIncludeTimestamp'
    ];

    previewInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', renderEmbedPreview);
            el.addEventListener('change', renderEmbedPreview);
        }
    });

    // 3. Dynamic Fields & Buttons Controls
    const btnAddField = document.getElementById('btnAddEmbedField');
    if (btnAddField) btnAddField.addEventListener('click', addEmbedField);

    const btnAddButton = document.getElementById('btnAddEmbedButton');
    if (btnAddButton) btnAddButton.addEventListener('click', addEmbedButton);

    // 4. Template Actions
    const btnLoadTemplate = document.getElementById('btnLoadEmbedTemplate');
    if (btnLoadTemplate) btnLoadTemplate.addEventListener('click', loadSelectedTemplate);

    const btnDeleteTemplate = document.getElementById('btnDeleteEmbedTemplate');
    if (btnDeleteTemplate) btnDeleteTemplate.addEventListener('click', deleteSelectedTemplate);

    const selectTemplate = document.getElementById('embedTemplateSelect');
    if (selectTemplate) {
        selectTemplate.addEventListener('change', () => {
            if (selectTemplate.value) loadSelectedTemplate();
        });
    }

    const openSaveModal = () => {
        const modal = document.getElementById('saveTemplateModal');
        if (modal) modal.classList.add('show');
        const input = document.getElementById('templateSaveNameInput');
        if (input) { input.value = ''; input.focus(); }
    };

    const btnOpenSaveModal = document.getElementById('btnOpenSaveModal');
    if (btnOpenSaveModal) btnOpenSaveModal.addEventListener('click', openSaveModal);

    const btnOpenSaveModalTop = document.getElementById('btnOpenSaveModalTop');
    if (btnOpenSaveModalTop) btnOpenSaveModalTop.addEventListener('click', openSaveModal);

    const btnConfirmSave = document.getElementById('btnConfirmSaveTemplate');
    if (btnConfirmSave) btnConfirmSave.addEventListener('click', confirmSaveTemplate);

    // 5. Toolbar Actions
    const btnClearForm = document.getElementById('btnClearEmbedForm');
    if (btnClearForm) btnClearForm.addEventListener('click', clearEmbedForm);

    const btnSendLive = document.getElementById('btnSendEmbedLive');
    if (btnSendLive) btnSendLive.addEventListener('click', sendEmbedLive);

    fetchEmbedTemplates();
    renderEmbedPreview();
}

function closeSaveTemplateModal() {
    const modal = document.getElementById('saveTemplateModal');
    if (modal) modal.classList.remove('show');
}
window.closeSaveTemplateModal = closeSaveTemplateModal;

function addEmbedField() {
    if (embedStudioFields.length >= 25) {
        showToast('تم الوصول إلى الحد الأقصى لحقول الإمبد (25)', 'error');
        return;
    }
    embedStudioFields.push({ name: '', value: '', inline: false });
    renderEmbedFieldsInputs();
    renderEmbedPreview();
}

function removeEmbedField(index) {
    embedStudioFields.splice(index, 1);
    renderEmbedFieldsInputs();
    renderEmbedPreview();
}

function renderEmbedFieldsInputs() {
    const container = document.getElementById('embedFieldsList');
    const emptyHint = document.getElementById('embedFieldsEmptyHint');
    if (!container) return;

    if (embedStudioFields.length === 0) {
        container.innerHTML = '';
        if (emptyHint) emptyHint.style.display = 'block';
        return;
    }

    if (emptyHint) emptyHint.style.display = 'none';

    container.innerHTML = embedStudioFields.map((f, i) => `
        <div class="embed-field-item">
            <div class="field-header-row">
                <span class="field-header-title">الحقل #${i + 1}</span>
                <button type="button" class="btn-remove-row" onclick="removeEmbedField(${i})" title="حذف الحقل">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="grid-2-col">
                <div class="form-group">
                    <label class="form-label" style="font-size: 0.76rem;">عنوان الحقل (Name)</label>
                    <input type="text" class="form-input form-input-sm" value="${escapeHtml(f.name)}" placeholder="اسم السمة..." maxlength="256" oninput="updateFieldValue(${i}, 'name', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label" style="font-size: 0.76rem;">قيمة الحقل (Value)</label>
                    <input type="text" class="form-input form-input-sm" value="${escapeHtml(f.value)}" placeholder="قيمة السمة..." maxlength="1024" oninput="updateFieldValue(${i}, 'value', this.value)">
                </div>
            </div>
            <div class="form-check" style="margin-top: 0.2rem;">
                <input type="checkbox" id="fieldInlineCheck_${i}" class="glass-checkbox" ${f.inline ? 'checked' : ''} onchange="updateFieldValue(${i}, 'inline', this.checked)">
                <label for="fieldInlineCheck_${i}" class="form-check-label" style="font-size: 0.78rem;">عرض كحقل مضمن في نفس السطر (Inline)</label>
            </div>
        </div>
    `).join('');
}

function updateFieldValue(index, key, val) {
    if (embedStudioFields[index]) {
        embedStudioFields[index][key] = val;
        renderEmbedPreview();
    }
}
window.removeEmbedField = removeEmbedField;
window.updateFieldValue = updateFieldValue;

function addEmbedButton() {
    if (embedStudioButtons.length >= 5) {
        showToast('تم الوصول إلى الحد الأقصى للأزرار التفاعلية (5)', 'error');
        return;
    }
    embedStudioButtons.push({ label: '', url: '' });
    renderEmbedButtonsInputs();
    renderEmbedPreview();
}

function removeEmbedButton(index) {
    embedStudioButtons.splice(index, 1);
    renderEmbedButtonsInputs();
    renderEmbedPreview();
}

function renderEmbedButtonsInputs() {
    const container = document.getElementById('embedButtonsList');
    const emptyHint = document.getElementById('embedButtonsEmptyHint');
    if (!container) return;

    if (embedStudioButtons.length === 0) {
        container.innerHTML = '';
        if (emptyHint) emptyHint.style.display = 'block';
        return;
    }

    if (emptyHint) emptyHint.style.display = 'none';

    container.innerHTML = embedStudioButtons.map((b, i) => `
        <div class="embed-button-item">
            <div class="btn-header-row">
                <span class="field-header-title">زر الرابط #${i + 1}</span>
                <button type="button" class="btn-remove-row" onclick="removeEmbedButton(${i})" title="حذف الزر">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="grid-2-col">
                <div class="form-group">
                    <label class="form-label" style="font-size: 0.76rem;">نص الزر (Label)</label>
                    <input type="text" class="form-input form-input-sm" value="${escapeHtml(b.label)}" placeholder="مثال: زيارة الموقع، الانضمام" maxlength="80" oninput="updateButtonValue(${i}, 'label', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label" style="font-size: 0.76rem;">رابط الزر (Target URL)</label>
                    <input type="url" class="form-input form-input-sm" value="${escapeHtml(b.url)}" placeholder="https://..." oninput="updateButtonValue(${i}, 'url', this.value)">
                </div>
            </div>
        </div>
    `).join('');
}

function updateButtonValue(index, key, val) {
    if (embedStudioButtons[index]) {
        embedStudioButtons[index][key] = val;
        renderEmbedPreview();
    }
}
window.removeEmbedButton = removeEmbedButton;
window.updateButtonValue = updateButtonValue;

function formatDiscordMarkdown(text) {
    if (!text) return '';
    let formatted = escapeHtml(text);

    formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre class="discord-pre"><code>$1</code></pre>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
    formatted = formatted.replace(/__([^_]+)__/g, '<u>$1</u>');
    formatted = formatted.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    formatted = formatted.replace(/@everyone/g, '<span class="discord-mention">@everyone</span>');
    formatted = formatted.replace(/@here/g, '<span class="discord-mention">@here</span>');
    formatted = formatted.replace(/&lt;@!?([0-9]+)&gt;/g, '<span class="discord-mention">@user</span>');
    formatted = formatted.replace(/&lt;@&amp;([0-9]+)&gt;/g, '<span class="discord-mention">@role</span>');

    return formatted;
}

function renderEmbedPreview() {
    // 1. Channel Badge
    const channelSelect = document.getElementById('embedChannelSelect');
    const channelBadge = document.getElementById('previewTargetChannelBadge');
    if (channelBadge && channelSelect) {
        const selectedText = channelSelect.options[channelSelect.selectedIndex]?.text;
        channelBadge.textContent = selectedText && channelSelect.value ? selectedText : '# اختر-القناة';
    }

    // 2. Bot Avatar & Name
    const botAvatar = document.getElementById('botAvatar')?.src;
    const botName = document.getElementById('botName')?.textContent || 'ModBot';
    const previewAvatar = document.getElementById('previewBotAvatar');
    const previewName = document.getElementById('previewBotName');
    if (previewAvatar && botAvatar) previewAvatar.src = botAvatar;
    if (previewName) previewName.textContent = botName;

    // 3. Plain Notice
    const plainContent = document.getElementById('embedPlainContent')?.value?.trim() || '';
    const previewPlain = document.getElementById('previewPlainContent');
    if (previewPlain) {
        if (plainContent) {
            previewPlain.innerHTML = formatDiscordMarkdown(plainContent);
            previewPlain.style.display = 'block';
        } else {
            previewPlain.style.display = 'none';
        }
    }

    // 4. Accent Color
    const colorHex = document.getElementById('embedColorHex')?.value?.trim() || '#5865F2';
    const embedCard = document.getElementById('previewEmbedCard');
    if (embedCard) {
        embedCard.style.borderLeftColor = colorHex;
    }

    // 5. Author Block
    const authorName = document.getElementById('embedAuthorName')?.value?.trim() || '';
    const authorIcon = document.getElementById('embedAuthorIcon')?.value?.trim() || '';
    const authorUrl = document.getElementById('embedAuthorUrl')?.value?.trim() || '';
    const previewAuthorRow = document.getElementById('previewEmbedAuthor');
    const previewAuthorLink = document.getElementById('previewAuthorLink');
    const previewAuthorIconImg = document.getElementById('previewAuthorIcon');

    if (previewAuthorRow) {
        if (authorName) {
            previewAuthorRow.style.display = 'flex';
            if (previewAuthorLink) {
                previewAuthorLink.textContent = authorName;
                if (authorUrl && authorUrl.startsWith('http')) {
                    previewAuthorLink.href = authorUrl;
                } else {
                    previewAuthorLink.removeAttribute('href');
                }
            }
            if (previewAuthorIconImg) {
                if (authorIcon && authorIcon.startsWith('http')) {
                    previewAuthorIconImg.src = authorIcon;
                    previewAuthorIconImg.style.display = 'inline-block';
                } else {
                    previewAuthorIconImg.style.display = 'none';
                }
            }
        } else {
            previewAuthorRow.style.display = 'none';
        }
    }

    // 6. Title Block
    const title = document.getElementById('embedTitle')?.value?.trim() || '';
    const titleUrl = document.getElementById('embedTitleUrl')?.value?.trim() || '';
    const previewTitleWrap = document.getElementById('previewEmbedTitle');
    const previewTitleLink = document.getElementById('previewTitleLink');

    if (previewTitleWrap && previewTitleLink) {
        if (title) {
            previewTitleWrap.style.display = 'block';
            previewTitleLink.textContent = title;
            if (titleUrl && titleUrl.startsWith('http')) {
                previewTitleLink.href = titleUrl;
            } else {
                previewTitleLink.removeAttribute('href');
            }
        } else {
            previewTitleWrap.style.display = 'none';
        }
    }

    // 7. Description Block
    const description = document.getElementById('embedDescription')?.value || '';
    const previewDesc = document.getElementById('previewEmbedDescription');
    const descCounter = document.getElementById('descCharCount');
    if (descCounter) descCounter.textContent = description.length;

    if (previewDesc) {
        if (description.trim()) {
            previewDesc.innerHTML = formatDiscordMarkdown(description);
            previewDesc.style.display = 'block';
        } else {
            previewDesc.style.display = 'none';
        }
    }

    // 8. Fields Grid
    const previewFieldsContainer = document.getElementById('previewEmbedFields');
    if (previewFieldsContainer) {
        const validFields = embedStudioFields.filter(f => f.name.trim() || f.value.trim());
        if (validFields.length > 0) {
            previewFieldsContainer.style.display = 'grid';
            previewFieldsContainer.innerHTML = validFields.map(f => `
                <div class="discord-field-block ${f.inline ? '' : 'full-width'}">
                    <div class="discord-field-name">${escapeHtml(f.name || '\u200b')}</div>
                    <div class="discord-field-value">${formatDiscordMarkdown(f.value || '\u200b')}</div>
                </div>
            `).join('');
        } else {
            previewFieldsContainer.style.display = 'none';
        }
    }

    // 9. Thumbnail Image
    const thumbUrl = document.getElementById('embedThumbnailUrl')?.value?.trim() || '';
    const previewThumbWrap = document.getElementById('previewThumbWrap');
    const previewThumbImg = document.getElementById('previewThumbImg');
    if (previewThumbWrap && previewThumbImg) {
        if (thumbUrl && thumbUrl.startsWith('http')) {
            previewThumbImg.src = thumbUrl;
            previewThumbWrap.style.display = 'block';
        } else {
            previewThumbWrap.style.display = 'none';
        }
    }

    // 10. Banner Image
    const imgUrl = document.getElementById('embedImageUrl')?.value?.trim() || '';
    const previewImageWrap = document.getElementById('previewImageWrap');
    const previewMainImg = document.getElementById('previewMainImg');
    if (previewImageWrap && previewMainImg) {
        if (imgUrl && imgUrl.startsWith('http')) {
            previewMainImg.src = imgUrl;
            previewImageWrap.style.display = 'block';
        } else {
            previewImageWrap.style.display = 'none';
        }
    }

    // 11. Footer & Timestamp
    const footerText = document.getElementById('embedFooterText')?.value?.trim() || '';
    const footerIcon = document.getElementById('embedFooterIcon')?.value?.trim() || '';
    const includeTimestamp = document.getElementById('embedIncludeTimestamp')?.checked ?? true;

    const previewFooterWrap = document.getElementById('previewEmbedFooter');
    const previewFooterIcon = document.getElementById('previewFooterIcon');
    const previewFooterText = document.getElementById('previewFooterText');
    const previewFooterBullet = document.getElementById('previewFooterBullet');
    const previewFooterTime = document.getElementById('previewFooterTimestamp');

    if (previewFooterWrap) {
        if (footerText || includeTimestamp) {
            previewFooterWrap.style.display = 'flex';
            if (previewFooterText) previewFooterText.textContent = footerText;

            if (previewFooterIcon) {
                if (footerIcon && footerIcon.startsWith('http')) {
                    previewFooterIcon.src = footerIcon;
                    previewFooterIcon.style.display = 'inline-block';
                } else {
                    previewFooterIcon.style.display = 'none';
                }
            }

            if (includeTimestamp) {
                if (previewFooterBullet && footerText) previewFooterBullet.style.display = 'inline';
                if (previewFooterTime) {
                    previewFooterTime.style.display = 'inline';
                    const now = new Date();
                    previewFooterTime.textContent = `اليوم الساعة ${now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
                }
            } else {
                if (previewFooterBullet) previewFooterBullet.style.display = 'none';
                if (previewFooterTime) previewFooterTime.style.display = 'none';
            }
        } else {
            previewFooterWrap.style.display = 'none';
        }
    }

    // 12. Action Row Buttons
    const previewActionRow = document.getElementById('previewActionRow');
    if (previewActionRow) {
        const validBtns = embedStudioButtons.filter(b => b.label.trim() && b.url.trim() && b.url.startsWith('http'));
        if (validBtns.length > 0) {
            previewActionRow.style.display = 'flex';
            previewActionRow.innerHTML = validBtns.map(b => `
                <a href="${escapeHtml(b.url)}" target="_blank" rel="noopener" class="discord-link-btn">
                    <span>${escapeHtml(b.label)}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
                </a>
            `).join('');
        } else {
            previewActionRow.style.display = 'none';
        }
    }
}

async function sendEmbedLive() {
    const channelSelect = document.getElementById('embedChannelSelect');
    const channelId = channelSelect?.value;
    if (!channelId) {
        showToast('يرجى اختيار القناة المستهدفة أولاً', 'error');
        if (channelSelect) channelSelect.focus();
        return;
    }

    const plainContent = document.getElementById('embedPlainContent')?.value?.trim();
    const title = document.getElementById('embedTitle')?.value?.trim();
    const titleUrl = document.getElementById('embedTitleUrl')?.value?.trim();
    const description = document.getElementById('embedDescription')?.value?.trim();
    const color = document.getElementById('embedColorHex')?.value?.trim() || '#5865F2';

    const authorName = document.getElementById('embedAuthorName')?.value?.trim();
    const authorIcon = document.getElementById('embedAuthorIcon')?.value?.trim();
    const authorUrl = document.getElementById('embedAuthorUrl')?.value?.trim();

    const thumbUrl = document.getElementById('embedThumbnailUrl')?.value?.trim();
    const imgUrl = document.getElementById('embedImageUrl')?.value?.trim();

    const footerText = document.getElementById('embedFooterText')?.value?.trim();
    const footerIcon = document.getElementById('embedFooterIcon')?.value?.trim();
    const includeTimestamp = document.getElementById('embedIncludeTimestamp')?.checked ?? true;

    const validFields = embedStudioFields
        .filter(f => f.name.trim() && f.value.trim())
        .map(f => ({ name: f.name.trim(), value: f.value.trim(), inline: !!f.inline }));

    const validButtons = embedStudioButtons
        .filter(b => b.label.trim() && b.url.trim() && b.url.startsWith('http'))
        .map(b => ({ label: b.label.trim(), url: b.url.trim() }));

    const hasEmbedContent = title || description || authorName || thumbUrl || imgUrl || footerText || validFields.length > 0;

    if (!plainContent && !hasEmbedContent) {
        showToast('يرجى إدخال محتوى أو عنوان أو حقول للإمبد', 'error');
        return;
    }

    const payload = {
        channelId,
        content: plainContent || undefined,
        buttons: validButtons.length > 0 ? validButtons : undefined
    };

    if (hasEmbedContent) {
        payload.embed = {
            title: title || undefined,
            url: titleUrl || undefined,
            description: description || undefined,
            color: color || '#5865F2',
            author: authorName ? {
                name: authorName,
                iconURL: authorIcon || undefined,
                url: authorUrl || undefined
            } : undefined,
            thumbnail: thumbUrl || undefined,
            image: imgUrl || undefined,
            footer: footerText ? {
                text: footerText,
                iconURL: footerIcon || undefined
            } : undefined,
            timestamp: includeTimestamp,
            fields: validFields.length > 0 ? validFields : undefined
        };
    }

    const btnPublish = document.getElementById('btnSendEmbedLive');
    const originalText = btnPublish ? btnPublish.innerHTML : '';

    try {
        if (btnPublish) {
            btnPublish.disabled = true;
            btnPublish.innerHTML = '<span>جاري الإرسال...</span>';
        }

        const res = await fetch('/api/embed/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast('تم إرسال ونشر الإمبد بنجاح في القناة!');
        } else {
            showToast(data.error || 'تعذر إرسال الإمبد', 'error');
        }
    } catch (err) {
        console.error('Error dispatching embed:', err);
        showToast('خطأ في الاتصال بالخادم أثناء الإرسال', 'error');
    } finally {
        if (btnPublish) {
            btnPublish.disabled = false;
            btnPublish.innerHTML = originalText;
        }
    }
}

async function fetchEmbedTemplates() {
    try {
        const res = await fetch('/api/embeds/templates');
        if (!res.ok) return;
        savedEmbedTemplates = await res.json();

        const select = document.getElementById('embedTemplateSelect');
        if (!select) return;

        if (savedEmbedTemplates.length === 0) {
            select.innerHTML = '<option value="">لا توجد قوالب محفوظة بعد</option>';
        } else {
            select.innerHTML = `<option value="">اختر قالباً محفوظاً (${savedEmbedTemplates.length})...</option>`;
            savedEmbedTemplates.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                select.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('Error in fetchEmbedTemplates:', err);
    }
}

function loadSelectedTemplate() {
    const select = document.getElementById('embedTemplateSelect');
    const id = select?.value;
    if (!id) {
        showToast('يرجى اختيار قالب لتحميله', 'error');
        return;
    }

    const template = savedEmbedTemplates.find(t => String(t.id) === String(id));
    if (!template) {
        showToast('القالب غير موجود', 'error');
        return;
    }

    let data = template.data;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch {
            showToast('تعذر فك تشفير بيانات القالب', 'error');
            return;
        }
    }

    const setVal = (elemId, val) => {
        const el = document.getElementById(elemId);
        if (el) el.value = val || '';
    };

    setVal('embedPlainContent', data.content);
    setVal('embedAuthorName', data.author?.name);
    setVal('embedAuthorIcon', data.author?.iconURL);
    setVal('embedAuthorUrl', data.author?.url);
    setVal('embedTitle', data.title);
    setVal('embedTitleUrl', data.url);
    setVal('embedDescription', data.description);
    setVal('embedThumbnailUrl', data.thumbnail);
    setVal('embedImageUrl', data.image);
    setVal('embedFooterText', data.footer?.text);
    setVal('embedFooterIcon', data.footer?.iconURL);

    const tsCheck = document.getElementById('embedIncludeTimestamp');
    if (tsCheck) tsCheck.checked = data.timestamp !== false;

    const color = data.color || '#5865F2';
    setVal('embedColorHex', color);
    const picker = document.getElementById('embedColorPicker');
    if (picker) picker.value = color.toLowerCase();
    document.querySelectorAll('#embedColorSwatches .swatch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color').toUpperCase() === color.toUpperCase());
    });

    embedStudioFields = Array.isArray(data.fields) ? data.fields.map(f => ({ name: f.name || '', value: f.value || '', inline: !!f.inline })) : [];
    embedStudioButtons = Array.isArray(data.buttons) ? data.buttons.map(b => ({ label: b.label || '', url: b.url || '' })) : [];

    renderEmbedFieldsInputs();
    renderEmbedButtonsInputs();
    renderEmbedPreview();

    showToast(`تم تحميل القالب: "${template.name}"`);
}

async function confirmSaveTemplate() {
    const input = document.getElementById('templateSaveNameInput');
    const name = input?.value?.trim();
    if (!name) {
        showToast('يرجى إدخال اسم للقالب', 'error');
        if (input) input.focus();
        return;
    }

    const plainContent = document.getElementById('embedPlainContent')?.value?.trim();
    const title = document.getElementById('embedTitle')?.value?.trim();
    const titleUrl = document.getElementById('embedTitleUrl')?.value?.trim();
    const description = document.getElementById('embedDescription')?.value?.trim();
    const color = document.getElementById('embedColorHex')?.value?.trim() || '#5865F2';

    const authorName = document.getElementById('embedAuthorName')?.value?.trim();
    const authorIcon = document.getElementById('embedAuthorIcon')?.value?.trim();
    const authorUrl = document.getElementById('embedAuthorUrl')?.value?.trim();

    const thumbUrl = document.getElementById('embedThumbnailUrl')?.value?.trim();
    const imgUrl = document.getElementById('embedImageUrl')?.value?.trim();

    const footerText = document.getElementById('embedFooterText')?.value?.trim();
    const footerIcon = document.getElementById('embedFooterIcon')?.value?.trim();
    const includeTimestamp = document.getElementById('embedIncludeTimestamp')?.checked ?? true;

    const templateData = {
        content: plainContent || undefined,
        title: title || undefined,
        url: titleUrl || undefined,
        description: description || undefined,
        color,
        author: authorName ? { name: authorName, iconURL: authorIcon || undefined, url: authorUrl || undefined } : undefined,
        thumbnail: thumbUrl || undefined,
        image: imgUrl || undefined,
        footer: footerText ? { text: footerText, iconURL: footerIcon || undefined } : undefined,
        timestamp: includeTimestamp,
        fields: embedStudioFields.filter(f => f.name.trim() || f.value.trim()),
        buttons: embedStudioButtons.filter(b => b.label.trim() && b.url.trim())
    };

    try {
        const res = await fetch('/api/embeds/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data: templateData })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast('تم حفظ القالب بنجاح');
            closeSaveTemplateModal();
            await fetchEmbedTemplates();
            const select = document.getElementById('embedTemplateSelect');
            if (select && data.id) select.value = data.id;
        } else {
            showToast(data.error || 'فشل في حفظ القالب', 'error');
        }
    } catch (err) {
        console.error('Error saving template:', err);
        showToast('خطأ في الاتصال بالخادم أثناء حفظ القالب', 'error');
    }
}

async function deleteSelectedTemplate() {
    const select = document.getElementById('embedTemplateSelect');
    const id = select?.value;
    if (!id) {
        showToast('يرجى تحديد القالب المراد حذفه', 'error');
        return;
    }

    const template = savedEmbedTemplates.find(t => String(t.id) === String(id));
    const name = template ? template.name : 'هذا القالب';

    if (!confirm(`هل أنت متأكد من حذف القالب "${name}"؟`)) return;

    try {
        const res = await fetch(`/api/embeds/templates/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('تم حذف القالب بنجاح');
            await fetchEmbedTemplates();
        } else {
            showToast(data.error || 'فشل في حذف القالب', 'error');
        }
    } catch (err) {
        console.error('Error deleting template:', err);
        showToast('خطأ في الاتصال بالخادم أثناء الحذف', 'error');
    }
}

function clearEmbedForm() {
    if (!confirm('هل تريد مسح كافة حقول الإمبد والمعاينة الحية؟')) return;

    const fieldIds = [
        'embedPlainContent',
        'embedAuthorName',
        'embedAuthorIcon',
        'embedAuthorUrl',
        'embedTitle',
        'embedTitleUrl',
        'embedDescription',
        'embedThumbnailUrl',
        'embedImageUrl',
        'embedFooterText',
        'embedFooterIcon'
    ];

    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    const colorHex = document.getElementById('embedColorHex');
    if (colorHex) colorHex.value = '#5865F2';
    const colorPicker = document.getElementById('embedColorPicker');
    if (colorPicker) colorPicker.value = '#5865f2';

    document.querySelectorAll('#embedColorSwatches .swatch-btn').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
    });

    const tsCheck = document.getElementById('embedIncludeTimestamp');
    if (tsCheck) tsCheck.checked = true;

    embedStudioFields = [];
    embedStudioButtons = [];

    renderEmbedFieldsInputs();
    renderEmbedButtonsInputs();
    renderEmbedPreview();

    showToast('تمت استعادة حالة النموذج الافتراضية');
}

// ----------------------------------------------------
// Utility Functions
// ----------------------------------------------------
function formatTimeAgo(date) {
    if (!date || isNaN(date.getTime())) return '—';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'منذ لحظات';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `منذ ${minutes} د`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} س`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} ي`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function downloadBlob(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 150);
}
