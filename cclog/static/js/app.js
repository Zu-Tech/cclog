/* ════════════════════════════════════════════════
   cclog — Cartographic Data Atlas
   Client-side interactions
   ════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    initActivityChart();
    initHeatmap();
    initSearch();
    initConversationView();
    initKeyboardShortcuts();
    checkForUpdate();
    autoRefresh();
});

/* ── Session refresh ───────────────────────── */
let _refreshing = false;

async function callRefresh() {
    if (_refreshing) return null;
    _refreshing = true;
    try {
        const res = await fetch('/api/v1/refresh', { method: 'POST' });
        return await res.json();
    } catch (e) {
        return null;
    } finally {
        _refreshing = false;
    }
}

async function autoRefresh() {
    // Only auto-refresh on pages that display session lists
    if (!document.querySelector('.session-list, .stats-grid, .projects-grid')) return;
    const key = 'cclog_refreshed';
    if (sessionStorage.getItem(key)) {
        sessionStorage.removeItem(key);
        return;
    }
    const data = await callRefresh();
    if (data && data.new > 0) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
    }
}

async function refreshSessions() {
    const btn = document.getElementById('refresh-btn');
    if (!btn) return;
    btn.classList.add('spinning');
    btn.disabled = true;
    const data = await callRefresh();
    if (data && data.new > 0) {
        window.location.reload();
    } else {
        btn.querySelector('span').textContent = 'Up to date';
        setTimeout(() => {
            btn.querySelector('span').textContent = 'Refresh';
            btn.classList.remove('spinning');
            btn.disabled = false;
        }, 1500);
    }
}

/* ── Update check ──────────────────────────── */
async function checkForUpdate() {
    try {
        const res = await fetch('/api/v1/version');
        const data = await res.json();
        if (data.update_available) {
            const banner = document.getElementById('update-banner');
            const text = document.getElementById('update-text');
            if (banner && text) {
                text.textContent = `${data.current} → ${data.latest}`;
                banner.style.display = 'block';
            }
        }
    } catch (e) {}
}

/* ── Activity chart ────────────────────────── */
function initActivityChart() {
    const container = document.getElementById('activity-chart');
    if (!container || !window.__dailyActivity) return;

    const data = window.__dailyActivity;
    if (data.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activity data yet</p></div>';
        return;
    }

    // Only show days with actual activity
    const active = data.filter(d => d.tokens > 0);
    if (active.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activity data yet</p></div>';
        return;
    }

    const maxTokens = Math.max(...active.map(d => d.tokens), 1);
    const barArea = 190; // px height for bars

    // Show ~10 date labels evenly spaced
    const labelEvery = Math.max(1, Math.floor(active.length / 10));

    let html = '<div class="chart-inner">';
    html += '<div class="chart-bars">';
    active.forEach((d, i) => {
        // sqrt scale — better than linear (outlier-resistant) and more readable than log
        const pct = Math.sqrt(d.tokens / maxTokens);
        const height = Math.max(8, pct * barArea);
        const tooltip = `${d.date} \u2014 ${d.session_count} sess, ${formatTokens(d.tokens)} tok, $${(d.cost || 0).toFixed(2)}`;
        html += `<div class="chart-col" style="animation-delay:${i * 0.015}s">`;
        html += `<div class="chart-bar" style="height:${height}px" data-tooltip="${tooltip}"></div>`;
        html += `</div>`;
    });
    html += '</div>';
    // Date labels row
    html += '<div class="chart-labels">';
    active.forEach((d, i) => {
        const show = i === 0 || i === active.length - 1 || i % labelEvery === 0;
        const label = d.date.slice(5); // MM-DD
        html += `<span class="chart-date">${show ? label : ''}</span>`;
    });
    html += '</div></div>';

    container.innerHTML = html;
}

/* ── Heatmap (day x hour) ──────────────────── */
function initHeatmap() {
    const container = document.getElementById('heatmap');
    if (!container || !window.__heatmap) return;

    const data = window.__heatmap; // 7 rows (Mon-Sun) x 24 cols
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const allVals = data.flat();
    const maxVal = Math.max(...allVals, 1);

    function getLevel(v) {
        if (v === 0) return 0;
        const r = v / maxVal;
        if (r < 0.15) return 1;
        if (r < 0.35) return 2;
        if (r < 0.55) return 3;
        if (r < 0.8) return 4;
        return 5;
    }

    let html = '<div class="heatmap-grid">';
    // Hour labels
    html += '<div class="heatmap-label"></div>';
    for (let h = 0; h < 24; h++) {
        const lbl = h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h-12) + 'p';
        html += `<div class="heatmap-hour-label">${h % 3 === 0 ? lbl : ''}</div>`;
    }
    // Data rows
    for (let d = 0; d < 7; d++) {
        html += `<div class="heatmap-label">${days[d]}</div>`;
        for (let h = 0; h < 24; h++) {
            const v = data[d][h];
            html += `<div class="heatmap-cell" data-level="${getLevel(v)}" data-tooltip="${days[d]} ${h}:00 — ${v} msgs"></div>`;
        }
    }
    html += '</div>';
    container.innerHTML = html;
}

