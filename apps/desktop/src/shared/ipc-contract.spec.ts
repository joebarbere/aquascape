// Smoke test for the IPC contract registry. Pinning the channel list as a
// runtime constant lets future contributors discover what's allowed across
// the bridge without crawling the type system.

import { IPC_CHANNELS } from './ipc-contract';

describe('IPC_CHANNELS', () => {
  it('lists exactly the Stage-0 channels', () => {
    expect([...IPC_CHANNELS].sort()).toEqual(['ping']);
  });
});
