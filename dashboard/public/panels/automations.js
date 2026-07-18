/**
 * Automations — every automation the agent runs: on/off state, the system
 * prompt driving it, and per-automation outcome stats from the activity
 * log. Live Creator OS API state is overlaid where it exists.
 */
export default {
  id: 'automations',
  title: 'Automations',
  subtitle: 'What the agent runs on its own — and whether it is performing',
  icon: '⟳',
  route: '/automations',

  fetchData: ({ api }) => api('/api/automations'),

  render(root, data, ctx) {
    const { h, card, badge, timeAgo, note } = ctx;

    if (!data.connected) {
      const hint = note('automations-connect',
        'Automation state comes from your local config plus the CreatorOS API. Connect an account (npm start creatoros kairos) to see live state.');
      if (hint) root.append(hint);
    }

    for (const a of data.automations) {
      const stats = a.stats;
      root.append(
        h('div', { class: 'card-solid', style: 'margin-bottom:16px' },
          h('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' },
            h('div', { class: 'card-title', style: 'margin:0;flex:1' }, a.name),
            stats?.failed ? badge(`${stats.failed} failed`, 'failed') : null,
            badge(a.enabled ? 'on' : 'off', a.enabled ? 'sent' : 'skipped'),
          ),
          h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' },
            (a.platforms ?? []).map((p) => h('span', { class: 'chip chip-static' }, p)),
            (a.keywords ?? []).map((k) => h('span', { class: 'chip chip-static chip-on' }, `"${k}"`)),
          ),
          a.systemPrompt
            ? h('details', { style: 'margin-top:12px' },
                h('summary', { style: 'cursor:pointer;color:var(--text-3);font-size:13px;font-weight:600' }, 'system prompt'),
                h('pre', { style: 'margin-top:8px;padding:12px;border-radius:12px;background:var(--inset);border:1px solid var(--border);font-size:12.5px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:var(--text-2)' },
                  a.systemPrompt))
            : h('p', { style: 'margin-top:10px;color:var(--text-4);font-size:13px' }, 'No system prompt configured yet — set the persona during onboarding or ask Kai in the chat.'),
          a.escalate?.length
            ? h('p', { style: 'margin-top:10px;font-size:12.5px;color:var(--text-4)' }, `Always escalated to you: ${a.escalate.join(', ')}`)
            : null,
          h('p', { class: 'stat-sub num', style: 'margin-top:10px' },
            stats
              ? `last run ${timeAgo(stats.lastTs)} · ${stats.sent} sent · ${stats.skipped} skipped · ${stats.failed} failed`
              : 'no runs observed in the activity log yet'),
        ),
      );
    }

    /* ---- scheduled crons + roadmap, as collapsible reference cards ---- */
    root.append(
      h('details', { class: 'card-solid', style: 'margin-bottom:16px' },
        h('summary', {}, 'Scheduled automations (cron)'),
        h('div', { class: 'details-body' },
          data.crons.output
            ? h('pre', { style: 'padding:12px;border-radius:12px;background:var(--inset);border:1px solid var(--border);font-size:12.5px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:var(--text-2)' }, data.crons.output)
            : h('p', { style: 'color:var(--text-3)' }, 'No cron automations registered yet — ask Kai to create the starter crons.'),
        )),
      h('details', { class: 'card-solid' },
        h('summary', {}, 'Workflow catalog & roadmap'),
        h('div', { class: 'details-body' },
          data.catalog.map((w) => h('div', { class: 'feed-row' },
            badge(w.status === 'live' ? 'live' : w.status === 'available' ? 'ready' : 'soon',
              w.status === 'live' ? 'sent' : w.status === 'available' ? 'skipped' : 'pending'),
            h('span', { class: 'what' }, w.name),
            h('span', { class: 'meta' }, w.description),
          )),
        )),
    );
  },
};
