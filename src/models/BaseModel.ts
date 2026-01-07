import * as Y from 'yjs';

export abstract class BaseModel<T extends Y.AbstractType<any>> {
  protected _data: T;

  constructor(data: T) {
    this._data = data;
  }

  get y() {
    return this._data;
  }

  abstract toJSON(): any;
}
