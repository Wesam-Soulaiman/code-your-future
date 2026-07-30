import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'time12h',
})
export class Time12hPipe implements PipeTransform {
  transform(time: string | null | undefined): string {
    if (!time) return '—';
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return time;
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
  }
}
