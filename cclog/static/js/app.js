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
});

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

        // Delete
        view.querySelector('.btn-delete').onclick = async () => {
            if (!confirm('Soft-delete this conversation?\nOriginal files are never modified.')) return;
            await fetch(`/api/v1/sessions/${sessionId}/delete`, { method: 'POST' });
            window.location = '/projects';
        };

        // Messages
        msgContainer.innerHTML = data.messages.map((msg, i) => {
            const isUser = msg.role === 'user';
            const roleClass = isUser ? 'message-user' : 'message-assistant';
            const sidechainClass = msg.is_sidechain ? 'message-sidechain' : '';

            let toolsHtml = '';
            if (msg.tool_uses && msg.tool_uses.length > 0) {
                toolsHtml = msg.tool_uses.map(t => `
                    <div class="tool-block">
                        <div class="tool-name">${esc(t.name)}</div>
                        <div class="tool-preview">${esc(t.input_preview)}</div>
                    </div>
                `).join('');
            }

            let thinkingHtml = '';
            if (msg.thinking) {
                thinkingHtml = `
                    <div class="thinking-block">
                        <button class="thinking-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('show')">
                            <span class="arrow">\u25b8</span> Thinking\u2026
                        </button>
                        <div class="thinking-content">${esc(msg.thinking)}</div>
                    </div>`;
            }

            const modelHtml = msg.model ? `<span class="message-model">${esc(msg.model.replace('claude-', ''))}</span>` : '';
            const tokensHtml = msg.input_tokens ? `<span class="message-tokens">${formatTokens(msg.input_tokens + (msg.output_tokens || 0))} tok</span>` : '';
            const timeHtml = msg.timestamp ? `<span class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : '';

            return `
                <div class="message ${roleClass} ${sidechainClass}" style="animation-delay:${Math.min(i * 0.04, 0.8)}s">
                    <div class="message-header">
                        <span class="message-role">${msg.role}</span>
                        ${modelHtml}
                        ${tokensHtml}
                        ${timeHtml}
                    </div>
                    ${thinkingHtml}
                    <div class="message-body">${msg.content_html || ''}</div>
                    ${toolsHtml}
                </div>`;
        }).join('');

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
