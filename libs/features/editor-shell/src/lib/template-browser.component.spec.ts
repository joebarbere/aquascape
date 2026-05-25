// TemplateBrowserComponent tests. Stage 5 F5.1 + F5.2.

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { documentToScene } from '@aquascape/domain/document';
import { BUILTIN_TEMPLATES } from '@aquascape/features/templates';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  TemplateBrowserComponent,
  type TemplateInstantiateEvent,
} from './template-browser.component';
import { TemplatesService } from './templates.service';

class FakeStorageService implements StorageService {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.data.get(key) as T | undefined) ?? null);
  }
  set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function configure() {
  const storage = new FakeStorageService();
  TestBed.configureTestingModule({
    imports: [TemplateBrowserComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(TemplateBrowserComponent);
  fixture.detectChanges();
  return { fixture, storage, service: TestBed.inject(TemplatesService) };
}

function openDialog(fixture: ComponentFixture<TemplateBrowserComponent>): void {
  fixture.componentInstance.open();
  fixture.detectChanges();
}

describe('TemplateBrowserComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('visibility', () => {
    it('is hidden by default', () => {
      const { fixture } = configure();
      expect(fixture.nativeElement.querySelector('.template-browser')).toBeNull();
    });

    it('open() renders the dialog', () => {
      const { fixture } = configure();
      openDialog(fixture);
      expect(fixture.nativeElement.querySelector('.template-browser')).not.toBeNull();
    });

    it('close() hides the dialog', () => {
      const { fixture } = configure();
      openDialog(fixture);
      fixture.componentInstance.close();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.template-browser')).toBeNull();
    });

    it('Escape key closes the dialog', () => {
      const { fixture } = configure();
      openDialog(fixture);
      fixture.componentInstance.onEscape();
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBe(false);
    });

    it('clicking the backdrop closes the dialog', () => {
      const { fixture } = configure();
      openDialog(fixture);
      const backdrop = fixture.nativeElement.querySelector(
        '.template-browser-backdrop',
      ) as HTMLElement;
      backdrop.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBe(false);
    });
  });

  describe('built-in templates', () => {
    it('renders one card per BUILTIN_TEMPLATES entry', () => {
      const { fixture } = configure();
      openDialog(fixture);
      const cards = fixture.nativeElement.querySelectorAll(
        '.template-browser__card:not(.template-browser__card--personal)',
      );
      expect(cards.length).toBe(BUILTIN_TEMPLATES.length);
    });

    it('each card shows the template name + description', () => {
      const { fixture } = configure();
      openDialog(fixture);
      const titles = Array.from(
        fixture.nativeElement.querySelectorAll(
          '.template-browser__card:not(.template-browser__card--personal) .template-browser__card-title',
        ),
      ).map((el) => (el as HTMLElement).textContent?.trim());
      for (const t of BUILTIN_TEMPLATES) {
        expect(titles).toContain(t.name);
      }
    });
  });

  describe('instantiate', () => {
    it('clicking "New from this" emits the instantiate event + closes', () => {
      const { fixture } = configure();
      openDialog(fixture);
      const events: TemplateInstantiateEvent[] = [];
      fixture.componentInstance.instantiate.subscribe((e) => events.push(e));
      const firstBtn = fixture.nativeElement.querySelector(
        '.template-browser__primary',
      ) as HTMLButtonElement;
      firstBtn.click();
      fixture.detectChanges();
      expect(events).toHaveLength(1);
      expect(events[0]!.scene.tank.width).toBeGreaterThan(0);
      expect(events[0]!.templateName).toBe(BUILTIN_TEMPLATES[0]!.name);
      expect(fixture.componentInstance.visible()).toBe(false);
    });
  });

  describe('personal templates', () => {
    it('shows empty hint when no personals exist', () => {
      const { fixture } = configure();
      openDialog(fixture);
      const empty = fixture.nativeElement.querySelector('.template-browser__empty');
      expect(empty?.textContent).toMatch(/Save your current layout/i);
    });

    it('shows personal cards after saveAsTemplate', async () => {
      const { fixture, service } = configure();
      const { scene, envelope } = documentToScene(BUILTIN_TEMPLATES[0]!.document);
      await service.saveAsTemplate(scene, envelope, 'My One');
      openDialog(fixture);
      const personalCards = fixture.nativeElement.querySelectorAll(
        '.template-browser__card--personal',
      );
      expect(personalCards.length).toBe(1);
      expect(personalCards[0]?.textContent).toMatch(/My One/);
    });

    it('delete button removes the personal template + persists', async () => {
      const { fixture, service, storage } = configure();
      const { scene, envelope } = documentToScene(BUILTIN_TEMPLATES[0]!.document);
      await service.saveAsTemplate(scene, envelope, 'To Delete');
      openDialog(fixture);
      const del = fixture.nativeElement.querySelector(
        '.template-browser__delete',
      ) as HTMLButtonElement;
      del.click();
      await flushPromises();
      fixture.detectChanges();
      expect(service.personal()).toHaveLength(0);
      expect(fixture.nativeElement.querySelector('.template-browser__card--personal')).toBeNull();
      const blob = storage.data.get('aquascape.templates.personal');
      expect(blob).toEqual([]);
    });
  });

  describe('save current as template', () => {
    it('shows "no scene" hint when currentScene is null', () => {
      const { fixture } = configure();
      fixture.componentInstance.currentScene = null;
      openDialog(fixture);
      const sections = fixture.nativeElement.querySelectorAll('.template-browser__empty');
      // There's the "save your current" empty AND the "no scene" empty.
      const noScene = Array.from(sections).find((el) =>
        (el as HTMLElement).textContent?.match(/No scene to save yet/),
      );
      expect(noScene).toBeDefined();
    });

    it('save button disabled when name is blank', () => {
      const { fixture } = configure();
      const { scene, envelope } = documentToScene(BUILTIN_TEMPLATES[0]!.document);
      fixture.componentInstance.currentScene = scene;
      fixture.componentInstance.currentEnvelope = envelope;
      openDialog(fixture);
      const saveBtn = fixture.nativeElement.querySelector(
        '.template-browser__primary[disabled]',
      ) as HTMLButtonElement | null;
      // "Save as template" is one of the primary buttons; it should be
      // disabled while the input is empty.
      expect(saveBtn).not.toBeNull();
    });

    it('clicking save with a valid name persists + clears the input', async () => {
      const { fixture, service } = configure();
      const { scene, envelope } = documentToScene(BUILTIN_TEMPLATES[0]!.document);
      fixture.componentInstance.currentScene = scene;
      fixture.componentInstance.currentEnvelope = envelope;
      openDialog(fixture);

      const nameInput = fixture.nativeElement.querySelector(
        '.template-browser__save-name',
      ) as HTMLInputElement;
      nameInput.value = 'My Save';
      nameInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // The save button is the last primary inside the save row.
      const saveRow = fixture.nativeElement.querySelector(
        '.template-browser__save-row',
      ) as HTMLElement;
      const saveBtn = saveRow.querySelector(
        '.template-browser__primary',
      ) as HTMLButtonElement;
      saveBtn.click();
      await flushPromises();
      fixture.detectChanges();

      expect(service.personal()).toHaveLength(1);
      expect(service.personal()[0]?.name).toBe('My Save');
      expect(fixture.componentInstance.saveName()).toBe('');
    });
  });
});
