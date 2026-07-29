import { registerPlugin } from '@capacitor/core';

import type { CalmNavBackgroundPlugin } from './definitions';

const CalmNavBackground = registerPlugin<CalmNavBackgroundPlugin>('CalmNavBackground', {
  web: () => import('./web').then((m) => new m.CalmNavBackgroundWeb()),
});

export * from './definitions';
export { CalmNavBackground };
