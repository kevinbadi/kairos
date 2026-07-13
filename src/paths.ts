import { join } from 'node:path';

/**
 * Everything Kairos writes for the user lives under `kairos/` in the
 * workspace root. The whole directory is gitignored — it holds the brand
 * pack, profile map, config, skills, and knowledge base for one client.
 */
export interface KairosPaths {
  root: string;
  kairosDir: string;
  brandMd: string;
  profilesMd: string;
  configJson: string;
  setupStateJson: string;
  skillsDir: string;
  knowledgeDir: string;
  competitorsMd: string;
  tutorialsMd: string;
  contentLibraryDir: string;
}

export function kairosPaths(root: string = process.cwd()): KairosPaths {
  const kairosDir = join(root, 'kairos');
  const knowledgeDir = join(kairosDir, 'knowledge');
  return {
    root,
    kairosDir,
    brandMd: join(kairosDir, 'BRAND.md'),
    profilesMd: join(kairosDir, 'PROFILES.md'),
    configJson: join(kairosDir, 'kairos.json'),
    setupStateJson: join(kairosDir, '.setup-state.json'),
    skillsDir: join(kairosDir, 'skills'),
    knowledgeDir,
    competitorsMd: join(knowledgeDir, 'COMPETITORS.md'),
    tutorialsMd: join(knowledgeDir, 'TUTORIALS.md'),
    contentLibraryDir: join(root, 'content-library'),
  };
}
