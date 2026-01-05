export {};

declare global {
  interface Window {
    __VERSICLE_SANITIZATION_DISABLED__?: boolean;
    __VERSICLE_MOCK_SYNC__?: boolean;
  }
}
