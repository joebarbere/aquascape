// Quake-style developer console for the simulation showcase (bottom-left).
//
// Toggled with the `~`/backtick key (handled by AppComponent so it works even
// when the console is closed). Always mounted while in simulation mode so its log + input
// history survive open/close; a CSS class slides it in/out. Command parsing +
// execution live in `SimulationConsoleService`; this component is just the terminal:
// an output log + a prompt line with command history (↑/↓) and Tab completion.

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';

import { SimulationConsoleService, type ConsoleLine } from './simulation-console.service';
import { SimulationUiService } from './simulation-ui.service';

@Component({
  selector: 'aquascape-simulation-console',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="console"
      [class.console--open]="ui.consoleOpen()"
      role="log"
      aria-label="Simulation console"
      [attr.aria-hidden]="ui.consoleOpen() ? null : true"
    >
      <div #log class="console__log">
        @for (line of lines(); track $index) {
          <div class="console__line console__line--{{ line.kind }}">{{ line.text }}</div>
        }
      </div>
      <div class="console__input">
        <span class="console__prompt" aria-hidden="true">&gt;</span>
        <input
          #field
          type="text"
          class="console__field"
          [value]="input()"
          (input)="onInput($any($event.target).value)"
          (keydown)="onKey($event)"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          aria-label="Console command"
          [attr.tabindex]="ui.consoleOpen() ? 0 : -1"
        />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        position: absolute;
        left: 0;
        bottom: 0;
        z-index: 7;
        width: min(560px, 60vw);
        pointer-events: none;
      }
      .console {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        height: 340px;
        max-height: 55vh;
        background: rgba(6, 12, 18, 0.88);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(120, 200, 230, 0.3);
        border-left: none;
        border-bottom: none;
        border-top-right-radius: 10px;
        color: #d7ecf2;
        font:
          12px/1.5 ui-monospace,
          'SF Mono',
          Menlo,
          Consolas,
          monospace;
        box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
        transition:
          transform 0.18s ease,
          opacity 0.18s ease;
      }
      .console:not(.console--open) {
        transform: translateY(100%);
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .console__log {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 10px 12px;
      }
      .console__line {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .console__line--in {
        color: #9fe0f5;
      }
      .console__line--err {
        color: #ff9a9a;
      }
      .console__input {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
      }
      .console__prompt {
        color: #5ac8f0;
        font-weight: 600;
      }
      .console__field {
        flex: 1 1 auto;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: inherit;
        font: inherit;
        caret-color: #5ac8f0;
      }
    `,
  ],
})
export class SimulationConsoleComponent implements AfterViewInit {
  readonly ui = inject(SimulationUiService);
  private readonly console = inject(SimulationConsoleService);

  @ViewChild('field') private field?: ElementRef<HTMLInputElement>;
  @ViewChild('log') private logEl?: ElementRef<HTMLElement>;

  readonly input = signal('');
  readonly lines = signal<ConsoleLine[]>([
    {
      kind: 'out',
      text: "Aquascape simulation console. Type 'help'. Press ~ to toggle, Esc to close.",
    },
  ]);

  private cmdHistory: string[] = [];
  private histIdx = 0;

  constructor() {
    // Focus the field each time the console opens. setTimeout (macrotask), not
    // a microtask, so the `.console--open` class (which flips visibility from
    // hidden → visible) has been applied by change detection first — a hidden
    // element can't take focus.
    effect(() => {
      if (this.ui.consoleOpen()) {
        setTimeout(() => this.field?.nativeElement.focus(), 0);
      }
    });
    // Keep the log scrolled to the newest line.
    effect(() => {
      this.lines();
      queueMicrotask(() => {
        const el = this.logEl?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  ngAfterViewInit(): void {
    if (this.ui.consoleOpen()) this.field?.nativeElement.focus();
  }

  onInput(value: string): void {
    this.input.set(value);
  }

  onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        void this.submit();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.recall(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.recall(1);
        break;
      case 'Tab':
        event.preventDefault();
        this.autocomplete();
        break;
    }
  }

  private async submit(): Promise<void> {
    const line = this.input().trim();
    if (line === '') return;
    this.lines.update((l) => [...l, { kind: 'in', text: `> ${line}` }]);
    this.cmdHistory.push(line);
    this.histIdx = this.cmdHistory.length;
    this.input.set('');

    const name = (line.split(/\s+/)[0] ?? '').toLowerCase();
    if (name === 'clear') {
      this.lines.set([]);
      return;
    }
    // execute is async (storage-backed commands like `sim save`): the echo
    // above prints immediately, the output appends when it resolves.
    const output = await this.console.execute(line);
    if (output.length > 0) this.lines.update((l) => [...l, ...output]);
  }

  /** Walk the command history (↑ older, ↓ newer; past the end clears). */
  private recall(direction: -1 | 1): void {
    if (this.cmdHistory.length === 0) return;
    this.histIdx = Math.max(0, Math.min(this.cmdHistory.length, this.histIdx + direction));
    const value =
      (this.histIdx < this.cmdHistory.length ? this.cmdHistory[this.histIdx] : '') ?? '';
    this.input.set(value);
    queueMicrotask(() => {
      const el = this.field?.nativeElement;
      if (el) el.setSelectionRange(value.length, value.length);
    });
  }

  /** Tab-complete the command name (only the first token). */
  private autocomplete(): void {
    const current = this.input();
    const tokens = current.split(/\s+/);
    if (tokens.length > 1) return;
    const matches = this.console.complete(tokens[0] ?? '');
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only !== undefined) {
      this.input.set(`${only} `);
    } else if (matches.length > 1) {
      this.lines.update((l) => [...l, { kind: 'out', text: matches.join('   ') }]);
    }
  }
}
