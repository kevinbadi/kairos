/**
 * Logs — the full activity feed with workflow/platform/outcome filters
 * and an expandable raw-JSON view per entry. Errors show the actual
 * error payload, never a sanitized summary.
 */
export default {
  id: 'logs',
  title: 'Logs',
  subtitle: 'Every action the agent took — filter it, expand it, trust it',
  icon: '≣',
  route: '/logs',

  fetchData: ({ api }) => api('/api/activity?limit=500'),

  render(root, data, ctx) {
    const { h, card, badge, dot, timeAgo, api } = ctx;
    const filters = { workflow: '', platform: '', outcome: '' };

    const select = (key, label, options) =>
      h('select', { 'aria-label': label, onchange: (e) => { filters[key] = e.target.value; refresh(); } },
        h('option', { value: '' }, `all ${label}`),
        options.map((o) => h('option', { value: o }, o)));

    const body = h('div', {});
    const renderEntries = (entries) => {
      body.replaceChildren(
        entries.length
          ? h('div', {}, entries.map((e) => h('div', { class: 'feed-row', style: 'flex-wrap:wrap' },
              dot(e.outcome),
              h('span', { class: 'when' }, timeAgo(e.ts)),
              h('span', { class: 'what' }, e.action),
              h('span', { class: 'meta' }, [e.workflow, e.platform, e.target].filter(Boolean).join(' · ')),
              badge(e.outcome, e.outcome),
              e.error ? h('span', { class: 'meta', style: 'flex-basis:100%;padding-left:86px;color:var(--text-2)' }, e.error) : null,
              h('details', {},
                h('summary', {}, 'raw'),
                h('pre', {}, JSON.stringify(e, null, 2))),
            )))
          : h('p', { style: 'color:var(--text-3)' }, 'Nothing matches these filters.'),
      );
    };

    const refresh = async () => {
      const params = new URLSearchParams({ limit: '500' });
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
      try { renderEntries((await api(`/api/activity?${params}`)).entries); }
      catch (error) { body.replaceChildren(h('p', { style: 'color:var(--text-3)' }, `Could not load: ${error.message}`)); }
    };

    root.append(
      h('div', { class: 'filters' },
        select('workflow', 'workflows', data.summary.workflows),
        select('platform', 'platforms', data.summary.platforms),
        select('outcome', 'outcomes', ['sent', 'ok', 'skipped', 'failed']),
      ),
      card('Activity log — logs/activity.jsonl', body),
    );
    renderEntries(data.entries);
  },
};
