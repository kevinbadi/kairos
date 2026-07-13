/**
 * First-run intro: the CreatorOS 3D wordmark animation, then the KAIROS
 * wordmark, then an animated checkmark rundown of everything Kai can do.
 * Ported from the CreatorOS CLI banner so the look matches the app exactly.
 *
 * Block glyphs (█) carry an animated truecolor gradient; the box-drawing
 * edge characters render dim as the extruded 3D face. Non-TTY / NO_COLOR /
 * CI terminals get a plain-text fallback.
 */

type Rgb = [number, number, number];

const FONT: Record<string, string[]> = {
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  K: ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
};
const ROWS = 6;

// CreatorOS app palette: electric cyan → silver chrome → steel cyan
const CREATOROS_STOPS: Rgb[] = [
  [0, 229, 255],
  [225, 232, 240],
  [56, 189, 248],
];
// Kairos palette: amber → warm white → gold (kairos: the opportune moment)
const KAIROS_STOPS: Rgb[] = [
  [255, 176, 0],
  [255, 244, 214],
  [255, 122, 26],
];

const fg = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;
const DIM_EDGE = '\x1b[38;2;71;85;105m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = fg([0, 229, 255]);
const SILVER = fg([203, 213, 225]);
const EDGE_CHARS = new Set(['╔', '╗', '╚', '╝', '║', '═']);

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function isFancy(): boolean {
  return Boolean(
    process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI && !process.env.KAIROS_NO_BANNER,
  );
}

function renderRows(text: string): string[] {
  const rows = Array.from({ length: ROWS }, () => '');
  for (const ch of text) {
    const glyph = FONT[ch];
    if (!glyph) continue;
    for (let r = 0; r < ROWS; r++) rows[r] = (rows[r] ?? '') + (glyph[r] ?? '');
  }
  return rows;
}

function gradientAt(stops: Rgb[], t: number): Rgb {
  const clamped = ((t % 1) + 1) % 1;
  // ping-pong so the sweep wraps smoothly instead of snapping
  const p = clamped < 0.5 ? clamped * 2 : (1 - clamped) * 2;
  const seg = p * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const f = seg - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function paintFrame(
  rows: string[],
  width: number,
  revealCols: number,
  hueOffset: number,
  stops: Rgb[],
): string {
  const out: string[] = [];
  for (const row of rows) {
    let line = '';
    const chars = [...row];
    for (let c = 0; c < chars.length; c++) {
      const ch = chars[c]!;
      if (c >= revealCols || ch === ' ') {
        line += ' ';
      } else if (EDGE_CHARS.has(ch)) {
        line += DIM_EDGE + ch;
      } else {
        const nearEdge = revealCols - c <= 4 && revealCols < width;
        const color: Rgb = nearEdge ? [255, 255, 255] : gradientAt(stops, c / width + hueOffset);
        line += fg(color) + ch;
      }
    }
    out.push(line + RESET);
  }
  return out.join('\n');
}

/** Left-to-right reveal with a bright leading edge, then a shimmer sweep. */
export async function showWordmark(text: string, tagline: string, stops: Rgb[]): Promise<void> {
  const rows = renderRows(text);
  const width = [...(rows[0] ?? '')].length;
  const stdout = process.stdout;
  // columns can be 0/undefined on some ptys — assume a modern wide terminal then
  const fancy = isFancy() && (stdout.columns || 120) >= width + 2;
  if (!fancy) {
    console.log(`${text} — ${tagline}`);
    return;
  }
  const centeredTagline = ' '.repeat(Math.max(0, Math.floor((width - tagline.length) / 2))) + tagline;
  stdout.write('\x1b[?25l\n'); // hide cursor
  try {
    const REVEAL_FRAMES = 18;
    const SHIMMER_FRAMES = 14;
    let first = true;
    for (let f = 0; f < REVEAL_FRAMES + SHIMMER_FRAMES; f++) {
      const progress = Math.min(1, f / (REVEAL_FRAMES - 1));
      const eased = 1 - (1 - progress) ** 3;
      const revealCols = Math.ceil(eased * width);
      const hueOffset = f * 0.045;
      if (!first) stdout.write(`\x1b[${ROWS}A`); // cursor back to frame top
      stdout.write(paintFrame(rows, width, revealCols, hueOffset, stops) + '\n');
      first = false;
      await sleep(f < REVEAL_FRAMES ? 32 : 45);
    }
    stdout.write(`\x1b[2m\x1b[3m${centeredTagline}${RESET}\n\n`);
  } finally {
    stdout.write('\x1b[?25h'); // restore cursor
  }
}

export interface ChecklistItem {
  name: string;
  detail: string;
}

/** Everything Kai can actually do and has access to — shown on first run. */
export const KAIROS_CAPABILITIES: ChecklistItem[] = [
  { name: 'Post every format', detail: 'shortform, longform, carousels, threads — one call, every account' },
  { name: 'Scheduled publishing', detail: 'CreatorOS servers publish — your laptop can sleep' },
  { name: 'Comment auto-replies', detail: 'triaged & answered in your brand voice, sensitive stuff escalated' },
  { name: 'DM auto-replies', detail: 'X, Instagram, Facebook, Reddit + more' },
  { name: 'Comments-to-DM funnels', detail: 'keyword comment → automatic DM with your link, click-tracked' },
  { name: 'Analytics', detail: 'follower growth, best posts, best times, weekly report' },
  { name: 'Automations', detail: 'all four pillars on crons — this Mac or an always-on cloud' },
  { name: 'Guardrails', detail: 'endpoint allowlist in code, plan/billing untouchable, keys masked' },
];

/** Animated drop-down checklist: pending ring pops into a cyan check. */
export async function showChecklist(items: ChecklistItem[], heading: string): Promise<void> {
  const stdout = process.stdout;
  if (!isFancy()) {
    console.log(heading);
    for (const item of items) console.log(`  ✔ ${item.name} — ${item.detail}`);
    console.log('');
    return;
  }
  stdout.write(`${DIM}${heading}${RESET}\n\n`);
  stdout.write('\x1b[?25l');
  try {
    // one item at a time: a pending ring appears, pops into a cyan check,
    // then holds long enough to actually be read before the next drops in
    for (const item of items) {
      stdout.write(`  ${DIM}○ ${item.name}${RESET}`);
      await sleep(260);
      stdout.write(`\r\x1b[2K  ${CYAN}✔${RESET} ${SILVER}${item.name}${RESET}${DIM} — ${item.detail}${RESET}\n`);
      await sleep(430);
    }
    stdout.write('\n');
  } finally {
    stdout.write('\x1b[?25h');
  }
}

/**
 * The full first-run sequence: CreatorOS animation → Kairos animation →
 * capability checkmarks. Runs once, right before the onboarding interview.
 */
export async function showIntro(): Promise<void> {
  await showWordmark('CREATOR OS', 'the operating system for social media', CREATOROS_STOPS);
  await showWordmark('KAIROS', 'your CreatorOS agent · posts · replies · reports', KAIROS_STOPS);
  await showChecklist(KAIROS_CAPABILITIES, "what Kai runs for you");
}
