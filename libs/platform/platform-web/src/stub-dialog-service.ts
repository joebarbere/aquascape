// Stage 0 stub. Until F1.4 introduces real HTML dialog UI, the web stub
// auto-resolves both prompts. Defaults are documented inline so features can
// build against them without surprise:
//   * `confirm` returns `true` — destructive flows under test should override
//     this with a mock that returns `false` to cover the cancel branch.
//   * `alert` resolves immediately.

import type { DialogService } from '@aquascape/platform/platform-api';

export class StubDialogService implements DialogService {
  async confirm(_args: { title: string; message: string; danger?: boolean }): Promise<boolean> {
    return true;
  }

  async alert(_args: { title: string; message: string }): Promise<void> {
    return;
  }
}
