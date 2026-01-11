export enum ChangeType
{
  INSERT,
  UPDATE,
  DELETE,
  PENDING,
  NONE,
}

export type Change = [
  ChangeType,
  (string | number),
  any
];
