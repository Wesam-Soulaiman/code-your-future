import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveSession } from '../../models/LiveSlides';
import { LivePresenterComponent } from './live-presenter.component';

const SESSION: LiveSession = {
  id: 'session-1',
  batchId: 'batch-1',
  title: 'Live deck',
  sessionDate: '2026-08-03',
  status: 'live',
  slideCount: 1,
  questionCount: 0,
  canStart: false,
  editable: false,
  slides: [],
};

describe('LivePresenterComponent fullscreen', () => {
  let fixture: ComponentFixture<LivePresenterComponent>;
  let originalRequestFullscreen: PropertyDescriptor | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LivePresenterComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService()],
    }).compileComponents();

    originalRequestFullscreen = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'requestFullscreen',
    );
    fixture = TestBed.createComponent(LivePresenterComponent);
    fixture.componentRef.setInput('session', SESSION);
  });

  afterEach(() => {
    if (originalRequestFullscreen) {
      Object.defineProperty(
        document.documentElement,
        'requestFullscreen',
        originalRequestFullscreen,
      );
    } else {
      Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    }
    fixture.destroy();
  });

  it('uses the browser Fullscreen API and opens a clean stage', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const component = fixture.componentInstance as unknown as {
      fullscreen(): boolean;
      responsesVisible(): boolean;
      toggleFullscreen(): void;
    };

    component.toggleFullscreen();

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(component.fullscreen()).toBe(true);
    expect(component.responsesVisible()).toBe(false);
  });
});
