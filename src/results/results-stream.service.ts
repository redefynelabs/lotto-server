import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class ResultStreamService {
  private readonly subject = new Subject<any>();

  emit(result: any) {
    this.subject.next(result);
  }

  get stream$() {
    return this.subject.asObservable();
  }
}
