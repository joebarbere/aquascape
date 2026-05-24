// Smoke test for the IPC contract registry. Pinning the channel list as a
// runtime constant lets future contributors discover what's allowed across
// the bridge without crawling the type system.

import { IPC_CHANNELS } from './ipc-contract';

describe('IPC_CHANNELS', () => {
  it('lists exactly the F1.4 channel set', () => {
    expect([...IPC_CHANNELS].sort()).toEqual(
      [
        'dialog.alert',
        'dialog.confirm',
        'export.png',
        'file.open',
        'file.save',
        'file.saveAs',
        'ping',
        'storage.get',
        'storage.remove',
        'storage.set',
      ].sort(),
    );
  });
});
