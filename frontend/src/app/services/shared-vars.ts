import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SharedVarsService {
  readonly baseURL = environment.apiUrl;
  readonly wss = environment.wsUrl;
}
