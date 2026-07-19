/**
 * The panel registry. Adding a dashboard card = adding one file in this
 * directory that default-exports { id, title, icon, route, fetchData?,
 * render } and listing it here. That's the whole integration — the shell
 * (app.js) builds the sidebar, routing, caching, and loading states.
 * See "How to add your own panel" in the README for a worked example.
 */
import overview from './overview.js';
import understanding from './understanding.js';
import automations from './automations.js';
import content from './content.js';
import brand from './brand.js';
import training from './training.js';
import logs from './logs.js';
import chat from './chat.js';

export const panels = [overview, understanding, automations, content, brand, training, logs, chat];
