// LivestockPulseActions — Stage 11 F11.4 Wave 4.
//
// Tiny smoke spec — there's no reducer or selector to test, but the typed
// action factory still has wire-format guarantees (action.type string,
// payload shape) that downstream code (`LivestockSimulationService`,
// Playwright e2e gestures) relies on.

import { LivestockPulseActions } from './livestock-pulse.actions';

describe('LivestockPulseActions', () => {
  it('feedTank produces the expected action type string', () => {
    // The `Source` + event-name string is part of the public action wire
    // format (devtools, replay tooling). Pinning it prevents an accidental
    // rename from silently breaking subscribers that match by `action.type`.
    expect(LivestockPulseActions.feedTank.type).toBe('[Livestock Pulse] Feed Tank');
  });

  it('feedTank carries an optional spriteCount payload', () => {
    const withCount = LivestockPulseActions.feedTank({ spriteCount: 5 });
    expect(withCount.spriteCount).toBe(5);
    // Empty payload is legal — service picks a default in [3, 6].
    const without = LivestockPulseActions.feedTank({});
    expect(without.spriteCount).toBeUndefined();
  });
});