/* ── Search ────────────────────────────────── */
function initSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    if (!input || !results) return;

    let debounceTimer;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => doSearch(input.value, results), 200);
    });

    if (input.value) doSearch(input.value, results);
}

async function doSearch(query, container) {
    if (!query || query.length < 2) {
        container.innerHTML = '';
        return;
    }

    try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=20`);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
            return;
        }

        container.innerHTML = data.results.map(r => {
            const snippet20 = r.snippet.substring(0, 40).replace(/[^a-zA-Z0-9 ]/g, '');
            return `
            <div class="search-result" onclick="window.location='/sessions/${r.session_id}?highlight=${encodeURIComponent(snippet20)}'">
                <div class="search-result-header">
                    <span class="search-result-project">${esc(r.project.split('/').pop())}</span>
                    <span class="search-result-role">${r.role}</span>
                    <span class="search-result-score">${r.score.toFixed(1)}</span>
                </div>
                <div class="search-result-snippet">${esc(r.snippet)}</div>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Search error: ${e.message}</p></div>`;
    }
}

/* ── Conversation viewer ───────────────────── */
function initConversationView() {
    const view = document.querySelector('.conversation-view');
    if (!view) return;
    loadConversation(view.dataset.sessionId);
}

async function loadConversation(sessionId) {
    const view = document.querySelector('.conversation-view');
    const msgContainer = view.querySelector('.messages-container');

    try {
        const res = await fetch(`/api/v1/sessions/${sessionId}`);
        if (!res.ok) throw new Error('Session not found');
        const data = await res.json();

        // Header
        view.querySelector('.conv-title').textContent = data.display_name;
        view.querySelector('.conv-project-name').textContent = data.project_path.split('/').pop();
        if (data.started_at) {
            view.querySelector('.conv-date').textContent = new Date(data.started_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
        const branchEl = view.querySelector('.conv-branch');
        if (data.git_branch) {
            branchEl.textContent = data.git_branch;
        } else {
            branchEl.style.display = 'none';
        }

        // Tags
        const tagsEl = view.querySelector('.conv-tags');
        const renderTags = (tags) => {
            tagsEl.innerHTML = (tags || []).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('');
        };
        renderTags(data.tags);

        // Favorite
        const favBtn = view.querySelector('.btn-fav');
        if (data.favorite) favBtn.classList.add('active');
        favBtn.onclick = () => toggleFavorite(sessionId, favBtn);

        // Rename
        const titleEl = view.querySelector('.conv-title');
        const editBtn = view.querySelector('.btn-edit-name');
        editBtn.onclick = () => {
            const editing = titleEl.contentEditable === 'true';
            titleEl.contentEditable = editing ? 'false' : 'true';
            if (!editing) {
                titleEl.focus();
                const range = document.createRange();
                range.selectNodeContents(titleEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                saveName(sessionId, titleEl.textContent.trim());
            }
        };
        titleEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); titleEl.contentEditable = 'false'; saveName(sessionId, titleEl.textContent.trim()); }
            if (e.key === 'Escape') { titleEl.contentEditable = 'false'; }
        });

        // Tag input
        const tagInput = view.querySelector('.tag-input');
        tagInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && tagInput.value.trim()) {
                const tags = (data.tags || []).concat(tagInput.value.trim());
                await fetch(`/api/v1/sessions/${sessionId}/meta`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) });
                data.tags = tags;
                renderTags(tags);
                tagInput.value = '';
            }
        });

        // Resume — copy cd + claude --resume command
        const resumeBtn = view.querySelector('.btn-resume');
        if (resumeBtn) {
            const resumeCmd = `cd ${data.project_path} && claude --resume ${sessionId}`;
            resumeBtn.onclick = () => {
                navigator.clipboard.writeText(resumeCmd).then(() => showToast('Copied to clipboard — paste in terminal to resume'));
            };
        }

        // Delete
        view.querySelector('.btn-delete').onclick = async () => {
            if (!confirm('Soft-delete this conversation?\nOriginal files are never modified.')) return;
            await fetch(`/api/v1/sessions/${sessionId}/delete`, { method: 'POST' });
            window.location = '/projects';
        };

        // Messages — skip empty ones, collapse tool-only messages
        const rendered = [];
        for (let i = 0; i < data.messages.length; i++) {
            const msg = data.messages[i];
            const isUser = msg.role === 'user';
            const hasContent = msg.content_html && msg.content_html.trim() && msg.content_html.trim() !== '';
            const hasTools = msg.tool_uses && msg.tool_uses.length > 0;
            const hasThinking = !!msg.thinking;

            // Skip user messages that are just tool results (no visible content)
            if (isUser && !hasContent) continue;
            // Skip assistant messages with no content, no tools, no thinking
            if (!isUser && !hasContent && !hasTools && !hasThinking) continue;

            const roleClass = isUser ? 'message-user' : 'message-assistant';
            const sidechainClass = msg.is_sidechain ? 'message-sidechain' : '';

            let toolsHtml = '';
            if (hasTools) {
                const toolCount = msg.tool_uses.length;
                const toolSummary = msg.tool_uses.slice(0, 3).map(t => esc(t.name)).join(', ');
                const moreText = toolCount > 3 ? ` +${toolCount - 3} more` : '';
                toolsHtml = `
                    <div class="tools-summary" onclick="this.nextElementSibling.classList.toggle('show');this.querySelector('.arrow').classList.toggle('open')">
                        <span class="arrow">\u25b8</span>
                        <span class="tools-label">${toolCount} tool call${toolCount > 1 ? 's' : ''}</span>
                        <span class="tools-names">${toolSummary}${moreText}</span>
                    </div>
                    <div class="tools-detail">${msg.tool_uses.map(t => `
                        <div class="tool-block">
                            <div class="tool-name">${esc(t.name)}</div>
                            <div class="tool-preview">${esc(t.input_preview)}</div>
                        </div>`).join('')}
                    </div>`;
            }

            let thinkingHtml = '';
            if (hasThinking) {
                thinkingHtml = `
                    <div class="thinking-block">
                        <button class="thinking-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('show')">
                            <span class="arrow">\u25b8</span> Thinking\u2026
                        </button>
                        <div class="thinking-content">${esc(msg.thinking)}</div>
                    </div>`;
            }

            const roleLabel = isUser ? 'You' : 'Claude';
            const modelHtml = msg.model ? `<span class="message-model">${esc(msg.model.replace('claude-', ''))}</span>` : '';
            const tokensHtml = msg.input_tokens ? `<span class="message-tokens">${formatTokens(msg.input_tokens + (msg.output_tokens || 0))}</span>` : '';
            const timeHtml = msg.timestamp ? `<span class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : '';

            rendered.push(`
                <div class="message ${roleClass} ${sidechainClass}" style="animation-delay:${Math.min(rendered.length * 0.03, 0.6)}s">
                    <div class="message-header">
                        <span class="message-role">${roleLabel}</span>
                        ${modelHtml}
                        ${tokensHtml}
                        ${timeHtml}
                    </div>
                    ${thinkingHtml}
                    ${hasContent ? `<div class="message-body">${msg.content_html}</div>` : ''}
                    ${toolsHtml}
                </div>`);
        }
        msgContainer.innerHTML = rendered.join('');

        // Scroll to highlighted message if ?highlight= is present
        const params = new URLSearchParams(window.location.search);
        const highlight = params.get('highlight');
        if (highlight) {
            const lowerHL = highlight.toLowerCase();
            const allMsgs = msgContainer.querySelectorAll('.message');
            for (const el of allMsgs) {
                if (el.textContent.toLowerCase().includes(lowerHL)) {
                    el.style.boxShadow = '0 0 0 2px var(--green), 0 0 20px var(--green-ghost)';
                    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
                    break;
                }
            }
        }

    } catch (e) {
        msgContainer.innerHTML = `<div class="empty-state"><p>Failed to load conversation</p><p class="empty-hint">${e.message}</p></div>`;
    }
}

async function toggleFavorite(sessionId, btn) {
    const isFav = btn.classList.toggle('active');
    await fetch(`/api/v1/sessions/${sessionId}/meta`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: isFav }) });
}

async function saveName(sessionId, name) {
    await fetch(`/api/v1/sessions/${sessionId}/meta`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

/* ── Keyboard shortcuts ────────────────────── */
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
            const input = document.getElementById('search-input');
            if (input && document.activeElement !== input && document.activeElement.contentEditable !== 'true') {
                e.preventDefault();
                input.focus();
            }
        }
    });
}

/* ── Utilities ─────────────────────────────── */
function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatTokens(n) {
    if (!n) return '0';
    if (n > 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n > 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(80px)';
    }, 2500);
}
