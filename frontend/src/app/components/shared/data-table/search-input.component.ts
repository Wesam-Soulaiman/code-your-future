import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { debounceTime, distinctUntilChanged, filter, Subject } from 'rxjs';

@Component({
  selector: 'app-search-input',
  imports: [IconFieldModule, InputIconModule, TranslateModule, InputTextModule, FormsModule],
  template: `
    <p-iconField iconPosition="left">
      @if (loading()) {
        <p-inputIcon class="fa-solid fa-spinner fa-spin" />
      } @else if (value().length <= 0) {
        <p-inputIcon class="fa-solid fa-search" />
      } @else {
        <p-inputIcon class="fa-solid fa-xmark cursor-pointer" (click)="clearInput()" />
      }
      <input
        pSize="small"
        type="text"
        pInputText
        name="searchInput"
        [placeholder]="placeholder() | translate"
        [ngModel]="value()"
        (ngModelChange)="onInput($event)"
        [readonly]="loading()"
        style="border-radius: 0.75rem"
      />
    </p-iconField>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchInputComponent implements OnInit {
  private destroyRef = inject(DestroyRef);

  placeholder = input<string>('Search...');
  debounceMs = input<number>(500);
  loading = input<boolean>(false);
  initialValue = input<string>('');
  resetKey = input<number>(0);

  valueChange = output<string>();

  value = signal('');
  private inputSubject = new Subject<string>();

  constructor() {
    effect(() => {
      this.resetKey();
      this.value.set(this.initialValue());
    });
  }

  ngOnInit(): void {

    this.inputSubject
      .pipe(
        debounceTime(this.debounceMs()),
        filter((val) => val.length >= 2 || val.length === 0),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((val) => this.valueChange.emit(val));
  }

  onInput(val: string): void {
    this.value.set(val);
    this.inputSubject.next(val);
  }

  clearInput(): void {
    this.value.set('');
    this.inputSubject.next('');
  }
}
