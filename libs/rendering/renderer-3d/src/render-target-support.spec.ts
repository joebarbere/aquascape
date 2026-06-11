import {
  detectRenderTargetEffectsSupport,
  SOFTWARE_RENDERER_PATTERN,
  type RenderTargetGlContextLike,
} from './render-target-support';

/**
 * The `pname` the stub's debug-info extension hands back. Arbitrary — the
 * detection passes whatever the extension object carries straight into
 * `getParameter`, so the stub just needs the round-trip to line up.
 */
const UNMASKED_RENDERER_WEBGL = 0x9246;

interface StubOptions {
  /** Renderer string the debug-info extension reports. `null` = extension blocked. */
  rendererString?: string | null;
  /** Structural WebGL2 marker. */
  webgl2?: boolean;
  /** Whether WebGL1's `WEBGL_depth_texture` extension is present. */
  depthTextureExt?: boolean;
  /** Make `getParameter` throw (hostile / torn-down context). */
  throwOnGetParameter?: boolean;
}

function stubContext({
  rendererString = 'NVIDIA GeForce RTX 3060/PCIe/SSE2',
  webgl2 = true,
  depthTextureExt = false,
  throwOnGetParameter = false,
}: StubOptions = {}): RenderTargetGlContextLike {
  const ctx: RenderTargetGlContextLike = {
    getExtension(name: string): unknown {
      if (name === 'WEBGL_debug_renderer_info') {
        return rendererString === null ? null : { UNMASKED_RENDERER_WEBGL };
      }
      if (name === 'WEBGL_depth_texture') {
        return depthTextureExt ? {} : null;
      }
      return null;
    },
    getParameter(pname: number): unknown {
      if (throwOnGetParameter) throw new Error('context lost');
      if (pname === UNMASKED_RENDERER_WEBGL) return rendererString;
      return null;
    },
  };
  if (webgl2) {
    ctx.texImage3D = (): void => undefined;
  }
  return ctx;
}

describe('detectRenderTargetEffectsSupport — Bucket 0 capability gate', () => {
  it('hardware WebGL2 → supported', () => {
    expect(detectRenderTargetEffectsSupport(stubContext())).toBe(true);
  });

  it('SwiftShader renderer string → unsupported (the SSAO blank-canvas case)', () => {
    const ctx = stubContext({
      rendererString: 'Google SwiftShader',
    });
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('ANGLE-on-SwiftShader renderer string → unsupported', () => {
    const ctx = stubContext({
      rendererString: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    });
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('llvmpipe / softpipe / generic "software" strings → unsupported', () => {
    for (const name of [
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'softpipe',
      'Microsoft Basic Render Driver (software)',
    ]) {
      expect(detectRenderTargetEffectsSupport(stubContext({ rendererString: name }))).toBe(
        false,
      );
    }
  });

  it('hardware WebGL1 WITHOUT the WEBGL_depth_texture extension → unsupported', () => {
    const ctx = stubContext({ webgl2: false, depthTextureExt: false });
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('hardware WebGL1 WITH the WEBGL_depth_texture extension → supported', () => {
    const ctx = stubContext({ webgl2: false, depthTextureExt: true });
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(true);
  });

  it('blocked WEBGL_debug_renderer_info extension → unsupported (cannot prove hardware)', () => {
    const ctx = stubContext({ rendererString: null });
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('non-string UNMASKED_RENDERER_WEBGL value → unsupported', () => {
    const ctx = stubContext();
    ctx.getParameter = () => 12345;
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('throwing getParameter → unsupported (defensive)', () => {
    const ctx = stubContext({ throwOnGetParameter: true });
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('throwing getExtension → unsupported (defensive)', () => {
    const ctx: RenderTargetGlContextLike = {
      getExtension(): unknown {
        throw new Error('hostile context');
      },
      getParameter(): unknown {
        return null;
      },
    };
    expect(detectRenderTargetEffectsSupport(ctx)).toBe(false);
  });

  it('null / undefined context → unsupported', () => {
    expect(detectRenderTargetEffectsSupport(null)).toBe(false);
    expect(detectRenderTargetEffectsSupport(undefined)).toBe(false);
  });
});

describe('SOFTWARE_RENDERER_PATTERN', () => {
  it('is case-insensitive', () => {
    expect(SOFTWARE_RENDERER_PATTERN.test('SWIFTSHADER')).toBe(true);
    expect(SOFTWARE_RENDERER_PATTERN.test('SwiftShader')).toBe(true);
    expect(SOFTWARE_RENDERER_PATTERN.test('LLVMPIPE')).toBe(true);
  });

  it('does not match real-GPU renderer strings', () => {
    for (const name of [
      'NVIDIA GeForce RTX 3060/PCIe/SSE2',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'AMD Radeon Pro 5500M OpenGL Engine',
      'Mali-G78 MP20',
    ]) {
      expect(SOFTWARE_RENDERER_PATTERN.test(name)).toBe(false);
    }
  });
});
